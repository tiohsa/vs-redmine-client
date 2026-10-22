import * as assert from "assert";
import * as vscode from "vscode";
import { createSyncEngine, type SyncEngineOutcome } from "../app/syncEngine";
import { syncUnsyncedFile } from "../commands/syncUnsyncedFile";
import { DashboardUnsyncedService } from "../dashboard/services/DashboardUnsyncedService";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { initializeOfflineSyncStore, addOfflineCommentUpdateAsync, getOfflineSyncQueue } from "../views/offlineSyncStore";
import { describeOfflineSync } from "../views/offlineSyncPresentation";
import { createTestMemento } from "./helpers/vscodeMemento";

suite("同期UIの対象識別と結果通知", () => {
  const originalWarning = vscode.window.showWarningMessage;
  const originalInfo = vscode.window.showInformationMessage;
  setup(() => initializeOfflineSyncStore(createTestMemento()));
  teardown(() => {
    vscode.window.showWarningMessage = originalWarning;
    vscode.window.showInformationMessage = originalInfo;
  });

  const dashboard = (outcome: SyncEngineOutcome) => {
    const engine = createSyncEngine();
    engine.syncOne = async () => outcome;
    engine.getRecoveryItems = () => [];
    const notices: Array<{ message: string; level?: string }> = [];
    const service = new DashboardUnsyncedService({
      context: {
        store: new DashboardStateStore(), notifyOperationStarted: () => {},
        notifySuccess: (_id, message, level) => { notices.push({ message, level }); },
        notifyError: (_id, message) => { notices.push({ message, level: "error" }); },
        notifyToast: () => {}, onTicketsRefreshed: () => {},
      },
      syncEngine: engine, refreshTicketPresentation: () => {}, loadComments: async () => {},
    });
    return { engine, service, notices };
  };

  test("operationIdだけで識別した新規コメントを同期engineまで引き継ぐ", async () => {
    const { service, engine } = dashboard({ kind: "no_change", ticketId: 10 });
    let received: unknown;
    engine.syncOne = async (key) => { received = key; return { kind: "no_change", ticketId: 10 }; };
    await service.handleSyncOne("identity", { kind: "comment", ticketId: 10, operationId: "second-comment" });
    assert.deepStrictEqual(received, { kind: "comment", ticketId: 10, operationId: "second-comment", commentId: undefined, documentUri: undefined });
  });

  for (const outcome of [
    { kind: "commit_unknown", operationId: "unknown", message: "unknown" },
    { kind: "remote_committed", ticketId: 10, pending: "local_finalize" },
  ] satisfies SyncEngineOutcome[]) {
    test(`${outcome.kind}を失敗でなく復旧案内として表示し、通知を重複させない`, async () => {
      let notifications = 0;
      vscode.window.showInformationMessage = async () => { notifications++; return undefined; };
      vscode.window.showWarningMessage = async () => { notifications++; return undefined; };
      const { service, notices } = dashboard(outcome);
      await service.handleSyncOne("pending", { kind: "ticket", ticketId: 10 });
      assert.strictEqual(notifications, 0);
      assert.strictEqual(notices.length, 1);
      assert.strictEqual(notices[0].level, "warning");
      assert.match(notices[0].message, /recovery/);
    });
  }

  test("復旧確認のキャンセルは再送せず中立の結果を返す", async () => {
    const engine = createSyncEngine();
    engine.syncOne = async () => ({ kind: "commit_unknown", operationId: "comment", message: "unknown" });
    engine.getRecoveryItems = () => [{
      operationId: "comment", operationRevision: 1, attemptGeneration: 1,
      effectId: "primary", effectKind: "comment_create", state: "commit_unknown",
      allowedActions: ["reconcile_remote"], disposition: "actionable",
    }];
    engine.resolveCommentCommitUnknown = async () => { assert.fail("キャンセル後の復旧書き込みは禁止"); };
    vscode.window.showWarningMessage = async () => undefined;
    const result = await syncUnsyncedFile({ syncKey: { kind: "comment", ticketId: 10, operationId: "comment" } }, { createSyncEngine: () => engine });
    assert.deepStrictEqual(result, { status: "cancelled", kind: "comment" });
  });

  test("後続のキューが残る完了では全変更の同期完了と表示しない", async () => {
    await addOfflineCommentUpdateAsync({ ticketId: 10, body: "Later edits", documentUri: "test://later" });
    const queued = getOfflineSyncQueue().comments[0];
    const { service, notices } = dashboard({ kind: "completed", ticketId: 10, commentId: 20 });
    await service.handleSyncOne("later", { kind: "comment", ticketId: 10, operationId: queued.operationId, documentUri: queued.documentUri });
    assert.match(notices[0].message, /Later local changes/);
    assert.strictEqual(notices[0].level, "info");
  });

  test("表示モデルは未送信・結果不明・ローカル処理待ちを区別する", () => {
    assert.strictEqual(describeOfflineSync({ phase: "queued" }).label, "Waiting to sync");
    assert.strictEqual(describeOfflineSync({ phase: "commit_unknown" }).label, "Remote outcome unknown");
    assert.match(describeOfflineSync({ phase: "local_finalize_pending", nextIntent: {} }).detail, /Changes are on Redmine[\s\S]*Later local changes/);
  });
});
