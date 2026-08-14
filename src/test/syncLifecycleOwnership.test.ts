import * as assert from "assert";
import { SyncEngine } from "../app/syncEngine";
import { SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import { UnifiedSyncOperation, CommentCreateIntent } from "../app/ticketSync/syncOperationTypes";

suite("RT-B: Sync Lifecycle Ownership (syncLifecycleOwnership.test.ts)", () => {
  const scope = "test-scope-rt-b";

  test("RT-B: SyncEngine.syncOne が SyncCoordinator を経由して実行されること", async () => {
    let coordinatorCalled = false;

    class StubCoordinator extends SyncCoordinator {
      public override async sync(key: any, context: any, options?: any): Promise<any> {
        coordinatorCalled = true;
        return { kind: "completed", ticketId: 123 };
      }
    }

    const coordinator = new StubCoordinator();
    const engine = new SyncEngine({ coordinator });

    const outcome = await engine.syncOne(
      { kind: "comment", ticketId: 123, commentId: 456 },
      { connectionScope: scope },
    );

    assert.strictEqual(coordinatorCalled, true, "SyncCoordinator.sync() が呼ばれること");
    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual((outcome as any).ticketId, 123);
  });
});
