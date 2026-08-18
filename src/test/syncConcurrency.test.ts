import * as assert from "assert";
import { SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import { createSyncOperationRepository } from "../app/ticketSync/syncRepository";
import { UnifiedSyncOperation, TicketUpdateIntent } from "../app/ticketSync/syncOperationTypes";
import { initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";

suite("RT-08: Concurrency and CAS Safety (syncConcurrency.test.ts)", () => {
  const scope = "test-scope-rt-08";

  test("RT-08: 同一 operation への並行 sync 呼び出しが single-flight でロックされ、1回のみ remote write を実行すること", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, scope);
    const repo = createSyncOperationRepository();

    let writeCount = 0;
    let releaseWrite!: () => void;
    const writeBlocked = new Promise<void>((resolve) => { releaseWrite = resolve; });

    const mockHandler: any = {
      prepare: async () => ({ ok: true, prepared: {} }),
      executeRemoteWrite: async (op: any) => {
        writeCount++;
        await repo.transitionPrimaryRemoteWrite(op.key, { kind: "start", requestSnapshot: { kind: "ticket_update", request: { issueId: 105, fields: {} } } }, scope, { operationId: op.operationId, revision: 1, sourcePhase: op.phase });
        await writeBlocked;
        await repo.transitionPrimaryRemoteWrite(op.key, { kind: "commit", remoteId: 105, requestSnapshot: { kind: "ticket_update", request: { issueId: 105, fields: {} } } }, scope, { operationId: op.operationId, revision: 1, sourcePhase: "remote_write_started" });
        return { ok: true, createdRemoteId: 105 };
      },
      reconcileRemote: async () => ({ ok: true, remoteId: 105, canonical: {} }),
      finalizeLocal: async () => ({ ok: true }),
    };

    const coordinator = new SyncCoordinator({
      repository: repo,
      handlers: { ticketUpdate: mockHandler },
    });

    const op: UnifiedSyncOperation<TicketUpdateIntent> = {
      operationId: `${scope}:ticket:105`,
      kind: "ticket_update",
      key: { kind: "ticket", ticketId: 105 },
      connectionScope: scope,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
      version: 1,
      persistenceVersion: 1,
      ticketId: 105,
      intent: {
        ticketId: 105,
        baseSubject: "Test",
        baseDescription: "Desc",
        baseMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
        subject: "Test",
        description: "Desc",
        metadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await repo.saveOperation(op, scope);

    const call1 = coordinator.sync({ kind: "ticket", ticketId: 105 }, { connectionScope: scope });
    const call2 = coordinator.sync({ kind: "ticket", ticketId: 105 }, { connectionScope: scope });

    releaseWrite();
    const [res1, res2] = await Promise.all([call1, call2]);

    assert.strictEqual(res1.kind, "completed");
    assert.strictEqual(res2.kind, "completed");
    assert.strictEqual(writeCount, 1, "remote write は single-flight により1回のみ実行されること (INV-02)");
  });

  test("RT-08: 実行中の編集 (nextIntent) が存在する場合、finalize 成功後に nextIntent が新世代の queued operation として昇格すること", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, scope);
    const repo = createSyncOperationRepository();

    const nextIntent: TicketUpdateIntent = {
      ticketId: 106,
      baseSubject: "Initial",
      baseDescription: "Initial",
      baseMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
      subject: "Edited While Writing",
      description: "Second Edit",
      metadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
    };

    const mockHandler: any = {
      prepare: async () => ({ ok: true, prepared: {} }),
      executeRemoteWrite: async (op: any) => {
        await repo.transitionPrimaryRemoteWrite(op.key, { kind: "start", requestSnapshot: { kind: "ticket_update", request: { issueId: 106, fields: {} } } }, scope, { operationId: op.operationId, revision: 1, sourcePhase: op.phase });
        await repo.transitionPrimaryRemoteWrite(op.key, { kind: "commit", remoteId: 106, requestSnapshot: { kind: "ticket_update", request: { issueId: 106, fields: {} } } }, scope, { operationId: op.operationId, revision: 1, sourcePhase: "remote_write_started" });
        return { ok: true, createdRemoteId: 106 };
      },
      reconcileRemote: async () => ({ ok: true, remoteId: 106, canonical: {} }),
      finalizeLocal: async () => ({ ok: true }),
    };

    const coordinator = new SyncCoordinator({
      repository: repo,
      handlers: { ticketUpdate: mockHandler },
    });

    const op: UnifiedSyncOperation<TicketUpdateIntent> = {
      operationId: `${scope}:ticket:106`,
      kind: "ticket_update",
      key: { kind: "ticket", ticketId: 106 },
      connectionScope: scope,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
      version: 1,
      persistenceVersion: 1,
      ticketId: 106,
      intent: {
        ticketId: 106,
        baseSubject: "Initial",
        baseDescription: "Initial",
        baseMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
        subject: "Initial",
        description: "Initial",
        metadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
      },
      nextIntent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await repo.saveOperation(op, scope);

    const outcome = await coordinator.sync({ kind: "ticket", ticketId: 106 }, { connectionScope: scope });
    assert.strictEqual(outcome.kind, "completed");

    // nextIntent が昇格されて queued な operation として保存されていること (INV-15)
    const nextOp = repo.getOperation({ kind: "ticket", ticketId: 106 }, scope);
    assert.ok(nextOp, "nextIntent が昇格してキューに残っていること");
    assert.strictEqual(nextOp.phase, "queued");
    assert.strictEqual((nextOp.intent as TicketUpdateIntent)?.subject, "Edited While Writing");
  });
});
