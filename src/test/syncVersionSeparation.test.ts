import * as assert from "assert";
import { DefaultSyncOperationRepository } from "../app/ticketSync/syncRepository";
import { UnifiedSyncOperation, TicketUpdateIntent } from "../app/ticketSync/syncOperationTypes";
import { clearOfflineSyncQueueAsync, initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";

suite("RT-E: Version & IntentRevision Separation (syncVersionSeparation.test.ts)", () => {
  const scope = "test-scope-rt-e";

  setup(async () => {
    initializeOfflineSyncStore(createTestMemento(), scope);
    await clearOfflineSyncQueueAsync(scope);
  });

  test("RT-E: 状態遷移を繰り返しても intentRevision は不変であり CAS version のみが増加すること", async () => {
    const repo = new DefaultSyncOperationRepository();

    const intent: TicketUpdateIntent = {
      ticketId: 200,
      baseSubject: "Sub",
      baseDescription: "Desc",
      baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", start_date: "", due_date: "", children: [] },
      subject: "Sub updated",
      description: "Desc updated",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", start_date: "", due_date: "", children: [] },
    };

    const initialOp: UnifiedSyncOperation<TicketUpdateIntent> = {
      operationId: `${scope}:ticket:200`,
      kind: "ticket_update",
      key: { kind: "ticket", ticketId: 200 },
      connectionScope: scope,
      phase: "queued",
      revision: 10,
      intentRevision: 10,
      version: 1,
      persistenceVersion: 1,
      ticketId: 200,
      intent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await repo.saveOperation(initialOp, scope);

    // 1. begin_preparation
    let op = await repo.transitionOperation({ kind: "ticket", ticketId: 200 }, { kind: "begin_preparation" }, scope);
    assert.ok(op);
    assert.strictEqual(op?.phase, "preparing");
    assert.strictEqual(op?.intentRevision, 10, "intentRevision は 10 のまま");
    assert.strictEqual(op?.version, 2, "version は 2 に増加");

    // 2. start_normal_remote_write
    op = await repo.transitionOperation({ kind: "ticket", ticketId: 200 }, { kind: "start_normal_remote_write" }, scope);
    assert.ok(op);
    assert.strictEqual(op?.phase, "remote_write_started");
    assert.strictEqual(op?.intentRevision, 10, "intentRevision は 10 のまま");
    assert.strictEqual(op?.version, 3, "version は 3 に増加");

    // 3. record_remote_commit
    op = await repo.transitionOperation({ kind: "ticket", ticketId: 200 }, { kind: "record_remote_commit", remoteUpdatedAt: "2026-08-14T00:00:00Z" }, scope);
    assert.ok(op);
    assert.strictEqual(op?.phase, "remote_committed");
    assert.strictEqual(op?.intentRevision, 10, "intentRevision は 10 のまま");
    assert.strictEqual(op?.version, 4, "version は 4 に増加");

    // 4. mark_reconciliation_pending
    op = await repo.transitionOperation({ kind: "ticket", ticketId: 200 }, { kind: "mark_reconciliation_pending" }, scope);
    assert.ok(op);
    assert.strictEqual(op?.phase, "reconciliation_pending");
    assert.strictEqual(op?.intentRevision, 10, "intentRevision は 10 のまま");
    assert.strictEqual(op?.version, 5, "version は 5 に増加");

    // 5. mark_local_finalize_pending
    op = await repo.transitionOperation({ kind: "ticket", ticketId: 200 }, { kind: "mark_local_finalize_pending" }, scope);
    assert.ok(op);
    assert.strictEqual(op?.phase, "local_finalize_pending");
    assert.strictEqual(op?.intentRevision, 10, "intentRevision は 10 のまま (INV-07)");
    assert.strictEqual(op?.version, 6, "version は 6 に増加");
  });
});
