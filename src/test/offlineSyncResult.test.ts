import * as assert from "assert";
import {
  addOfflineNewTicketAsync,
  addOfflineTicketUpdateAsync,
  clearOfflineSyncQueueAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { runOfflineSync, type OfflineSyncRunResult } from "../commands/offlineSync";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("offlineSyncResult — 構造化戻り値", () => {
  setup(async () => {
    initializeOfflineSyncStore(createTestMemento());
    await clearOfflineSyncQueueAsync();
  });

  teardown(async () => {
    await clearOfflineSyncQueueAsync();
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
    await addOfflineTicketUpdateAsync(42, {
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
            plan: [{ kind: "ticket", ticketId: 42 }],
            results: [{
              key: { kind: "ticket", ticketId: 42 },
              outcome: { kind: "completed", ticketId: 42 },
            }],
            remaining: [],
            cancelled: false,
          };
        },
      }),
    });

    assert.strictEqual(syncAllCalls, 1);
    assert.deepStrictEqual(receivedTicketIds, [42]);
    assert.strictEqual(result.status, "success");
  });

  test("I-17/I-18 10件中3件処理後の cancellation は未処理7件を failed に含める", async () => {
    for (let ticketId = 1; ticketId <= 10; ticketId++) {
      await addOfflineTicketUpdateAsync(ticketId, {
        ticketId,
        baseSubject: `Base ${ticketId}`,
        baseDescription: "Old",
        baseMetadata: buildIssueMetadataFixture(),
        subject: `Updated ${ticketId}`,
        description: "New",
        metadata: buildIssueMetadataFixture(),
      });
    }
    const plan = Array.from({ length: 10 }, (_, index) => ({
      kind: "ticket" as const,
      ticketId: index + 1,
    }));

    const result = await runOfflineSync({
      createSyncEngine: () => ({
        syncAll: async () => ({
          plan,
          results: plan.slice(0, 3).map((key) => ({
            key,
            outcome: { kind: "completed" as const, ticketId: key.ticketId },
          })),
          remaining: plan.slice(3),
          cancelled: true,
          stopReason: "user_cancelled",
        }),
      }),
    });

    assert.strictEqual(result.status, "cancelled");
    assert.strictEqual(result.total, 10);
    assert.strictEqual(result.synced, 3);
    assert.strictEqual(result.failed, 7);
    assert.strictEqual(result.synced + result.failed, result.total);
  });

  test("OfflineSyncRunResult 型: nothing_to_sync の数値フィールドが 0", async () => {
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

  test("OfflineSyncRunResult 型: success は failed と conflicts が 0", async () => {
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

  test("OfflineSyncRunResult 型: partial_failure は synced と failed を持つ", async () => {
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

  test("OfflineSyncRunResult 型: cancelled は synced と failed を持つ", async () => {
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

  test("OfflineSyncRunResult 型: failed は全件失敗を示す", async () => {
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

  test("runOfflineSync は新規作成完了チケットの createdTicketIds を success/partial_failure で返す", async () => {
    const first = await addOfflineNewTicketAsync({
      content: "# 新規1\n本文1",
      projectId: 1,
      documentUri: "file:///tmp/offline-sync-new-1.md",
    });
    const second = await addOfflineNewTicketAsync({
      content: "# 新規2\n本文2",
      projectId: 1,
      documentUri: "file:///tmp/offline-sync-new-2.md",
    });

    const successResult = await runOfflineSync({
      suppressResultNotifications: true,
      createSyncEngine: () => ({
        syncAll: async () => ({
          plan: [
            { kind: "newTicket", queueId: first.queueId, documentUri: first.documentUri },
            { kind: "newTicket", queueId: second.queueId, documentUri: second.documentUri },
          ],
          results: [
            {
              key: { kind: "newTicket", queueId: first.queueId, documentUri: first.documentUri },
              outcome: { kind: "completed", ticketId: 901 },
            },
            {
              key: { kind: "newTicket", queueId: second.queueId, documentUri: second.documentUri },
              outcome: { kind: "completed", ticketId: 902 },
            },
          ],
          remaining: [],
          cancelled: false,
          stopReason: "completed",
        }),
      }),
    });

    assert.strictEqual(successResult.status, "success");
    assert.deepStrictEqual(successResult.createdTicketIds, [901, 902]);

    const partialResult = await runOfflineSync({
      suppressResultNotifications: true,
      createSyncEngine: () => ({
        syncAll: async () => ({
          plan: [
            { kind: "newTicket", queueId: first.queueId, documentUri: first.documentUri },
            { kind: "newTicket", queueId: second.queueId, documentUri: second.documentUri },
          ],
          results: [
            {
              key: { kind: "newTicket", queueId: first.queueId, documentUri: first.documentUri },
              outcome: { kind: "completed", ticketId: 903 },
            },
            {
              key: { kind: "newTicket", queueId: second.queueId, documentUri: second.documentUri },
              outcome: { kind: "failed_before_commit", error: new Error("failed") },
            },
          ],
          remaining: [],
          cancelled: false,
          stopReason: "failed",
        }),
      }),
    });

    assert.strictEqual(partialResult.status, "partial_failure");
    assert.deepStrictEqual(partialResult.createdTicketIds, [903]);
  });
});
