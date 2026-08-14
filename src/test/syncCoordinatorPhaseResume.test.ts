import * as assert from "assert";
import { SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import { OperationHandler } from "../app/ticketSync/operationHandlers";
import { SyncOperationRepository } from "../app/ticketSync/syncRepository";
import { UnifiedSyncOperation, TicketUpdateIntent } from "../app/ticketSync/syncOperationTypes";

suite("RT-D: SyncCoordinator Phase Resume Matrix (syncCoordinatorPhaseResume.test.ts)", () => {
  const scope = "test-scope-rt-d";

  class MockRepository implements SyncOperationRepository {
    public op: UnifiedSyncOperation | undefined;

    public getOperation(): UnifiedSyncOperation | undefined {
      return this.op;
    }
    public listOperations(): UnifiedSyncOperation[] {
      return this.op ? [this.op] : [];
    }
    public async saveOperation(operation: UnifiedSyncOperation): Promise<UnifiedSyncOperation> {
      this.op = operation;
      return operation;
    }
    public async transitionOperation(key: any, action: any): Promise<UnifiedSyncOperation | undefined> {
      if (!this.op) {return undefined;}
      let nextPhase = this.op.phase;
      if (action.kind === "begin_preparation") {nextPhase = "preparing";}
      if (action.kind === "start_normal_remote_write") {nextPhase = "remote_write_started";}
      if (action.kind === "record_remote_commit") {nextPhase = "remote_committed";}
      if (action.kind === "mark_reconciliation_pending") {nextPhase = "reconciliation_pending";}
      if (action.kind === "mark_local_finalize_pending") {nextPhase = "local_finalize_pending";}
      if (action.kind === "record_reconciled_identity") {nextPhase = "local_finalize_pending";}
      if (action.kind === "complete") {nextPhase = "completed";}
      this.op = { ...this.op, phase: nextPhase, version: (this.op.version ?? 1) + 1 };
      return this.op;
    }
    public async completeOperation(): Promise<boolean> {
      if (this.op) {this.op = { ...this.op, phase: "completed" };}
      return true;
    }
    public async deleteOperation(): Promise<boolean> {
      this.op = undefined;
      return true;
    }
  }

  test("RT-D: remote_committed / reconciliation_pending からの再開は remote write を再実行せず reconcile のみ行うこと", async () => {
    const repo = new MockRepository();
    let writeCalls = 0;
    let reconcileCalls = 0;
    let finalizeCalls = 0;

    const mockHandler: OperationHandler = {
      prepare: async () => ({ ok: true, prepared: {} }),
      executeRemoteWrite: async () => {
        writeCalls++;
        return { ok: true, createdRemoteId: 100 };
      },
      reconcileRemote: async () => {
        reconcileCalls++;
        return { ok: true, remoteId: 100, canonical: {} };
      },
      finalizeLocal: async () => {
        finalizeCalls++;
        return { ok: true };
      },
    };

    const coordinator = new SyncCoordinator({
      repository: repo,
      handlers: {
        ticketUpdate: mockHandler,
      },
    });

    const op: UnifiedSyncOperation<TicketUpdateIntent> = {
      operationId: `${scope}:ticket:100`,
      kind: "ticket_update",
      key: { kind: "ticket", ticketId: 100 },
      connectionScope: scope,
      phase: "remote_committed",
      revision: 1,
      intentRevision: 1,
      version: 2,
      persistenceVersion: 2,
      ticketId: 100,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    repo.op = op;

    const outcome = await coordinator.sync(
      { kind: "ticket", ticketId: 100 },
      { connectionScope: scope },
    );

    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(writeCalls, 0, "remote write は再実行されないこと (INV-08)");
    assert.strictEqual(reconcileCalls, 1, "reconcile が実行されること");
    assert.strictEqual(finalizeCalls, 1, "finalize が実行されること");
  });

  test("RT-D: local_finalize_pending からの再開は finalize のみ行うこと", async () => {
    const repo = new MockRepository();
    let writeCalls = 0;
    let reconcileCalls = 0;
    let finalizeCalls = 0;

    const mockHandler: OperationHandler = {
      prepare: async () => ({ ok: true, prepared: {} }),
      executeRemoteWrite: async () => {
        writeCalls++;
        return { ok: true, createdRemoteId: 100 };
      },
      reconcileRemote: async () => {
        reconcileCalls++;
        return { ok: true, remoteId: 100, canonical: {} };
      },
      finalizeLocal: async () => {
        finalizeCalls++;
        return { ok: true };
      },
    };

    const coordinator = new SyncCoordinator({
      repository: repo,
      handlers: {
        ticketUpdate: mockHandler,
      },
    });

    const op: UnifiedSyncOperation<TicketUpdateIntent> = {
      operationId: `${scope}:ticket:100`,
      kind: "ticket_update",
      key: { kind: "ticket", ticketId: 100 },
      connectionScope: scope,
      phase: "local_finalize_pending",
      revision: 1,
      intentRevision: 1,
      version: 3,
      persistenceVersion: 3,
      ticketId: 100,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    repo.op = op;

    const outcome = await coordinator.sync(
      { kind: "ticket", ticketId: 100 },
      { connectionScope: scope },
    );

    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(writeCalls, 0, "remote write は実行されないこと");
    assert.strictEqual(reconcileCalls, 0, "reconcile は再実行されないこと");
    assert.strictEqual(finalizeCalls, 1, "finalize が実行されること");
  });

  test("RT-D: commit_unknown の場合は通常の sync() から自動再送されず recovery_required を返すこと", async () => {
    const repo = new MockRepository();
    let writeCalls = 0;

    const mockHandler: OperationHandler = {
      prepare: async () => ({ ok: true, prepared: {} }),
      executeRemoteWrite: async () => {
        writeCalls++;
        return { ok: true };
      },
      reconcileRemote: async () => ({ ok: true }),
      finalizeLocal: async () => ({ ok: true }),
    };

    const coordinator = new SyncCoordinator({
      repository: repo,
      handlers: {
        ticketUpdate: mockHandler,
      },
    });

    const op: UnifiedSyncOperation<TicketUpdateIntent> = {
      operationId: `${scope}:ticket:100`,
      kind: "ticket_update",
      key: { kind: "ticket", ticketId: 100 },
      connectionScope: scope,
      phase: "commit_unknown",
      revision: 1,
      intentRevision: 1,
      version: 2,
      persistenceVersion: 2,
      ticketId: 100,
      errorMessage: "Network timeout",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    repo.op = op;

    const outcome = await coordinator.sync(
      { kind: "ticket", ticketId: 100 },
      { connectionScope: scope },
    );

    assert.strictEqual(outcome.kind, "commit_unknown");
    assert.strictEqual(writeCalls, 0, "自動再送されないこと (INV-04)");
  });
});
