import * as assert from "assert";
import {
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  replaceOfflineSyncQueueAsync,
  type OfflineNewTicket,
  type OfflineTicketUpdate,
} from "../views/offlineSyncStore";
import {
  createSyncOperationRepository,
  withAttemptGenerationFence,
} from "../app/ticketSync/syncRepository";
import { createSyncEngine } from "../app/syncEngine";
import {
  isAttemptClosureSafe,
  type DurableSyncEffect,
} from "../app/syncEffects";
import { SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import type { TicketUpdateIntent, SyncOperationKey } from "../app/ticketSync/syncOperationTypes";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { createTestMemento, type TestMemento } from "./helpers/vscodeMemento";

const SCOPE = "https://redmine.example.org/attempt-closure-p1-suite/";

const parentContent = buildTicketEditorContent({
  subject: "Parent",
  description: "Description",
  metadata: {
    tracker: "Bug",
    priority: "Normal",
    status: "New",
    due_date: "",
    children: [],
  },
});

const makeOperation = (): OfflineNewTicket => ({
  queueId: "p1-reproduction",
  operationId: `${SCOPE}:newTicket:p1-reproduction`,
  content: parentContent,
  projectId: 1,
  phase: "remote_created" as any,
  createdIssueId: 500,
  revision: 1,
  attemptGeneration: 1,
  effects: [
    {
      effectId: "ticket-create",
      kind: "ticket_create",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "committed",
      remoteId: 500,
      target: {},
    },
    {
      effectId: "child-create:0",
      kind: "child_create",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "committed",
      remoteId: 501,
      target: { parentTicketId: 500, ordinal: 0 },
    },
    {
      effectId: "child-create:1",
      kind: "child_create",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "failed",
      failure: { disposition: "non_retriable", detail: "known child failure" },
      target: { parentTicketId: 500, ordinal: 1 },
    },
  ],
});

suite("Attempt Closure P1 reproduction", () => {
  setup(() => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
  });

  test("Child compensation_unknown が残る間は Parent compensated でも Attempt を閉じない", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push(makeOperation());
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId: "p1-reproduction" };

    const childCompensationStarted = await repository.transitionEffect(
      key,
      "child-create:0",
      { kind: "start_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "committed" },
    );
    assert.ok(childCompensationStarted);

    const childCompensationUnknown = await repository.transitionEffect(
      key,
      "child-create:0",
      { kind: "mark_compensation_unknown", detail: "DELETE timeout" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_started" },
    );
    assert.ok(childCompensationUnknown);

    const parentCompensationStarted = await repository.transitionEffect(
      key,
      "ticket-create",
      { kind: "start_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "committed" },
    );
    assert.ok(parentCompensationStarted);

    const afterParentCompensation = await repository.transitionEffect(
      key,
      "ticket-create",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_started" },
    );
    assert.ok(afterParentCompensation);

    assert.strictEqual(afterParentCompensation?.attemptGeneration, 1);
    assert.strictEqual(afterParentCompensation?.createdRemoteId, 500);
    assert.strictEqual(
      afterParentCompensation?.effects?.find((effect) => effect.effectId === "child-create:0")?.state,
      "compensation_unknown",
    );
    assert.strictEqual(afterParentCompensation?.effects?.find((effect) => effect.effectId === "ticket-create")?.state, "compensated");
  });

  test("Current Generation の terminal-safe state matrix を境界値で固定する", () => {
    const cases: Array<[DurableSyncEffect["state"], boolean]> = [
      ["planned", true],
      ["failed", true],
      ["compensated", true],
      ["started", false],
      ["commit_unknown", false],
      ["compensation_started", false],
      ["compensation_unknown", false],
      ["committed", false],
    ];

    for (const [state, expected] of cases) {
      const effect: DurableSyncEffect = {
        effectId: `child-${state}`,
        kind: "child_create",
        operationRevision: 1,
        attemptGeneration: 1,
        state,
        target: {},
      };
      assert.strictEqual(isAttemptClosureSafe([effect]), expected, `${state} の closure 判定`);
    }
  });

  test("Secondary compensation が完了するまで閉じず、最後の完了で一度だけ次世代へ進む", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId: "secondary-recovery",
      operationId: `${SCOPE}:newTicket:secondary-recovery`,
      phase: "remote_created" as any,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 500,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensation_unknown",
          remoteId: 501,
          target: { parentTicketId: 500, ordinal: 0 },
        },
        {
          effectId: "child-create:1",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensation_unknown",
          remoteId: 502,
          target: { parentTicketId: 500, ordinal: 1 },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId: "secondary-recovery" };
    const first = await repository.transitionEffect(
      key,
      "child-create:1",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_unknown" },
    );
    assert.ok(first);
    assert.strictEqual(first?.attemptGeneration, 1);
    assert.strictEqual(first?.createdRemoteId, 500);
    assert.strictEqual(first?.effects?.length, 3);

    const closed = await repository.transitionEffect(
      key,
      "child-create:0",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_unknown" },
    );
    assert.ok(closed);
    assert.strictEqual(closed?.attemptGeneration, 2);
    assert.strictEqual(closed?.phase, "queued");
    assert.strictEqual(closed?.createdRemoteId, undefined);
    assert.deepStrictEqual(closed?.effects, []);
  });

  test("Closure時に nextIntent の revision と exact fields をそのまま昇格する", async () => {
    const metadata = {
      tracker: "Bug",
      priority: "High",
      status: "In Progress",
      due_date: "2026-12-31",
      children: ["Next child"],
    };
    const nextContent = "# Next exact content\n\nBody\n";
    const nextIntent: OfflineTicketUpdate["nextIntent"] = {
      revision: 7,
      subject: "Next subject",
      description: "Next description",
      content: nextContent,
      metadata,
      layout: "subject-first",
      metadataBlock: "present",
      controlFields: { mode: "ticket-update", issue_id: 42, project_id: 9 },
      baseDir: "/workspace/next",
      documentUri: "file:///workspace/next.md",
    };
    const current: OfflineTicketUpdate = {
      ticketId: 42,
      operationId: `${SCOPE}:ticket:42`,
      phase: "remote_committed",
      revision: 1,
      attemptGeneration: 1,
      baseSubject: "Old subject",
      baseDescription: "Old description",
      baseMetadata: metadata,
      subject: "Old subject",
      description: "Old description",
      content: "# Old exact content\n",
      metadata,
      layout: "metadata-first",
      metadataBlock: "present",
      controlFields: { mode: "ticket-update", issue_id: 42, project_id: 1 },
      baseDir: "/workspace/old",
      documentUri: "file:///workspace/old.md",
      nextIntent,
      effects: [{
        effectId: "ticket-update",
        kind: "ticket_update",
        operationRevision: 1,
        attemptGeneration: 1,
        state: "committed",
        remoteId: 42,
        target: { ticketId: 42 },
      }],
    };
    const queue = getOfflineSyncQueue(SCOPE);
    queue.tickets.set(42, current);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    const key: SyncOperationKey = { kind: "ticket", ticketId: 42 };
    const started = await repository.transitionEffect(
      key,
      "ticket-update",
      { kind: "start_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "committed" },
    );
    assert.ok(started);
    const closed = await repository.transitionEffect(
      key,
      "ticket-update",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_started" },
    );
    assert.ok(closed);

    const promoted = repository.getOperation<TicketUpdateIntent>(key, SCOPE);
    assert.ok(promoted);
    assert.strictEqual(promoted?.attemptGeneration, 2);
    assert.strictEqual(promoted?.revision, 7);
    assert.strictEqual(promoted?.intentRevision, 7);
    assert.strictEqual(promoted?.phase, "queued");
    assert.strictEqual(promoted?.nextIntent, undefined);
    assert.strictEqual(promoted?.documentUri, nextIntent.documentUri);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).subject, nextIntent.subject);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).description, nextIntent.description);
    assert.deepStrictEqual((promoted?.intent as TicketUpdateIntent).metadata, metadata);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).content, nextContent);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).layout, nextIntent.layout);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).metadataBlock, nextIntent.metadataBlock);
    assert.deepStrictEqual((promoted?.intent as TicketUpdateIntent).controlFields, nextIntent.controlFields);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).baseDir, nextIntent.baseDir);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).documentUri, nextIntent.documentUri);
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).baseSubject, "Old subject");
    assert.strictEqual((promoted?.intent as TicketUpdateIntent).baseDescription, "Old description");
  });

  test("Closure後の stale Secondary recovery は remote/persistence を発生させない", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId: "stale-secondary",
      operationId: `${SCOPE}:newTicket:stale-secondary`,
      phase: "remote_created" as any,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 600,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensation_unknown",
          remoteId: 601,
          target: { parentTicketId: 600, ordinal: 0 },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    await repository.transitionEffect(
      { kind: "newTicket", queueId: "stale-secondary" },
      "child-create:0",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_unknown" },
    );
    const before = getOfflineSyncQueue(SCOPE).newTickets.find((ticket) => ticket.queueId === "stale-secondary");
    assert.strictEqual(before?.attemptGeneration, 2);
    const staleSnapshot = JSON.stringify(before);
    let deleteCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        deleteIssue: async () => {
          deleteCalls++;
        },
      },
    });
    const stale = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: "stale-secondary" },
      operationId: `${SCOPE}:newTicket:stale-secondary`,
      operationRevision: 1,
      attemptGeneration: 1,
      effectId: "child-create:0",
      expectedEffectState: "compensation_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" },
    });
    assert.strictEqual(stale.kind, "failed_before_commit");
    assert.strictEqual(deleteCalls, 0);
    assert.strictEqual(
      JSON.stringify(getOfflineSyncQueue(SCOPE).newTickets.find((ticket) => ticket.queueId === "stale-secondary")),
      staleSnapshot,
    );
  });

  test("Core Recovery は operation identity と generation の省略を拒否する", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId: "core-identity",
      operationId: `${SCOPE}:newTicket:core-identity`,
      phase: "commit_unknown" as any,
      effects: [{
        effectId: "ticket-create",
        kind: "ticket_create",
        operationRevision: 1,
        attemptGeneration: 1,
        state: "commit_unknown",
        target: {},
      }],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);
    const before = JSON.stringify(getOfflineSyncQueue(SCOPE).newTickets);
    const coordinator = new SyncCoordinator({ repository: createSyncOperationRepository() });
    const outcome = await (coordinator.resolveCommitUnknown as (input: Record<string, unknown>) => Promise<{ kind: string }>)({
      key: { kind: "newTicket", queueId: "core-identity" },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });
    assert.strictEqual(outcome.kind, "failed_before_commit");
    assert.strictEqual(JSON.stringify(getOfflineSyncQueue(SCOPE).newTickets), before);
  });

  test("Old generation の fenced delete は Current Attempt を削除しない", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId: "delete-fence",
      operationId: `${SCOPE}:newTicket:delete-fence`,
      attemptGeneration: 2,
      phase: "queued",
      effects: [],
      createdIssueId: undefined,
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId: "delete-fence" };
    const staleDelete = await withAttemptGenerationFence(repository, 1).deleteOperation(key, SCOPE);
    assert.strictEqual(staleDelete, false);
    assert.ok(getOfflineSyncQueue(SCOPE).newTickets.some((ticket) => ticket.queueId === "delete-fence"));
  });

  test("Compensation persistence failure は remote evidence を消去せず同一世代に留める", async () => {
    const backing = createTestMemento();
    let failWrites = false;
    const storage: TestMemento = {
      get: backing.get,
      keys: backing.keys,
      update: async (key, value) => {
        if (failWrites) {
          throw new Error("Memento write failed");
        }
        await backing.update(key, value);
      },
    };
    initializeOfflineSyncStore(storage, SCOPE);
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...makeOperation(),
      queueId: "persistence-failure",
      operationId: `${SCOPE}:newTicket:persistence-failure`,
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const repository = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId: "persistence-failure" };
    const started = await repository.transitionEffect(
      key,
      "child-create:0",
      { kind: "start_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "committed" },
    );
    assert.ok(started);
    failWrites = true;
    const completed = await repository.transitionEffect(
      key,
      "child-create:0",
      { kind: "complete_compensation" },
      SCOPE,
      { operationRevision: 1, attemptGeneration: 1, sourceState: "compensation_started" },
    );
    assert.strictEqual(completed, undefined);
    const afterFailure = repository.getOperation(key, SCOPE);
    assert.strictEqual(afterFailure?.attemptGeneration, 1);
    assert.strictEqual(afterFailure?.createdRemoteId, 500);
    assert.strictEqual(
      afterFailure?.effects?.find((effect) => effect.effectId === "child-create:0")?.state,
      "compensation_started",
    );
  });

  test("Closure後の New Attempt は new Parent ID を Child CREATE に渡す", async () => {
    const content = buildTicketEditorContent({
      subject: "Parent after rollback",
      description: "Description",
      metadata: {
        tracker: "Bug",
        priority: "Normal",
        status: "New",
        due_date: "",
        children: ["Child after rollback"],
      },
    });
    const storage = createTestMemento();
    initializeOfflineSyncStore(storage, SCOPE);
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "new-attempt-e2e",
      operationId: `${SCOPE}:newTicket:new-attempt-e2e`,
      content,
      projectId: 1,
      phase: "remote_created" as any,
      createdIssueId: 800,
      revision: 1,
      attemptGeneration: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          remoteId: 800,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensation_unknown",
          remoteId: 801,
          target: { parentTicketId: 800, ordinal: 0 },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const createdInputs: Array<{ subject?: string; parentId?: number }> = [];
    let nextId = 900;
    const createEngine = () => createSyncEngine({
      tickets: {
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
        createIssue: async (input: { subject?: string; parentId?: number }) => {
          createdInputs.push(input);
          nextId++;
          return nextId;
        },
        getIssueDetail: async (id: number) => {
          if (id === 801) {
            const error = Object.assign(new Error("404 Not Found"), { status: 404 });
            throw error;
          }
          return {
            ticket: {
              id,
              projectId: 1,
              subject: createdInputs.find((input) => input.parentId === undefined)?.subject ?? "Parent after rollback",
            },
            comments: [],
          };
        },
      },
    });
    const firstEngine = createEngine();
    const recovered = await firstEngine.resolveEffect({
      key: { kind: "newTicket", queueId: "new-attempt-e2e" },
      operationId: `${SCOPE}:newTicket:new-attempt-e2e`,
      operationRevision: 1,
      attemptGeneration: 1,
      effectId: "child-create:0",
      expectedEffectState: "compensation_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" },
    });
    assert.strictEqual(recovered.kind, "queued");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).newTickets[0]?.attemptGeneration, 2);

    initializeOfflineSyncStore(storage, SCOPE);
    const outcome = await createEngine().syncOne(
      { kind: "newTicket", queueId: "new-attempt-e2e" },
      { connectionScope: SCOPE },
    );
    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(createdInputs.length, 2);
    assert.strictEqual(createdInputs[0]?.parentId, undefined);
    assert.strictEqual(createdInputs[1]?.parentId, nextId - 1);
  });
});
