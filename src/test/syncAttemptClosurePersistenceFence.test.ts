import * as assert from "assert";
import {
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  replaceOfflineSyncQueueAsync,
  type OfflineNewTicket,
} from "../views/offlineSyncStore";
import {
  createSyncOperationRepository,
  withAttemptGenerationFence,
} from "../app/ticketSync/syncRepository";
import { createTestMemento, type TestMemento } from "./helpers/vscodeMemento";

const SCOPE = "https://redmine.example.org/attempt-closure-persistence-fence/";

const makeTicket = (queueId: string, phase: OfflineNewTicket["phase"] = "remote_created"): OfflineNewTicket => ({
  queueId,
  operationId: `${SCOPE}:newTicket:${queueId}`,
  content: "# Parent\n\nDescription",
  projectId: 1,
  phase,
  createdIssueId: 700,
  revision: 1,
  attemptGeneration: 1,
  effects: [
    {
      effectId: "ticket-create",
      kind: "ticket_create",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "compensated",
      remoteId: 700,
      target: {},
      requestSnapshot: {
        kind: "ticket_create",
        request: {
          projectId: 1,
          subject: "Parent",
          description: "Description",
        },
      },
    },
    {
      effectId: "child-create:failed",
      kind: "child_create",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "failed",
      failure: { disposition: "non_retriable", detail: "known child failure" },
      target: { parentTicketId: 700 },
    },
  ],
});

const createFailingMemento = (): { memento: TestMemento; setFailWrites: (value: boolean) => void; getWrites: () => number } => {
  const backing = createTestMemento();
  let failWrites = false;
  let writes = 0;
  return {
    memento: {
      get: backing.get,
      keys: backing.keys,
      update: async (key, value) => {
        writes++;
        if (failWrites) {
          throw new Error("Memento write failed");
        }
        await backing.update(key, value);
      },
    },
    setFailWrites: (value) => {
      failWrites = value;
    },
    getWrites: () => writes,
  };
};

suite("Attempt Closure persistence fence", () => {
  setup(() => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
  });

  test("削除済み Operation への fenced save/plan は persistence 0 で拒否する", async () => {
    const persistence = createFailingMemento();
    initializeOfflineSyncStore(persistence.memento, SCOPE);
    const queueId = "deleted-operation";
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push(makeTicket(queueId));
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId };
    const snapshot = repository.getOperation(key, SCOPE);
    assert.ok(snapshot);

    assert.strictEqual(await repository.deleteOperation(key, SCOPE), true);
    const writesAfterDelete = persistence.getWrites();

    const fenced = withAttemptGenerationFence(repository, 1);
    const staleSave = await fenced.saveOperation(snapshot!, SCOPE);
    assert.strictEqual(staleSave, undefined);
    const stalePlan = await fenced.planEffect(
      key,
      {
        effectId: "child-create:stale",
        kind: "child_create",
        operationRevision: 1,
        attemptGeneration: 1,
        state: "planned",
        target: { parentTicketId: 700 },
      },
      SCOPE,
      1,
    );
    assert.strictEqual(stalePlan, undefined);
    assert.strictEqual(repository.getOperation(key, SCOPE), undefined);
    assert.strictEqual(persistence.getWrites(), writesAfterDelete);
  });

  test("completeOperation の永続化失敗では completed cache を公開しない", async () => {
    const failing = createFailingMemento();
    initializeOfflineSyncStore(failing.memento, SCOPE);
    const queueId = "completed-cache-failure";
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push(makeTicket(queueId, "local_finalize_pending"));
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId };
    failing.setFailWrites(true);
    assert.strictEqual(await repository.completeOperation(key, SCOPE, 1, undefined, 1), false);

    failing.setFailWrites(false);
    assert.strictEqual(await repository.deleteOperation(key, SCOPE), true);
    assert.strictEqual(repository.getOperation(key, SCOPE), undefined);
    assert.ok(failing.getWrites() > 0);
  });

  test("Primary compensated の closure retry は同じ atomic closure を再実行できる", async () => {
    const queueId = "closure-retry";
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push(makeTicket(queueId));
    await replaceOfflineSyncQueueAsync(queue, SCOPE);
    const repository = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId };

    const closed = await repository.transitionEffect(
      key,
      "ticket-create",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensated" },
    );

    assert.ok(closed);
    assert.strictEqual(closed?.attemptGeneration, 2);
    assert.strictEqual(closed?.phase, "queued");
    assert.strictEqual(closed?.createdRemoteId, undefined);
    assert.deepStrictEqual(closed?.effects, []);
  });

  test("closure retry の persistence failure 後も同じ identity で再試行できる", async () => {
    const failing = createFailingMemento();
    initializeOfflineSyncStore(failing.memento, SCOPE);
    const queueId = "closure-retry-after-failure";
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push(makeTicket(queueId));
    await replaceOfflineSyncQueueAsync(queue, SCOPE);
    const repository = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId };

    failing.setFailWrites(true);
    assert.strictEqual(
      await repository.transitionEffect(
        key,
        "ticket-create",
        { kind: "complete_compensation" },
        SCOPE,
        { operationRevision: 1, attemptGeneration: 1, sourceState: "compensated" },
      ),
      undefined,
    );
    failing.setFailWrites(false);

    const closed = await repository.transitionEffect(
      key,
      "ticket-create",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensated" },
    );
    assert.ok(closed);
    assert.strictEqual(closed?.attemptGeneration, 2);
    assert.strictEqual(closed?.createdRemoteId, undefined);
    assert.deepStrictEqual(closed?.effects, []);
  });
});
