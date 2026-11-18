import * as assert from "assert";
import * as vscode from "vscode";
import { createSyncEngine, type SyncEngineOutcome } from "../app/syncEngine";
import { TicketSyncService } from "../app/ticketSync";
import { syncUnsyncedFile } from "../commands/syncUnsyncedFile";
import { DashboardUnsyncedService } from "../dashboard/services/DashboardUnsyncedService";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { RedmineHttpError, createOperationHttpError } from "../redmine/httpError";
import { initializeOfflineSyncStore, addOfflineCommentUpdateAsync, addOfflineNewTicketAsync, getOfflineSyncQueue } from "../views/offlineSyncStore";
import { buildUnsyncedDashboardItems } from "../dashboard/viewModels/unsyncedDashboardViewModel";
import { describeOfflineSync } from "../views/offlineSyncPresentation";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createTestMemento } from "./helpers/vscodeMemento";

suite("同期UIの対象識別と結果通知", () => {
  const originalWarning = vscode.window.showWarningMessage;
  const originalInfo = vscode.window.showInformationMessage;
  setup(() => initializeOfflineSyncStore(createTestMemento()));
  teardown(() => {
    vscode.window.showWarningMessage = originalWarning;
    vscode.window.showInformationMessage = originalInfo;
  });

  const dashboard = (outcome?: SyncEngineOutcome, engine = createSyncEngine()) => {
    if (outcome) { engine.syncOne = async () => outcome; }
    if (outcome) { engine.getRecoveryItems = () => []; }
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

  const queueNewTicket = async () => {
    const content = buildTicketEditorContent({
      subject: "New ticket",
      description: "Body",
      metadata: buildIssueMetadataFixture(),
      controlFields: { mode: "new-ticket", issue_id: null, project_id: 12 },
    });
    return addOfflineNewTicketAsync({ content, projectId: 12, documentUri: "file:///tmp/dashboard-sync-new.md" });
  };

  for (const [operation, status] of [["statuses", 403], ["create", 403], ["create", 503]] as const) {
    test(`Dashboard 一括同期が ${operation} の HTTP ${status} を表示する`, async () => {
      await queueNewTicket();
      let postCalls = 0;
      const httpError = new RedmineHttpError(status, "sensitive response body");
      const engine = createSyncEngine({
        tickets: {
          listIssueStatuses: async () => {
            if (operation === "statuses") { throw httpError; }
            return [{ id: 1, name: "In Progress" }];
          },
          getProjectTrackers: async () => [{ id: 2, name: "Task" }],
          listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
          createIssue: async () => { postCalls++; throw httpError; },
        },
      });
      let vscodeNotifications = 0;
      vscode.window.showWarningMessage = async () => { vscodeNotifications++; return undefined; };
      vscode.window.showInformationMessage = async () => { vscodeNotifications++; return undefined; };
      const { service, notices } = dashboard(undefined, engine);
      await service.handleSyncAll("sync-all");
      assert.strictEqual(vscodeNotifications, 0);
      assert.strictEqual(notices.length, 1);
      const notice = notices[0];
      const label = operation === "statuses" ? "list issue statuses" : "create issue";
      assert.match(notice.message, new RegExp(`${label}.*HTTP ${status}`, "i"));
      assert.doesNotMatch(notice.message, /sensitive response body|Check the VS Code notifications/);
      assert.strictEqual(notice.level, status === 503 ? "warning" : "error");
      assert.strictEqual(postCalls, operation === "statuses" ? 0 : 1);
      assert.strictEqual(getOfflineSyncQueue().newTickets[0].createdIssueId, undefined);
      const item = buildUnsyncedDashboardItems().find((candidate) => candidate.key.kind === "newTicket");
      assert.strictEqual(item?.canRetrySync, status === 403);
      if (status === 503) {
        assert.match(notice.message, /recovery/);
        assert.strictEqual(getOfflineSyncQueue().newTickets[0].phase, "commit_unknown");
        await service.handleSyncAll("sync-again");
        assert.strictEqual(postCalls, 1);
      }
    });
  }

  for (const stage of ["prepare", "create"] as const) {
    test(`再起動後の Dashboard 再同期は ${stage} の拒否から完了する`, async () => {
      const storage = createTestMemento();
      initializeOfflineSyncStore(storage);
      const queued = await queueNewTicket();
      let denied = true;
      let posts = 0;
      let preparations = 0;
      let rewrittenId: number | undefined;
      const tickets = new TicketSyncService({
        create: {
          listIssueStatuses: async () => {
            preparations++;
            if (denied && stage === "prepare") { throw new RedmineHttpError(403, "Forbidden"); }
            return [{ id: 1, name: "In Progress" }];
          },
          getProjectTrackers: async () => [{ id: 2, name: "Task" }],
          listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
          createIssue: async () => {
            posts++;
            if (denied) { throw new RedmineHttpError(403, "Forbidden"); }
            return 501;
          },
          getIssueDetail: async () => ({ ticket: { id: 501, subject: "New ticket", projectId: 12 }, comments: [] }),
        },
        documents: {
          rewriteNewTicket: async (input) => { rewrittenId = input.ticketId; return { kind: "applied" }; },
          findOpenDocument: () => undefined,
        },
      });
      const { service } = dashboard(undefined, createSyncEngine({ tickets }));
      const key = { kind: "newTicket", queueId: queued.queueId } as const;
      await service.handleSyncOne("initial", key);
      initializeOfflineSyncStore(storage);
      assert.strictEqual(buildUnsyncedDashboardItems()[0]?.canRetrySync, true);
      denied = false;
      vscode.window.showWarningMessage = (async () => vscode.l10n.t("Retry sync")) as typeof originalWarning;
      await service.handleSyncOne("retry", key);
      assert.strictEqual(posts, stage === "create" ? 2 : 1);
      assert.strictEqual(rewrittenId, 501);
      assert.strictEqual(preparations, stage === "prepare" ? 2 : 1);
      assert.strictEqual(getOfflineSyncQueue().newTickets.length, 0);
    });
  }

  test("Dashboard 一括同期の部分失敗でも作成の HTTP 診断を表示する", async () => {
    const queued = await queueNewTicket();
    await addOfflineCommentUpdateAsync({ ticketId: 10, body: "Local comment" });
    const comment = getOfflineSyncQueue().comments[0];
    const { engine, service, notices } = dashboard();
    const commentKey = { kind: "comment", ticketId: 10, operationId: comment.operationId } as const;
    const createKey = { kind: "newTicket", queueId: queued.queueId } as const;
    const error = createOperationHttpError(new RedmineHttpError(403, "sensitive response body"), "create");
    assert.ok(error instanceof Error);
    engine.syncAll = async () => ({
      plan: [commentKey, createKey],
      results: [
        { key: commentKey, outcome: { kind: "completed", ticketId: 10 } },
        { key: createKey, outcome: { kind: "failed_before_commit", error } },
      ],
      remaining: [],
      cancelled: false,
      stopReason: "failed",
    });
    await service.handleSyncAll("partial");
    assert.strictEqual(notices.length, 1);
    assert.match(notices[0].message, /Partial sync failure.*create issue.*HTTP 403/i);
    assert.doesNotMatch(notices[0].message, /sensitive response body/);
  });

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
