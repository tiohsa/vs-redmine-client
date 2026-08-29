import * as assert from "assert";
import { SyncEngine } from "../app/syncEngine";
import { SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import { initializeOfflineSyncStore, addOfflineTicketUpdateAsync, addOfflineNewTicketAsync } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";

suite("RT-02: Sync Lifecycle Ownership (syncLifecycleOwnership.test.ts)", () => {
  const scope = "test-scope-rt-02";

  test("RT-02: SyncEngine.syncOne (ticket, newTicket, comment) がすべて SyncCoordinator を経由して実行されること", async () => {
    initializeOfflineSyncStore(createTestMemento(), scope);
    const syncedKeys: any[] = [];

    class StubCoordinator extends SyncCoordinator {
      public override async sync(key: any, context: any, options?: any): Promise<any> {
        syncedKeys.push(key);
        return { kind: "completed", ticketId: key.ticketId ?? 999 };
      }
    }

    const coordinator = new StubCoordinator();
    const engine = new SyncEngine({ coordinator });

    // 1. Comment Sync One
    const commentOutcome = await engine.syncOne(
      { kind: "comment", ticketId: 10, commentId: 20 },
      { connectionScope: scope },
    );
    assert.strictEqual(commentOutcome.kind, "completed");

    // 2. Ticket Sync One
    const ticketOutcome = await engine.syncOne(
      { kind: "ticket", ticketId: 100 },
      { connectionScope: scope },
    );
    assert.strictEqual(ticketOutcome.kind, "completed");

    // 3. NewTicket Sync One
    const newTicketOutcome = await engine.syncOne(
      { kind: "newTicket", queueId: "queue-1" },
      { connectionScope: scope },
    );
    assert.strictEqual(newTicketOutcome.kind, "completed");

    assert.strictEqual(syncedKeys.length, 3, "すべての syncOne が Coordinator に到達すること");
    assert.strictEqual(syncedKeys[0].kind, "comment");
    assert.strictEqual(syncedKeys[1].kind, "ticket");
    assert.strictEqual(syncedKeys[2].kind, "newTicket");
  });

  test("RT-02: SyncEngine.syncAll が SyncCoordinator.syncAll を経由して実行されること", async () => {
    let syncAllCalled = false;

    class StubCoordinator extends SyncCoordinator {
      public override async syncAll(context: any, options?: any): Promise<any> {
        syncAllCalled = true;
        return {
          plan: [{ kind: "ticket", ticketId: 100 }],
          results: [{ key: { kind: "ticket", ticketId: 100 }, outcome: { kind: "completed", ticketId: 100 } }],
          remaining: [],
          cancelled: false,
        };
      }
    }

    const coordinator = new StubCoordinator();
    const engine = new SyncEngine({ coordinator });

    const outcome = await engine.syncAll({ connectionScope: scope });
    assert.strictEqual(syncAllCalled, true, "SyncCoordinator.syncAll() が呼ばれること");
    assert.strictEqual(outcome.results.length, 1);
    assert.strictEqual(outcome.results[0].outcome.kind, "completed");
  });
});
