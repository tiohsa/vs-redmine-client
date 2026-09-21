import * as assert from "assert";
import * as vscode from "vscode";
import { DashboardUnsyncedService } from "../dashboard/services/DashboardUnsyncedService";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import {
  addOfflineCommentUpdateAsync,
  addOfflineTicketUpdateAsync,
  discardOfflineCommentUpdateAsync,
  discardOfflineNewTicketAsync,
  discardOfflineTicketUpdateAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  replaceOfflineSyncQueueAsync,
  type OfflineTicketUpdate,
} from "../views/offlineSyncStore";
import { buildUnsyncedDashboardItems } from "../dashboard/viewModels/unsyncedDashboardViewModel";
import { resolveTicketSyncState } from "../dashboard/viewModels/ticketDashboardViewModel";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { clearTicketDrafts, initializeDraftStore, initializeTicketDraft, markDraftStatus } from "../views/ticketDraftStore";
import { createInMemoryDraftStorage } from "../views/draftPersistence";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { syncLifecycleCases } from "./helpers/syncLifecycleFixtures";

suite("Dashboard recovery policy — lifecycle matrix", () => {
  const ticketId = 8123;
  const documentUri = "file:///tmp/recovery-comment.md";
  const metadata = buildIssueMetadataFixture();
  const update: OfflineTicketUpdate = {
    ticketId, baseSubject: "Base", baseDescription: "Base body", baseMetadata: metadata,
    subject: "Edited", description: "Edited body", metadata,
  };
  let scope: string;
  let storage: ReturnType<typeof createTestMemento>;
  let writes: number;
  setup(() => {
    scope = getCurrentConnectionScope();
    storage = createTestMemento();
    const persist = storage.update;
    writes = 0;
    storage.update = (key, value) => { writes++; return persist(key, value); };
    initializeOfflineSyncStore(storage, scope);
    initializeDraftStore(createInMemoryDraftStorage(), scope);
  });
  teardown(() => {
    clearTicketDrafts(scope);
    initializeOfflineSyncStore(createTestMemento(), scope);
  });

  for (const entry of syncLifecycleCases) {
    for (const hasNext of [false, true]) {
      test(`${entry.phase ?? "legacy"}, nextIntent=${hasNext}: 表示・破棄・再起動復元`, async () => {
        await replaceOfflineSyncQueueAsync({
          tickets: new Map([[ticketId, {
            ...update, phase: entry.phase, revision: 4, attemptGeneration: 2,
            nextIntent: hasNext ? { ...update, revision: 5, subject: "Later" } : undefined,
          }]]),
          comments: [{
            ticketId, documentUri, body: "Comment", phase: entry.phase, revision: 4, attemptGeneration: 2,
            nextIntent: hasNext ? { revision: 5, body: "Later comment" } : undefined,
          }],
          newTickets: [{
            queueId: "new-recovery", content: "New", revision: 4, attemptGeneration: 2,
            phase: entry.phase === "remote_committed" ? "remote_created" : entry.phase,
            nextIntent: hasNext ? { revision: 5, content: "Later new" } : undefined,
          }],
        }, scope);
        const before = getOfflineSyncQueue(scope);
        const items = buildUnsyncedDashboardItems();
        assert.strictEqual(items.length, 3);
        for (const item of items) {
          assert.strictEqual(item.lifecycle, entry.lifecycle);
          assert.strictEqual(item.canDiscard, entry.canDiscard || hasNext);
          assert.strictEqual(item.canSync, true);
        }
        assert.strictEqual(resolveTicketSyncState(ticketId), entry.state);
        if (!entry.canDiscard) {
          initializeTicketDraft(ticketId, "Base", "Base body", metadata, "", scope);
          for (const status of ["Synced", "Queued", "Dirty", "Failed", "Conflict"] as const) {
            markDraftStatus(ticketId, status, scope);
            assert.strictEqual(resolveTicketSyncState(ticketId), entry.state);
          }
          markDraftStatus(ticketId, "Syncing", scope);
          assert.strictEqual(resolveTicketSyncState(ticketId), "Syncing");
        }
        const writeCount = writes;
        const expected = entry.canDiscard ? "discarded" : hasNext ? "discarded_next" : "recovery_required";
        assert.strictEqual(await discardOfflineTicketUpdateAsync(ticketId, scope), expected);
        assert.strictEqual(await discardOfflineCommentUpdateAsync({ ticketId, documentUri }, scope), expected);
        assert.strictEqual(await discardOfflineNewTicketAsync({ queueId: "new-recovery" }, scope), expected);
        if (expected === "recovery_required") {
          assert.strictEqual(writes, writeCount, "拒否した破棄は永続化しない");
          assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
        }
        const after = getOfflineSyncQueue(scope);
        if (entry.canDiscard) {
          assert.strictEqual(after.tickets.size + after.comments.length + after.newTickets.length, 0);
        } else {
          const withoutNext = <T extends { nextIntent?: unknown }>(value: T): T => ({ ...value, nextIntent: undefined });
          assert.deepStrictEqual(withoutNext(after.tickets.get(ticketId)!), withoutNext(before.tickets.get(ticketId)!));
          assert.deepStrictEqual(withoutNext(after.comments[0]), withoutNext(before.comments[0]));
          assert.deepStrictEqual(withoutNext(after.newTickets[0]), withoutNext(before.newTickets[0]));
          if (hasNext) {
            assert.strictEqual(after.tickets.get(ticketId)?.nextIntent, undefined);
            assert.strictEqual(after.comments[0].nextIntent, undefined);
            assert.strictEqual(after.newTickets[0].nextIntent, undefined);
          }
        }
        initializeOfflineSyncStore(storage, scope);
        const restoredItems = buildUnsyncedDashboardItems();
        assert.strictEqual(restoredItems.length, entry.canDiscard ? 0 : 3);
        for (const item of restoredItems) {
          // remote write 前の preparing は既存仕様に従い再起動時に queued へ戻る。
          assert.strictEqual(item.lifecycle, entry.phase === "preparing" ? "queued" : entry.lifecycle);
        }
        if (!entry.canDiscard) {
          assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(ticketId)?.revision, before.tickets.get(ticketId)?.revision);
          assert.strictEqual(getOfflineSyncQueue(scope).comments[0].body, before.comments[0].body);
          assert.strictEqual(getOfflineSyncQueue(scope).newTickets[0].content, before.newTickets[0].content);
        }
      });
    }
  }

  test("コメントのURI・ticketId・接続scopeで別の下書きを破棄しない", async () => {
    await addOfflineCommentUpdateAsync({ ticketId, body: "First", documentUri }, scope);
    await addOfflineCommentUpdateAsync({ ticketId, body: "Second", documentUri: "file:///tmp/other.md" }, scope);
    await addOfflineCommentUpdateAsync({ ticketId, body: "Other scope", documentUri }, "other-scope");
    assert.strictEqual(await discardOfflineCommentUpdateAsync({ ticketId }, scope), "not_found");
    assert.strictEqual(await discardOfflineCommentUpdateAsync({ ticketId: ticketId + 1, documentUri }, scope), "not_found");
    assert.strictEqual(await discardOfflineCommentUpdateAsync({ ticketId, documentUri: "file:///tmp/missing.md" }, scope), "not_found");
    assert.strictEqual(await discardOfflineCommentUpdateAsync({ ticketId, documentUri }, scope), "discarded");
    assert.deepStrictEqual(getOfflineSyncQueue(scope).comments.map((item) => item.body), ["Second"]);
    assert.strictEqual(getOfflineSyncQueue("other-scope").comments[0].body, "Other scope");
  });


  for (const kind of ["ticket", "comment"] as const) {
    test(`Dashboard ${kind} の直接破棄要求でも復旧チェックポイントを保護する`, async () => {
      await addOfflineTicketUpdateAsync(ticketId, { ...update, phase: "commit_unknown" }, scope);
      await addOfflineCommentUpdateAsync({ ticketId, documentUri, body: "Comment", phase: "commit_unknown" }, scope);
      const before = getOfflineSyncQueue(scope);
      const errors: string[] = [];
      const service = new DashboardUnsyncedService({
        context: {
          store: new DashboardStateStore(), notifyOperationStarted: () => {},
          notifySuccess: () => { assert.fail("復旧対象の破棄は成功しない"); },
          notifyError: (_id, message) => { errors.push(message); },
          notifyToast: () => {}, onTicketsRefreshed: () => {},
        },
        refreshTicketPresentation: () => {}, loadComments: async () => {},
      });
      const original = vscode.window.showWarningMessage;
      Object.defineProperty(vscode.window, "showWarningMessage", { configurable: true, writable: true, value: async () => vscode.l10n.t("Discard") });
      try {
        await service.handleDiscardOne("discard", kind === "ticket" ? { kind, ticketId } : { kind, ticketId, documentUri });
      } finally {
        vscode.window.showWarningMessage = original;
      }
      assert.strictEqual(errors.length, 1);
      assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
    });
  }

  test("破棄の永続化が失敗した場合は追加編集を含めて保持する", async () => {
    await addOfflineTicketUpdateAsync(ticketId, { ...update, phase: "commit_unknown", nextIntent: { ...update, revision: 2 } }, scope);
    await addOfflineCommentUpdateAsync({ ticketId, documentUri, body: "Comment", phase: "commit_unknown", nextIntent: { body: "Later", revision: 2 } }, scope);
    const before = getOfflineSyncQueue(scope);
    storage.update = async () => { throw new Error("injected persistence failure"); };
    assert.strictEqual(await discardOfflineTicketUpdateAsync(ticketId, scope), "recovery_required");
    assert.strictEqual(await discardOfflineCommentUpdateAsync({ ticketId, documentUri }, scope), "recovery_required");
    assert.deepStrictEqual(getOfflineSyncQueue(scope), before);
  });
});
