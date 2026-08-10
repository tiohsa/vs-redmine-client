import * as assert from "assert";
import {
  addOfflineTicketUpdate,
  clearOfflineSyncQueue,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { runOfflineSync, type OfflineSyncRunResult } from "../commands/offlineSync";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("offlineSyncResult — 構造化戻り値", () => {
  setup(() => {
    initializeOfflineSyncStore(createTestMemento());
    clearOfflineSyncQueue();
  });

  teardown(() => {
    clearOfflineSyncQueue();
  });

  test("キューが空の場合 nothing_to_sync を返す", async () => {
    const result = await runOfflineSync();
    assert.strictEqual(result.status, "nothing_to_sync");
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.synced, 0);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(result.conflicts, 0);
  });

  test("ticket の Sync All は TicketSyncService.syncAll を一度だけ呼ぶ", async () => {
    addOfflineTicketUpdate(42, {
      ticketId: 42,
      baseSubject: "Base",
      baseDescription: "Old",
      baseMetadata: buildIssueMetadataFixture(),
      subject: "Updated",
      description: "New",
      metadata: buildIssueMetadataFixture(),
    });
    let syncAllCalls = 0;
    let receivedTicketIds: number[] = [];

    const result = await runOfflineSync({
      createTicketSyncService: () => ({
        syncAll: async (context) => {
          syncAllCalls++;
          receivedTicketIds = Array.from(
            getOfflineSyncQueue(context.connectionScope).tickets.keys(),
          );
          return {
            results: [{
              key: { kind: "ticket", ticketId: 42 },
              outcome: { kind: "completed", ticketId: 42 },
            }],
            cancelled: false,
          };
        },
      }),
    });

    assert.strictEqual(syncAllCalls, 1);
    assert.deepStrictEqual(receivedTicketIds, [42]);
    assert.strictEqual(result.status, "success");
  });

  test("OfflineSyncRunResult 型: nothing_to_sync の数値フィールドが 0", () => {
    const r: OfflineSyncRunResult = {
      status: "nothing_to_sync",
      total: 0,
      synced: 0,
      failed: 0,
      conflicts: 0,
    };
    assert.strictEqual(r.status, "nothing_to_sync");
    assert.strictEqual(r.total, 0);
  });

  test("OfflineSyncRunResult 型: success は failed と conflicts が 0", () => {
    const r: OfflineSyncRunResult = {
      status: "success",
      total: 3,
      synced: 3,
      failed: 0,
      conflicts: 0,
    };
    assert.strictEqual(r.status, "success");
    assert.strictEqual(r.synced, 3);
    assert.strictEqual(r.failed, 0);
  });

  test("OfflineSyncRunResult 型: partial_failure は synced と failed を持つ", () => {
    const r: OfflineSyncRunResult = {
      status: "partial_failure",
      total: 3,
      synced: 2,
      failed: 1,
      conflicts: 0,
    };
    assert.strictEqual(r.status, "partial_failure");
    assert.strictEqual(r.synced, 2);
    assert.strictEqual(r.failed, 1);
  });

  test("OfflineSyncRunResult 型: cancelled は synced と failed を持つ", () => {
    const r: OfflineSyncRunResult = {
      status: "cancelled",
      total: 5,
      synced: 2,
      failed: 3,
      conflicts: 0,
    };
    assert.strictEqual(r.status, "cancelled");
    assert.strictEqual(r.synced, 2);
    assert.strictEqual(r.failed, 3);
  });

  test("OfflineSyncRunResult 型: failed は全件失敗を示す", () => {
    const r: OfflineSyncRunResult = {
      status: "failed",
      total: 2,
      synced: 0,
      failed: 2,
      conflicts: 0,
    };
    assert.strictEqual(r.status, "failed");
    assert.strictEqual(r.synced, 0);
  });
});
