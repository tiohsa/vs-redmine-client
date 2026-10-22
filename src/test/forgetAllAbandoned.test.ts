import * as assert from "assert";
import * as vscode from "vscode";
import {
  beginActiveSync, getOfflineSyncQueue, initializeOfflineSyncStore,
  prepareOfflineForgetAllAbandoned, commitOfflineForgetAllAbandonedAsync,
  replaceOfflineSyncQueueAsync, type OfflineSyncQueue,
} from "../views/offlineSyncStore";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardMessageRouter } from "../dashboard/DashboardMessageRouter";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("中止済み同期記録の一括削除", () => {
  const scope = getCurrentConnectionScope();
  let storage: ReturnType<typeof createTestMemento>;
  let writes: number;
  const originalWarning = vscode.window.showWarningMessage;
  const fixture = (): OfflineSyncQueue => {
    const metadata = buildIssueMetadataFixture();
    const ticket = { ticketId: 81, subject: "Keep", description: "", metadata,
      baseSubject: "Base", baseDescription: "", baseMetadata: metadata };
    const disposition = { kind: "abandoned" as const, abandonedAt: 1234 };
    return {
      tickets: new Map([[81, { ...ticket, operationId: "active-ticket" }]]),
      abandonedTickets: [{ ...ticket, operationId: "old-ticket", disposition, phase: "commit_unknown" }],
      newTickets: [{ queueId: "old-new", operationId: "old-new", content: "Keep file", disposition }],
      comments: [
        { ticketId: 81, operationId: "old-comment", body: "Keep file", disposition },
        { ticketId: 81, operationId: "active-comment", body: "Keep" },
      ],
    };
  };
  setup(async () => {
    storage = createTestMemento();
    const update = storage.update;
    writes = 0;
    storage.update = async (key, value) => { writes++; await update(key, value); };
    initializeOfflineSyncStore(storage, scope);
    await replaceOfflineSyncQueueAsync(fixture(), scope);
    writes = 0;
  });
  teardown(() => {
    vscode.window.showWarningMessage = originalWarning;
    initializeOfflineSyncStore(createTestMemento(), scope);
  });

  test("全種別を一度の保存で削除し、同じチケットの現行操作と別接続先を再起動後も保持する", async () => {
    await replaceOfflineSyncQueueAsync(fixture(), "other-scope");
    initializeOfflineSyncStore(storage, scope);
    const other = getOfflineSyncQueue("other-scope");
    writes = 0;
    const plan = prepareOfflineForgetAllAbandoned(scope);
    assert.strictEqual(plan.items.length, 3);
    assert.strictEqual(await commitOfflineForgetAllAbandonedAsync(plan), "removed");
    assert.strictEqual(writes, 1);
    initializeOfflineSyncStore(storage, scope);
    const queue = getOfflineSyncQueue(scope);
    assert.strictEqual(queue.abandonedTickets?.length, 0);
    assert.strictEqual(queue.newTickets.length, 0);
    assert.strictEqual(queue.comments.length, 1);
    assert.strictEqual(queue.comments[0].operationId, "active-comment");
    assert.strictEqual(queue.tickets.get(81)?.operationId, "active-ticket");
    assert.deepStrictEqual(getOfflineSyncQueue("other-scope"), other);
  });

  test("確認後に追加された中止済み記録は削除しない", async () => {
    const plan = prepareOfflineForgetAllAbandoned(scope);
    const queue = getOfflineSyncQueue(scope);
    queue.comments.push({ ticketId: 82, operationId: "later", body: "Later",
      disposition: { kind: "abandoned", abandonedAt: 5678 } });
    await replaceOfflineSyncQueueAsync(queue, scope);
    assert.strictEqual(await commitOfflineForgetAllAbandonedAsync(plan), "removed");
    assert.ok(getOfflineSyncQueue(scope).comments.some((item) => item.operationId === "later"));
  });

  for (const condition of ["stale", "busy", "persistence_failed"] as const) {
    test(`${condition}: 後半の対象で失敗しても全件を保持する`, async () => {
      const plan = prepareOfflineForgetAllAbandoned(scope);
      let release: (() => void) | undefined;
      if (condition === "stale") {
        const queue = getOfflineSyncQueue(scope);
        queue.comments[0].body = "Changed during confirmation";
        await replaceOfflineSyncQueueAsync(queue, scope);
      } else if (condition === "busy") {
        release = beginActiveSync(scope, "old-comment");
      } else {
        storage.update = async () => { throw new Error("disk failure"); };
      }
      const before = getOfflineSyncQueue(scope);
      writes = 0;
      try {
        assert.strictEqual(await commitOfflineForgetAllAbandonedAsync(plan), condition);
        assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
        assert.strictEqual(writes, 0);
      } finally { release?.(); }
    });
  }

  test("空の計画や別scopeの計画を混在させた要求では永続化しない", async () => {
    assert.strictEqual(await commitOfflineForgetAllAbandonedAsync({ scope, items: [] }), "not_found");
    const plan = prepareOfflineForgetAllAbandoned(scope);
    assert.strictEqual(await commitOfflineForgetAllAbandonedAsync({ ...plan,
      items: plan.items.map((item) => ({ ...item, scope: "other-scope" })),
    }), "stale");
    assert.strictEqual(writes, 0);
  });

  for (const confirm of [true, false]) {
    test(`Dashboard の検証済み要求は件数確認後に${confirm ? "一括削除" : "キャンセル通知"}する`, async () => {
      const notifications: string[] = [];
      const state = new DashboardStateStore();
      const controller = new DashboardController({
        store: state, notifyOperationStarted: () => {}, notifyToast: () => {}, onTicketsRefreshed: () => {},
        notifySuccess: (_id, message) => { notifications.push(message); },
        notifyError: (_id, message) => { assert.fail(message); },
      });
      const before = getOfflineSyncQueue(scope);
      let confirmations = 0;
      Object.defineProperty(vscode.window, "showWarningMessage", {
        configurable: true, writable: true, value: async (message: string, options: vscode.MessageOptions) => {
          confirmations++;
          assert.strictEqual(message, vscode.l10n.t("Permanently delete {0} abandoned sync records?", 3));
          assert.strictEqual(options.modal, true);
          return confirm ? vscode.l10n.t("Delete all abandoned records") : undefined;
        },
      });
      try {
        await new DashboardMessageRouter(controller).route({ type: "unsynced.forgetAllAbandoned", requestId: "bulk-delete" });
        assert.strictEqual(confirmations, 1);
        assert.strictEqual(notifications.length, 1);
        if (confirm) {
          assert.strictEqual(state.getState().unsynced.abandonedItems?.length, 0);
          assert.strictEqual(writes, 1);
        } else {
          assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
          assert.strictEqual(writes, 0);
        }
      } finally { controller.dispose(); }
    });
  }
});
