import * as assert from "assert";
import {
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  replaceOfflineSyncQueueAsync,
  type OfflineNewTicket,
  type OfflineTicketUpdate,
} from "../views/offlineSyncStore";
import { createSyncEngine } from "../app/syncEngine";
import {
  getRecoveryItemsForOperation,
  type DurableSyncEffect,
} from "../app/syncEffects";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { createTestMemento, type TestMemento } from "./helpers/vscodeMemento";

const SCOPE = "https://redmine.example.org/attempt-generation-suite/";
const STORAGE_KEY = `redmine.offlineSyncQueue.${encodeURIComponent(SCOPE)}`;

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

const compensationEffect = (
  attemptGeneration = 1,
  remoteId = 700,
): DurableSyncEffect => ({
  effectId: "ticket-create",
  kind: "ticket_create",
  operationRevision: 1,
  attemptGeneration,
  state: "compensation_unknown",
  remoteId,
  target: {},
  requestSnapshot: {
    kind: "ticket_create",
    request: {
      projectId: 1,
      subject: "Parent",
      description: "Description",
    },
  },
});

const compensationTicket = (
  queueId: string,
  attemptGeneration = 1,
  remoteId = 700,
): OfflineNewTicket => ({
  queueId,
  operationId: `${SCOPE}:newTicket:${queueId}`,
  content: parentContent,
  projectId: 1,
  phase: "commit_unknown",
  createdIssueId: remoteId,
  revision: 1,
  attemptGeneration,
  effects: [compensationEffect(attemptGeneration, remoteId)],
});

const createCompensationEngine = (input: {
  deleteIssue: (ticketId: number) => Promise<void>;
  getIssueDetail?: (ticketId: number) => Promise<unknown>;
}) => createSyncEngine({
  tickets: {
    getIssueDetail: input.getIssueDetail ?? (async (id: number) => ({
      ticket: {
        id,
        projectId: 1,
        subject: "Parent",
        description: "Description",
        updatedAt: "2026-08-23T00:00:00Z",
      },
      comments: [],
    })),
    deleteIssue: input.deleteIssue,
  },
});

suite("M01 〜 M10: Attempt Generation Recovery Tests", () => {
  let memento: TestMemento;

  setup(() => {
    memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
  });

  test("M01/M02/M03/M04: 完全補償後は旧 Effect と Remote ID を消去し、次世代を queued として永続化・再起動復元する", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      ...compensationTicket("q-close", 1),
      nextIntent: {
        content: parentContent.replace("# Parent", "# Parent v2"),
        projectId: 1,
        revision: 2,
      },
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let deleteCalls = 0;
    const engine = createCompensationEngine({
      deleteIssue: async () => {
        deleteCalls++;
      },
    });

    const outcome = await engine.resolveTicketCommitUnknown({
      key: { kind: "newTicket", queueId: "q-close" },
      context: { connectionScope: SCOPE },
      attemptGeneration: 1,
      resolution: { kind: "reconcile_compensation" },
    });

    assert.strictEqual(outcome.kind, "queued");
    assert.strictEqual(deleteCalls, 1, "補償対象の DELETE は一度だけ実行されること");

    const closed = getOfflineSyncQueue(SCOPE).newTickets.find((ticket) => ticket.queueId === "q-close");
    assert.ok(closed);
    assert.strictEqual(closed.attemptGeneration, 2);
    assert.strictEqual(closed.revision, 2, "nextIntent が次の Revision として昇格すること");
    assert.strictEqual(closed.phase, "queued");
    assert.strictEqual(closed.createdIssueId, undefined);
    assert.deepStrictEqual(closed.effects, [], "旧世代の Effect が次世代へ持ち越されないこと");
    assert.ok(closed.content.includes("Parent v2"));

    initializeOfflineSyncStore(memento, SCOPE);
    const restored = getOfflineSyncQueue(SCOPE).newTickets.find((ticket) => ticket.queueId === "q-close");
    assert.ok(restored);
    assert.strictEqual(restored.attemptGeneration, 2, "再起動後も世代が保持されること");
    assert.strictEqual(restored.phase, "queued");
    assert.deepStrictEqual(restored.effects, []);
  });

  test("M03/M04/M07: 補償 DELETE の部分失敗は同一世代の compensation_unknown に留まり、再起動後の明示復旧で次世代へ進む", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push(compensationTicket("q-partial", 1, 701));
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let deleteCalls = 0;
    const engine = createCompensationEngine({
      deleteIssue: async () => {
        deleteCalls++;
        if (deleteCalls === 1) {
          throw new Error("DELETE timeout");
        }
      },
    });

    const first = await engine.resolveTicketCommitUnknown({
      key: { kind: "newTicket", queueId: "q-partial" },
      context: { connectionScope: SCOPE },
      attemptGeneration: 1,
      resolution: { kind: "reconcile_compensation" },
    });
    assert.strictEqual(first.kind, "commit_unknown");

    const partiallyRecovered = getOfflineSyncQueue(SCOPE).newTickets.find((ticket) => ticket.queueId === "q-partial");
    assert.ok(partiallyRecovered);
    assert.strictEqual(partiallyRecovered.attemptGeneration, 1);
    assert.strictEqual(partiallyRecovered.phase, "commit_unknown");
    assert.strictEqual(partiallyRecovered.effects?.[0]?.state, "compensation_unknown");

    initializeOfflineSyncStore(memento, SCOPE);
    const second = await engine.resolveTicketCommitUnknown({
      key: { kind: "newTicket", queueId: "q-partial" },
      context: { connectionScope: SCOPE },
      attemptGeneration: 1,
      resolution: { kind: "reconcile_compensation" },
    });
    assert.strictEqual(second.kind, "queued");
    assert.strictEqual(deleteCalls, 2);
    const recovered = getOfflineSyncQueue(SCOPE).newTickets.find((ticket) => ticket.queueId === "q-partial");
    assert.ok(recovered);
    assert.strictEqual(recovered.attemptGeneration, 2);
    assert.strictEqual(recovered.createdIssueId, undefined);
    assert.deepStrictEqual(recovered.effects, []);
  });

  test("M02/M06: 完全補償後の旧世代コールバックは副作用も永続化書き込みも発生させない", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push(compensationTicket("q-stale", 1));
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const engine = createCompensationEngine({ deleteIssue: async () => undefined });
    const closed = await engine.resolveTicketCommitUnknown({
      key: { kind: "newTicket", queueId: "q-stale" },
      context: { connectionScope: SCOPE },
      attemptGeneration: 1,
      resolution: { kind: "reconcile_compensation" },
    });
    assert.strictEqual(closed.kind, "queued");

    const persistedAfterClose = memento.get<unknown>(STORAGE_KEY);
    let staleRemoteCalls = 0;
    const staleEngine = createCompensationEngine({
      deleteIssue: async () => {
        staleRemoteCalls++;
      },
    });
    const stale = await staleEngine.resolveEffect({
      key: { kind: "newTicket", queueId: "q-stale" },
      operationId: `${SCOPE}:newTicket:q-stale`,
      operationRevision: 1,
      attemptGeneration: 1,
      effectId: "ticket-create",
      expectedEffectState: "compensation_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" },
    });

    assert.strictEqual(stale.kind, "failed_before_commit");
    assert.strictEqual(staleRemoteCalls, 0);
    assert.deepStrictEqual(
      memento.get<unknown>(STORAGE_KEY),
      persistedAfterClose,
      "stale callback が Memento を更新しないこと",
    );
  });

  test("M05/M06: Ticket Update の Policy は link_remote_ticket を提示せず、Executor も同じ操作を拒否する", async () => {
    const operation: OfflineTicketUpdate = {
      ticketId: 42,
      operationId: `${SCOPE}:ticket:42`,
      phase: "commit_unknown",
      revision: 1,
      attemptGeneration: 4,
      baseSubject: "Old",
      baseDescription: "Old description",
      baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      subject: "New",
      description: "New description",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      effects: [{
        effectId: "ticket-update",
        kind: "ticket_update",
        operationRevision: 1,
        attemptGeneration: 4,
        state: "commit_unknown",
        target: { ticketId: 42 },
        requestSnapshot: {
          kind: "ticket_update",
          request: { issueId: 42, fields: { subject: "New", description: "New description" } },
        },
      }],
    };

    const items = getRecoveryItemsForOperation({
      operationId: operation.operationId ?? "",
      kind: "ticket_update",
      phase: operation.phase,
      revision: operation.revision,
      attemptGeneration: operation.attemptGeneration,
      effects: operation.effects,
    });
    const primary = items.find((item) => item.effectId === "ticket-update");
    assert.ok(primary);
    assert.strictEqual(primary.attemptGeneration, 4);
    assert.ok(primary.allowedActions.includes("reconcile_remote"));
    assert.ok(primary.allowedActions.includes("assume_update_committed"));
    assert.ok(primary.allowedActions.includes("retry_remote_write"));
    assert.ok(!primary.allowedActions.includes("link_remote_ticket" as never));

    const queue = getOfflineSyncQueue(SCOPE);
    queue.tickets.set(42, operation);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let getIssueDetailCalls = 0;
    let updateIssueCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        getIssueDetail: async () => {
          getIssueDetailCalls++;
          return { ticket: { id: 999, projectId: 1, subject: "New" }, comments: [] };
        },
        updateIssue: async () => {
          updateIssueCalls++;
          return { id: 42 };
        },
      },
    });
    const rejected = await engine.resolveTicketCommitUnknown({
      key: { kind: "ticket", ticketId: 42 },
      context: { connectionScope: SCOPE },
      attemptGeneration: 4,
      resolution: { kind: "link_remote_ticket", ticketId: 999 },
    });
    assert.strictEqual(rejected.kind, "failed_before_commit");
    assert.strictEqual(getIssueDetailCalls, 0);
    assert.strictEqual(updateIssueCalls, 0);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.get(42)?.attemptGeneration, 4);
  });

  test("Ticket Update の committed Child が 404 の場合は二段階checkpointで補償完了する", async () => {
    const ticketId = 84;
    const childId = 850;
    const operationId = `${SCOPE}:ticket:${ticketId}`;
    const operation: OfflineTicketUpdate = {
      ticketId,
      operationId,
      phase: "remote_created" as any,
      revision: 1,
      attemptGeneration: 1,
      baseSubject: "Base",
      baseDescription: "Base description",
      baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      subject: "Updated",
      description: "Updated description",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      effects: [
        {
          effectId: "ticket-update",
          kind: "ticket_update",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "compensated",
          target: { ticketId },
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          attemptGeneration: 1,
          state: "committed",
          remoteId: childId,
          target: { parentTicketId: ticketId, ordinal: 0 },
          requestSnapshot: {
            kind: "child_create",
            parentTicketId: ticketId,
            projectId: 1,
            subject: "Child",
            request: { projectId: 1, subject: "Child", description: "Child" },
          },
        },
      ],
    };
    const queue = getOfflineSyncQueue(SCOPE);
    queue.tickets.set(ticketId, operation);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let detailCalls = 0;
    let deleteCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        getIssueDetail: async () => {
          detailCalls++;
          const notFound = new Error("404 Not Found") as Error & { status: number };
          notFound.status = 404;
          throw notFound;
        },
        deleteIssue: async () => {
          deleteCalls++;
        },
      },
    });
    const outcome = await engine.resolveEffect({
      key: { kind: "ticket", ticketId },
      operationId,
      operationRevision: 1,
      attemptGeneration: 1,
      effectId: "child-create:0",
      expectedEffectState: "committed",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" },
    });

    assert.notStrictEqual(outcome.kind, "failed_before_commit");
    assert.strictEqual(detailCalls, 1);
    assert.strictEqual(deleteCalls, 0, "404 のため DELETE は送信しないこと");
    const closed = getOfflineSyncQueue(SCOPE).tickets.get(ticketId);
    assert.ok(closed);
    assert.strictEqual(closed.attemptGeneration, 2);
    assert.strictEqual(closed.phase, "queued");
    assert.deepStrictEqual(closed.effects, []);
  });

  test("M08: 既存 v3 スナップショットで attemptGeneration が欠落していても世代 1 として復元される", async () => {
    const legacyEffect = {
      effectId: "ticket-create",
      kind: "ticket_create",
      operationRevision: 1,
      state: "commit_unknown",
      remoteId: 800,
      target: {},
    };
    await memento.update(STORAGE_KEY, {
      version: 3,
      operations: [{
        operationId: `${SCOPE}:newTicket:q-legacy`,
        kind: "ticketCreate",
        connectionScope: SCOPE,
        revision: 1,
        phase: "commit_unknown",
        createdAt: 1,
        effects: [legacyEffect],
        payload: {
          queueId: "q-legacy",
          operationId: `${SCOPE}:newTicket:q-legacy`,
          content: parentContent,
          projectId: 1,
          phase: "commit_unknown",
          revision: 1,
          effects: [legacyEffect],
        },
      }],
    });

    initializeOfflineSyncStore(memento, SCOPE);
    const restored = getOfflineSyncQueue(SCOPE).newTickets.find((ticket) => ticket.queueId === "q-legacy");
    assert.ok(restored);
    assert.strictEqual(restored.attemptGeneration, 1);
    assert.strictEqual(restored.effects?.[0]?.attemptGeneration, 1);
  });
});
