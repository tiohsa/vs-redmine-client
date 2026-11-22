import * as assert from "assert";
import { getEffectsForRevision } from "../app/syncEffects";
import { createSyncOperationRepository } from "../app/ticketSync/syncRepository";
import { RedmineHttpError } from "../redmine/httpError";
import type { TicketCreateDependencies } from "../views/ticketSync/types";
import { getOfflineSyncQueue, initializeOfflineSyncStore, replaceOfflineSyncQueueAsync } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";
import { TicketCreateHandler } from "../app/ticketSync/operationHandlers";
import { UnifiedSyncOperation, TicketCreateIntent } from "../app/ticketSync/syncOperationTypes";

suite("RT-06: Ticket Child Saga (ticketChildSaga.test.ts)", () => {
  const scope = "test-scope-rt-06";

  setup(() => initializeOfflineSyncStore(createTestMemento(), scope));

  const createOperation = (queueId: string): UnifiedSyncOperation<TicketCreateIntent> => {
    const intent: TicketCreateIntent = {
      projectId: 1,
      subject: "Parent Issue",
      description: "Parent Description",
      metadata: {
        tracker: "Feature",
        priority: "Normal",
        status: "New",
        start_date: "",
        due_date: "",
        children: ["Child Task 1", "Child Task 2"],
      },
    };

    return {
      operationId: `${scope}:newTicket:${queueId}`,
      kind: "ticket_create",
      key: { kind: "newTicket", queueId },
      connectionScope: scope,
      phase: "queued",
      revision: 1,
      intentRevision: 1,
      version: 1,
      persistenceVersion: 1,
      projectId: 1,
      intent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  };

  test("RT-06: 親チケット作成時に child tickets が指定されている場合、子チケットが作成されること", async () => {
    const handler = new TicketCreateHandler();
    let createdIssues: any[] = [];

    const op = createOperation("queue-child");

    let nextId = 1000;
    const mockDeps: any = {
      listIssueStatuses: async () => [{ id: 1, name: "New" }],
      listTrackers: async () => [{ id: 1, name: "Feature" }],
      listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      createIssue: async (input: any) => {
        const id = nextId++;
        createdIssues.push({ id, ...input });
        return id;
      },
      getIssueDetail: async (id: number) => ({
        ticket: { id, subject: "Parent Issue", projectId: 1, statusId: 1, priorityId: 1, trackerId: 1, createdAt: "2026-08-14T00:00:00Z", updatedAt: "2026-08-14T00:00:00Z" },
        comments: [],
      }),
    };

    const prep = await handler.prepare(op, { connectionScope: scope }, { ticketCreate: mockDeps });
    assert.strictEqual(prep.ok, true);

    const writeResult = await handler.executeRemoteWrite(op, (prep as any).prepared, { connectionScope: scope }, { ticketCreate: mockDeps });
    assert.strictEqual(writeResult.ok, true);
    assert.ok(createdIssues.length >= 1, "親チケットが作成されていること");
    assert.strictEqual(createdIssues[0].subject, "Parent Issue");
  });

  for (const failure of ["commit_unknown", "failed"] as const) {
    test(`親が作成済みなら子の ${failure} を記録し、第2子を作成して復旧待ちを返す`, async () => {
      const handler = new TicketCreateHandler();
      const repository = createSyncOperationRepository();
      const op = createOperation(`child-${failure}`);
      const posts: Array<{ subject: string; parentId?: number }> = [];
      let deletes = 0;
      const ticketCreate: Partial<TicketCreateDependencies> = {
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listTrackers: async () => [{ id: 1, name: "Feature" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
        deleteIssue: failure === "failed" ? undefined : async () => { deletes++; },
        createIssue: async ({ subject, parentId }) => {
          posts.push({ subject, parentId });
          if (subject === "Child Task 1") {
            throw failure === "commit_unknown" ? new Error("socket timeout") : new RedmineHttpError(403, "Forbidden");
          }
          return subject === "Parent Issue" ? 1000 : 1002;
        },
      };
      const context = { connectionScope: scope };
      const deps = { repository, ticketCreate };

      const prepared = await handler.prepare(op, context, deps);
      assert.strictEqual(prepared.ok, true);
      const result = await handler.executeRemoteWrite(op, prepared.prepared, context, deps);

      assert.deepStrictEqual(posts, [
        { subject: "Parent Issue", parentId: undefined },
        { subject: "Child Task 1", parentId: 1000 },
        { subject: "Child Task 2", parentId: 1000 },
      ]);
      assert.strictEqual(deletes, 0);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.commitUnknown, false);
      assert.deepStrictEqual(result.outcome, {
        kind: "remote_committed",
        ticketId: 1000,
        pending: "remote_reconcile",
        message: "One or more child ticket effects require explicit recovery",
      });
      assert.ok(op.key);
      const stored = repository.getOperation(op.key, scope);
      assert.ok(stored);
      const effects = getEffectsForRevision(stored);
      assert.strictEqual(effects.find((effect) => effect.effectId === "child-create:0")?.state, failure);
      assert.strictEqual(effects.find((effect) => effect.effectId === "child-create:1")?.state, "committed");
    });
  }

  test("旧形式の子補償は保存済みの識別情報で照合する", async () => {
    const handler = new TicketCreateHandler();
    const repository = createSyncOperationRepository();
    const queueId = "legacy-child-compensation";
    const op = createOperation(queueId);
    const key = { kind: "newTicket", queueId } as const;
    const queue = getOfflineSyncQueue(scope);
    queue.newTickets.push({
      queueId,
      operationId: op.operationId,
      content: "",
      phase: "remote_created",
      createdIssueId: 1000,
      revision: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: "committed",
          remoteId: 1000,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "compensation_unknown",
          remoteId: 1001,
          target: { parentTicketId: 1000, ordinal: 0 },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, scope);
    const legacy = repository.getOperation<TicketCreateIntent>(key, scope);
    assert.ok(legacy);
    assert.strictEqual(legacy.projectId, undefined);
    const deletes: number[] = [];

    await handler.resolveEffect({
      key,
      effectId: "child-create:0",
      operation: { ...legacy, intent: op.intent },
      context: { connectionScope: scope },
      deps: {
        repository,
        ticketCreate: {
          getIssueDetail: async (id) => ({ ticket: { id, projectId: 2, parentId: 1000, subject: "Child Task 1" }, comments: [] }),
          deleteIssue: async (id) => { deletes.push(id); },
        },
      },
      resolution: { kind: "reconcile_compensation" },
    });

    assert.deepStrictEqual(deletes, [1001]);
    const stored = repository.getOperation(key, scope);
    assert.ok(stored);
    assert.strictEqual(stored.effects?.find((effect) => effect.effectId === "child-create:0")?.state, "compensated");
  });
});
