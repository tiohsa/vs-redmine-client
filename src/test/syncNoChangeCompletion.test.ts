import * as assert from "assert";
import { SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import { DefaultSyncOperationRepository } from "../app/ticketSync/syncRepository";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { buildUnsyncedDashboardItems } from "../dashboard/viewModels/unsyncedDashboardViewModel";
import {
  addOfflineCommentUpdateAsync,
  addOfflineNewTicketAsync,
  addOfflineTicketUpdateAsync,
  clearOfflineSyncQueueAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { UnsyncedFilesTreeProvider } from "../views/unsyncedFilesView";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("変更なしの同期完了", () => {
  const scope = getCurrentConnectionScope();
  const key = { kind: "comment" as const, ticketId: 83, commentId: 91 };
  let storage = createTestMemento();

  setup(() => {
    storage = createTestMemento();
    initializeOfflineSyncStore(storage, scope);
  });

  teardown(async () => {
    await clearOfflineSyncQueueAsync(scope);
  });

  const options = {
    deps: {
      comment: {
        getIssueDetail: async (): Promise<never> => { throw new Error("GET should not run"); },
        updateComment: async (): Promise<never> => { throw new Error("PUT should not run"); },
      },
    },
  };

  test("キューに残ったcompleted項目を全種別で除去し、再起動後も一覧に戻さない", async () => {
    const metadata = buildIssueMetadataFixture();
    await addOfflineTicketUpdateAsync(key.ticketId, {
      ticketId: key.ticketId, phase: "completed", baseSubject: "Ticket", baseDescription: "Body",
      baseMetadata: metadata, subject: "Ticket", description: "Body", metadata,
    }, scope);
    await addOfflineCommentUpdateAsync({ ...key, body: "Body", phase: "completed" }, scope);
    const created = await addOfflineNewTicketAsync({
      content: "Created ticket", phase: "completed", createdIssueId: 84,
    }, scope);
    assert.strictEqual(buildUnsyncedDashboardItems().length, 3);
    const coordinator = new SyncCoordinator();
    for (const target of [
      { kind: "ticket" as const, ticketId: key.ticketId },
      key,
      { kind: "newTicket" as const, queueId: created.queueId },
    ]) {
      assert.strictEqual((await coordinator.sync(target, { connectionScope: scope }, options)).kind, "no_change");
    }
    assert.deepStrictEqual(buildUnsyncedDashboardItems(), []);
    initializeOfflineSyncStore(storage, scope);
    assert.deepStrictEqual(buildUnsyncedDashboardItems(), []);
  });

  test("completedの後続編集はread-backが成功してから最新の基準で昇格する", async () => {
    const metadata = buildIssueMetadataFixture();
    await addOfflineTicketUpdateAsync(key.ticketId, {
      ticketId: key.ticketId, phase: "completed", baseSubject: "Old", baseDescription: "Old body",
      baseMetadata: metadata, subject: "Synced", description: "Synced body", metadata,
      nextIntent: { revision: 2, subject: "Later", description: "Later body", metadata },
    }, scope);
    let offline = true;
    const coordinator = new SyncCoordinator();
    const target = { kind: "ticket" as const, ticketId: key.ticketId };
    const syncOptions = { deps: { ticketUpdate: { getIssueDetail: async () => {
      if (offline) { throw new Error("offline"); }
      return {
        ticket: { id: key.ticketId, projectId: 1, subject: "Synced", description: "Synced body" },
        comments: [],
      };
    } } } };
    assert.strictEqual((await coordinator.sync(target, { connectionScope: scope }, syncOptions)).kind, "remote_committed");
    assert.strictEqual(getOfflineSyncQueue(scope).tickets.get(key.ticketId)?.nextIntent?.description, "Later body");
    offline = false;
    assert.strictEqual((await coordinator.sync(target, { connectionScope: scope }, syncOptions)).kind, "no_change");
    const remaining = getOfflineSyncQueue(scope).tickets.get(key.ticketId);
    assert.strictEqual(remaining?.phase, "queued");
    assert.strictEqual(remaining?.description, "Later body");
    assert.strictEqual(remaining?.baseDescription, "Synced body");
    assert.strictEqual(buildUnsyncedDashboardItems().length, 1);
  });

  for (const body of ["Synced body", ""]) {
    test(`基準本文と同じコメントは一覧と永続キューから消える: ${JSON.stringify(body)}`, async () => {
      await addOfflineCommentUpdateAsync({ ...key, body, baseBody: body }, scope);
      const provider = new UnsyncedFilesTreeProvider();
      try {
        assert.strictEqual(buildUnsyncedDashboardItems().length, 1);
        const result = await new SyncCoordinator().sync(key, { connectionScope: scope }, options);
        assert.strictEqual(result.kind, "no_change");
        assert.strictEqual(getOfflineSyncQueue(scope).comments.length, 0);
        assert.deepStrictEqual(buildUnsyncedDashboardItems(), []);
        const items = await provider.getChildren();
        assert.ok(items);
        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].contextValue, "viewStateEmpty");
        initializeOfflineSyncStore(storage, scope);
        assert.strictEqual(getOfflineSyncQueue(scope).comments.length, 0);
      } finally {
        provider.dispose();
      }
    });
  }

  test("完了時の永続化失敗では成功を返さず、再実行で除去できる", async () => {
    await addOfflineCommentUpdateAsync({ ...key, body: "Body", baseBody: "Body" }, scope);
    const update = storage.update;
    storage.update = async (storageKey, value) => {
      // begin_preparation は通し、キューからの削除だけ失敗させる。
      if (value !== null && typeof value === "object" && "operations" in value &&
        Array.isArray(value.operations) && value.operations.length === 0) {
        throw new Error("disk full");
      }
      await update(storageKey, value);
    };
    const result = await new SyncCoordinator().sync(key, { connectionScope: scope }, options);
    assert.strictEqual(result.kind, "failed_before_commit");
    assert.strictEqual(getOfflineSyncQueue(scope).comments.length, 1);
    initializeOfflineSyncStore(storage, scope);
    assert.strictEqual(getOfflineSyncQueue(scope).comments.length, 1);
    storage.update = update;
    assert.strictEqual((await new SyncCoordinator().sync(key, { connectionScope: scope }, options)).kind, "no_change");
    assert.strictEqual(getOfflineSyncQueue(scope).comments.length, 0);
  });

  test("完了中に追加された後続編集を残し、別scopeの同じコメントも保持する", async () => {
    const otherScope = "https://other-no-change.example.org/";
    await addOfflineCommentUpdateAsync({ ...key, body: "Body", baseBody: "Body" }, scope);
    await addOfflineCommentUpdateAsync({ ...key, body: "Other body" }, otherScope);
    class Repository extends DefaultSyncOperationRepository {
      override async completeOperation(...args: Parameters<DefaultSyncOperationRepository["completeOperation"]>): Promise<boolean> {
        await addOfflineCommentUpdateAsync({ ...key, body: "Later edit" }, scope);
        return super.completeOperation(...args);
      }
    }
    const result = await new SyncCoordinator({ repository: new Repository() }).sync(key, { connectionScope: scope }, options);
    assert.strictEqual(result.kind, "no_change");
    const remaining = getOfflineSyncQueue(scope).comments;
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].body, "Later edit");
    assert.strictEqual(remaining[0].phase, "queued");
    assert.strictEqual(buildUnsyncedDashboardItems().length, 1);
    assert.strictEqual(getOfflineSyncQueue(otherScope).comments[0].body, "Other body");
    await clearOfflineSyncQueueAsync(otherScope);
  });

  test("本文が同じでもcommit_unknownは未同期に残す", async () => {
    await addOfflineCommentUpdateAsync({
      ...key, body: "Body", baseBody: "Body", phase: "commit_unknown",
      effects: [{
        effectId: "comment-update", kind: "comment_update", operationRevision: 1,
        state: "commit_unknown", target: { ticketId: key.ticketId, commentId: key.commentId },
      }],
    }, scope);
    const result = await new SyncCoordinator().sync(key, { connectionScope: scope }, options);
    assert.strictEqual(result.kind, "commit_unknown");
    assert.strictEqual(getOfflineSyncQueue(scope).comments.length, 1);
    assert.strictEqual(buildUnsyncedDashboardItems().length, 1);
  });
});
