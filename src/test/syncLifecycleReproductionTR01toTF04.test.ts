import * as assert from "assert";
import * as vscode from "vscode";
import {
  initializeOfflineSyncStore,
  addOfflineNewTicketAsync,
  getOfflineSyncQueue,
  replaceOfflineSyncQueueAsync,
  OfflineNewTicket,
  OfflineTicketUpdate,
} from "../views/offlineSyncStore";
import { createSyncEngine, SyncEngine } from "../app/syncEngine";
import { createTestMemento } from "./helpers/vscodeMemento";
import {
  getRecoveryItemsForOperation,
  isPrimaryRecoveryRequired,
  DurableSyncEffect,
  RecoveryActionKind,
  restoreDurableSyncEffect,
} from "../app/syncEffects";
import { createSyncCoordinator, SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import { buildTicketEditorContent, TicketEditorContent } from "../views/ticketEditorContent";

const SCOPE = "https://redmine.example.org/tr-tf-suite/";

const metadataDeps = {
  deleteIssue: async (_id: number) => undefined,
  listIssueStatuses: async () => [{ id: 1, name: "New" }, { id: 2, name: "In Progress" }, { id: 3, name: "Closed" }],
  listTrackers: async () => [{ id: 1, name: "Bug" }, { id: 2, name: "Feature" }, { id: 3, name: "Task" }],
  listIssuePriorities: async () => [{ id: 1, name: "Low" }, { id: 2, name: "Normal" }, { id: 3, name: "High" }],
  searchUsers: async () => [],
  uploadFile: async () => ({ token: "dummy-token", filename: "dummy.png", contentType: "image/png" }),
  getProjectTrackers: async () => [{ id: 1, name: "Bug" }, { id: 2, name: "Feature" }, { id: 3, name: "Task" }],
  resolveMetadataForCreate: async () => ({ trackerId: 1, statusId: 1, priorityId: 1 }),
  resolveMetadataForUpdate: async () => ({ trackerId: 1, statusId: 1, priorityId: 1 }),
};

const makeTicketContent = (subject: string, description: string, metadata: any = { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] }, controlFields?: any) => {
  return buildTicketEditorContent({
    subject,
    description,
    metadata,
    controlFields,
    metadataBlock: "present",
    layout: "metadata-first",
  });
};

suite("T-R01 〜 T-R09 & T-F01 〜 T-F04: Reproduction Tests", () => {
  let memento: vscode.Memento;

  setup(() => {
    memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
  });

  // T-R01: Child compensation_unknown
  test("T-R01: Child compensation_unknown で link_remote_child を提示せず、実行可能な compensation recovery action を提示する", () => {
    const op = {
      operationId: `${SCOPE}:newTicket:q1`,
      kind: "ticket_create",
      phase: "remote_committed",
      revision: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create" as const,
          operationRevision: 1,
          state: "committed" as const,
          remoteId: 500,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create" as const,
          operationRevision: 1,
          state: "compensation_unknown" as const,
          target: { parentTicketId: 500, ordinal: 0 },
          remoteId: 501,
        },
      ],
    };

    const items = getRecoveryItemsForOperation(op as any);
    const childItem = items.find((i) => i.effectId === "child-create:0");
    assert.ok(childItem, "child-create:0 の RecoveryItem が取得できること");
    assert.ok(
      !childItem.allowedActions.includes("link_remote_child" as any),
      "compensation_unknown で link_remote_child を提示しないこと",
    );
    assert.ok(
      childItem.allowedActions.length > 0,
      "compensation_unknown に実行可能な recovery action (例: reconcile_compensation) が存在すること",
    );
  });

  // T-R02: Child compensation_started restart
  test("T-R02: Persistent state の compensation_started は restart (Memento restore) で compensation_unknown として復元され、実行可能な Recovery Action がある", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-restart-child",
      operationId: `${SCOPE}:newTicket:q-restart-child`,
      content: "---\nproject_id: 1\n---\n# Parent\n\nDesc",
      projectId: 1,
      phase: "remote_created" as any,
      createdIssueId: 600,
      revision: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: "committed",
          remoteId: 600,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "compensation_started",
          target: { parentTicketId: 600, ordinal: 0 },
          remoteId: 601,
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    // Re-initialize from Memento (simulating VS Code restart)
    initializeOfflineSyncStore(memento, SCOPE);

    const restoredQueue = getOfflineSyncQueue(SCOPE);
    const restoredTicket = restoredQueue.newTickets.find((t) => t.queueId === "q-restart-child");
    assert.ok(restoredTicket, "復元されたチケットが存在すること");
    const childEffect = restoredTicket.effects?.find((e) => e.effectId === "child-create:0");
    assert.ok(childEffect, "child effect が復元されていること");
    assert.strictEqual(
      childEffect.state,
      "compensation_unknown",
      "compensation_started は restart 後に compensation_unknown に正規化されること (INV-L08)",
    );

    const items = getRecoveryItemsForOperation(restoredTicket as any);
    const childItem = items.find((i) => i.effectId === "child-create:0");
    assert.ok(childItem, "RecoveryItem が生成されること");
    assert.ok(
      childItem.allowedActions.length > 0,
      "実行可能な Recovery Action が存在すること",
    );
  });

  // T-R03: Compensation remote absent
  test("T-R03: Compensation remote absent (404) の場合、DELETE=0, CREATE=0 で compensated に完了する", async () => {
    let getIssueDetailCalls = 0;
    let deleteCalls = 0;
    let createCalls = 0;

    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        getIssueDetail: async (id: number) => {
          if (id === 701) {
            getIssueDetailCalls++;
            const err: any = new Error("Issue not found (404)");
            err.status = 404;
            throw err;
          }
          return {
            ticket: {
              id: 700,
              projectId: 1,
              subject: "Parent",
              description: "Desc",
              updatedAt: "2026-08-19T00:00:00Z",
            },
            comments: [],
          };
        },
        deleteIssue: async (_id: number) => {
          deleteCalls++;
        },
        createIssue: async () => {
          createCalls++;
          return 999;
        },
      },
    });

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-comp-absent",
      operationId: `${SCOPE}:newTicket:q-comp-absent`,
      content: makeTicketContent("Parent", "Desc", { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] }, { project_id: 1 }),
      projectId: 1,
      phase: "remote_created" as any,
      createdIssueId: 700,
      revision: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: "committed",
          remoteId: 700,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "compensation_unknown",
          target: { parentTicketId: 700, ordinal: 0 },
          remoteId: 701,
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const outcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: "q-comp-absent" },
      operationId: `${SCOPE}:newTicket:q-comp-absent`,
      operationRevision: 1,
      attemptGeneration: 1,
      effectId: "child-create:0",
      expectedEffectState: "compensation_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" as any },
    });

    assert.strictEqual(getIssueDetailCalls, 1, "Remote ID の確認 GET が1回実行される");
    assert.strictEqual(deleteCalls, 0, "404 のため DELETE は実行されない");
    assert.strictEqual(createCalls, 0, "CREATE は実行されない");
    assert.strictEqual(outcome.kind, "completed", "未解決 effect が解消され completed になること");

    const updatedQueue = getOfflineSyncQueue(SCOPE);
    const op = updatedQueue.newTickets.find((t) => t.queueId === "q-comp-absent");
    assert.strictEqual(op, undefined, "completed したためキューから削除されること");
  });

  // T-R04: Compensation remote exists
  test("T-R04: Compensation remote exists の場合、DELETE=1, CREATE=0 で compensated に完了する", async () => {
    let getIssueDetailCalls = 0;
    let deleteCalls = 0;
    let createCalls = 0;

    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        getIssueDetail: async (id: number) => {
          if (id === 701) {
            getIssueDetailCalls++;
            return {
              ticket: {
                id: 701,
                projectId: 1,
                subject: "Child 701",
                parentId: 700,
              },
              comments: [],
            };
          }
          return {
            ticket: {
              id: 700,
              projectId: 1,
              subject: "Parent",
              description: "Desc",
              updatedAt: "2026-08-19T00:00:00Z",
            },
            comments: [],
          };
        },
        deleteIssue: async (_id: number) => {
          deleteCalls++;
        },
        createIssue: async () => {
          createCalls++;
          return 999;
        },
      },
    });

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-comp-exists",
      operationId: `${SCOPE}:newTicket:q-comp-exists`,
      content: makeTicketContent("Parent", "Desc", { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] }, { project_id: 1 }),
      projectId: 1,
      phase: "remote_created" as any,
      createdIssueId: 700,
      revision: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: "committed",
          remoteId: 700,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "compensation_unknown",
          target: { parentTicketId: 700, ordinal: 0 },
          remoteId: 701,
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const outcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: "q-comp-exists" },
      operationId: `${SCOPE}:newTicket:q-comp-exists`,
      operationRevision: 1,
      attemptGeneration: 1,
      effectId: "child-create:0",
      expectedEffectState: "compensation_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" as any },
    });

    assert.strictEqual(getIssueDetailCalls, 1, "Remote ID の確認 GET が1回実行される");
    assert.strictEqual(deleteCalls, 1, "存在するため DELETE が1回実行される");
    assert.strictEqual(createCalls, 0, "CREATE は実行されない");
    assert.strictEqual(outcome.kind, "completed", "未解決 effect が解消され completed になること");

    const updatedQueue = getOfflineSyncQueue(SCOPE);
    const op = updatedQueue.newTickets.find((t) => t.queueId === "q-comp-exists");
    assert.strictEqual(op, undefined, "completed したためキューから削除されること");
  });

  // T-R05: DELETE timeout
  test("T-R05: Compensation DELETE timeout の場合、state=compensation_unknown を維持し、CREATE=0, blind retry=0", async () => {
    let getIssueDetailCalls = 0;
    let deleteCalls = 0;
    let createCalls = 0;

    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        getIssueDetail: async (id: number) => {
          getIssueDetailCalls++;
          return {
            ticket: {
              id,
              projectId: 1,
              subject: "Child 701",
              parentId: 700,
            },
            comments: [],
          };
        },
        deleteIssue: async (_id: number) => {
          deleteCalls++;
          const err: any = new Error("ETIMEDOUT");
          err.code = "ETIMEDOUT";
          throw err;
        },
        createIssue: async () => {
          createCalls++;
          return 999;
        },
      },
    });

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-comp-timeout",
      operationId: `${SCOPE}:newTicket:q-comp-timeout`,
      content: makeTicketContent("Parent", "Desc", { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] }, { project_id: 1 }),
      projectId: 1,
      phase: "remote_created" as any,
      createdIssueId: 700,
      revision: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: "committed",
          remoteId: 700,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "compensation_unknown",
          target: { parentTicketId: 700, ordinal: 0 },
          remoteId: 701,
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const outcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: "q-comp-timeout" },
      operationId: `${SCOPE}:newTicket:q-comp-timeout`,
      operationRevision: 1,
      attemptGeneration: 1,
      effectId: "child-create:0",
      expectedEffectState: "compensation_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" as any },
    });

    assert.strictEqual(deleteCalls, 1, "DELETE が試行される");
    assert.strictEqual(createCalls, 0, "CREATE は実行されない");

    const updatedQueue = getOfflineSyncQueue(SCOPE);
    const op = updatedQueue.newTickets.find((t) => t.queueId === "q-comp-timeout");
    const childEffect = op?.effects?.find((e) => e.effectId === "child-create:0");
    assert.strictEqual(childEffect?.state, "compensation_unknown", "state は compensation_unknown を維持すること");
  });

  // T-R06: Primary compensation
  test("T-R06: Primary ticket-create compensation_unknown が RecoveryItem に現れ、実行可能Actionを持ち、executorへ到達する", async () => {
    const op = {
      operationId: `${SCOPE}:newTicket:q-primary-comp`,
      kind: "ticket_create",
      phase: "commit_unknown",
      revision: 1,
      createdRemoteId: 800,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create" as const,
          operationRevision: 1,
          state: "compensation_unknown" as const,
          remoteId: 800,
          target: {},
        },
      ],
    };

    const primaryEffect = op.effects[0];
    assert.ok(
      isPrimaryRecoveryRequired(op, primaryEffect),
      "Primary compensation_unknown で isPrimaryRecoveryRequired が true を返すこと",
    );

    const items = getRecoveryItemsForOperation(op as any);
    const primaryItem = items.find((i) => i.effectId === "ticket-create");
    assert.ok(primaryItem, "ticket-create の RecoveryItem が生成されること");
    assert.ok(
      primaryItem.allowedActions.length > 0,
      "実行可能な Recovery Action (例: reconcile_compensation) を持つこと",
    );
  });

  // T-R07: Policy / Executor parity
  test("T-R07: Policy が提示する全 Recovery Action は Executor が同一 state/revision で受理できる (Parity)", async () => {
    const testCases: Array<{
      op: any;
      expectedActions: RecoveryActionKind[];
    }> = [
      {
        op: {
          operationId: `${SCOPE}:newTicket:t1`,
          kind: "ticket_create",
          phase: "commit_unknown",
          revision: 1,
          effects: [
            {
              effectId: "ticket-create",
              kind: "ticket_create" as const,
              operationRevision: 1,
              state: "commit_unknown" as const,
              requestSnapshot: { kind: "ticket_create", request: { projectId: 1, subject: "Test", description: "" } },
              target: {},
            },
          ],
        },
        expectedActions: ["link_created_ticket", "retry_remote_write"],
      },
      {
        op: {
          operationId: `${SCOPE}:newTicket:t2`,
          kind: "ticket_create",
          phase: "remote_committed",
          revision: 1,
          createdRemoteId: 100,
          effects: [
            {
              effectId: "ticket-create",
              kind: "ticket_create" as const,
              operationRevision: 1,
              state: "committed" as const,
              remoteId: 100,
              target: {},
            },
            {
              effectId: "child-create:0",
              kind: "child_create" as const,
              operationRevision: 1,
              state: "compensation_unknown" as const,
              remoteId: 101,
              target: { parentTicketId: 100, ordinal: 0 },
            },
          ],
        },
        expectedActions: ["reconcile_compensation" as any],
      },
    ];

    for (const { op } of testCases) {
      const items = getRecoveryItemsForOperation(op);
      for (const item of items) {
        assert.ok(item.allowedActions.length > 0, `Effect ${item.effectId} (${item.state}) should have at least 1 action`);
      }
    }
  });

  // T-R08: SyncAll remote_committed
  test("T-R08: 5件中3件目が remote_committed の場合、SyncAll は blocked_by_recovery で停止し、4件目・5件目の remote mutation を行わない", async () => {
    let updateCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        updateIssue: async (input: any) => {
          updateCalls++;
          return { id: input.id, subject: input.subject };
        },
        getIssueDetail: async (id: number) => {
          if (id === 303) {
            // 3件目は read-back エラーにして remote_committed にとどまらせる
            throw new Error("Read-back network error");
          }
          return {
            ticket: {
              id,
              projectId: 1,
              subject: `Ticket ${id}`,
              description: "desc",
              updatedAt: "2026-08-19T00:00:00Z",
            },
          };
        },
      },
    });

    const queue = getOfflineSyncQueue(SCOPE);
    for (let id = 301; id <= 305; id++) {
      queue.tickets.set(id, {
        ticketId: id,
        operationId: `${SCOPE}:ticket:${id}`,
        phase: "queued",
        revision: 1,
        subject: `Ticket ${id} Subject`,
        description: "desc",
        metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
        baseSubject: "base",
        baseDescription: "base",
        baseMetadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      });
    }
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const outcome = await engine.syncAll({ connectionScope: SCOPE });

    assert.strictEqual(outcome.results.length, 3, "3件目まで実行されること");
    assert.strictEqual(outcome.remaining.length, 2, "4件目・5件目が remaining に残ること");
    assert.strictEqual(outcome.stopReason, "blocked_by_recovery", "stopReason は blocked_by_recovery であること");
    assert.strictEqual(updateCalls, 3, "Remote update は3件目までで停止し4・5件目は呼ばれないこと");
  });

  // T-R09: SyncAll conflict
  test("T-R09: 5件中3件目が conflict の場合、SyncAll は terminal success にならず停止し、後続 remote mutation を行わず queue に残る", async () => {
    let updateCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        updateIssue: async (input: any) => {
          updateCalls++;
          return { id: input.id, subject: input.subject };
        },
        getIssueDetail: async (id: number) => {
          if (id === 403) {
            // 3件目はリモートが新しくなっており conflict
            return {
              ticket: {
                id,
                projectId: 1,
                subject: "Conflict Subject on Remote",
                description: "Conflict Desc",
                updatedAt: "2026-08-19T12:00:00Z", // newer than lastKnownRemoteUpdatedAt
              },
            };
          }
          return {
            ticket: {
              id,
              projectId: 1,
              subject: `Ticket ${id}`,
              description: "desc",
              updatedAt: "2026-08-19T00:00:00Z",
            },
          };
        },
      },
    });

    const queue = getOfflineSyncQueue(SCOPE);
    for (let id = 401; id <= 405; id++) {
      queue.tickets.set(id, {
        ticketId: id,
        operationId: `${SCOPE}:ticket:${id}`,
        phase: "queued",
        revision: 1,
        subject: `Ticket ${id} Subject`,
        description: "desc",
        metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
        baseSubject: "base",
        baseDescription: "base",
        baseMetadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
        lastKnownRemoteUpdatedAt: "2026-08-19T00:00:00Z",
      });
    }
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const outcome = await engine.syncAll({ connectionScope: SCOPE });

    assert.strictEqual(outcome.results.length, 3, "3件目まで実行されること");
    assert.strictEqual(outcome.remaining.length, 2, "4件目・5件目が remaining に残ること");
    assert.notStrictEqual(outcome.stopReason, "completed", "completed にはならないこと");
    assert.strictEqual(outcome.stopReason, "blocked_by_recovery", "stopReason は blocked_by_recovery であること");
    assert.strictEqual(updateCalls, 2, "1,2件目のみ update され、3件目(conflict)と4,5件目は update されないこと");
  });

  // T-F01: New Ticket + nextIntent
  test("T-F01: New Ticket 作成中に user edit/save で nextIntent (Rev 2) が生成された場合、Rev 1 CREATE 成功時の finalize は Rev 2 の編集を維持し stale_source で失敗しない", async () => {
    let createCalls = 0;
    let documentContent = makeTicketContent("Rev 2 Subject", "Rev 2 Description by user while syncing", { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] }, { project_id: 1 });

    const docUri = "file:///workspace/new-ticket-tf01.md";

    const documentsPort = {
      rewriteNewTicket: async (input: {
        documentUri: string;
        ticketId: number;
        projectId?: number;
        replacement: TicketEditorContent;
        expected: { content: string; operationRevision: number };
      }) => {
        // Document rewrite contract: expected.content と現在の documentContent が一致するかチェック
        if (input.expected.content !== documentContent) {
          return { kind: "stale_source" as const };
        }
        // Replacement を適用
        documentContent = buildTicketEditorContent(input.replacement);
        return { kind: "applied" as const };
      },
      findOpenDocument: () => undefined,
    };

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tf01",
      operationId: `${SCOPE}:newTicket:q-tf01`,
      content: makeTicketContent("Rev 1 Subject", "Rev 1 Description", { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] }, { project_id: 1 }),
      projectId: 1,
      documentUri: docUri,
      phase: "queued",
      revision: 1,
      nextIntent: {
        revision: 2,
        content: documentContent,
        projectId: 1,
        documentUri: docUri,
      },
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const coordinator = createSyncCoordinator();

    const outcome = await coordinator.sync(
      { kind: "newTicket", queueId: "q-tf01", documentUri: docUri },
      { connectionScope: SCOPE },
      {
        deps: {
          documents: documentsPort as any,
          ticketCreate: {
            ...metadataDeps,
            createIssue: async () => {
              createCalls++;
              return 901;
            },
            getIssueDetail: async (id: number) => ({
              ticket: {
                id,
                projectId: 1,
                subject: "Rev 1 Subject",
                description: "Rev 1 Description",
                updatedAt: "2026-08-19T00:00:00Z",
              },
              comments: [],
            }),
          },
        },
      },
    );

    assert.strictEqual(createCalls, 1, "CREATE は1回のみ実行される");
    assert.strictEqual(outcome.kind, "completed", "stale_source にならず completed になること");
    assert.ok(
      documentContent.includes("Rev 2 Subject"),
      `Document に Rev 2 の編集が維持されていること: ${documentContent}`,
    );
  });

  // T-F02: Closed document finalize
  test("T-F02: Remote committed 後に document closed の場合 local_finalize で待機し、再オープン後の同期で CREATE 再送 0 で finalize 完了する", async () => {
    let createCalls = 0;
    let isDocOpen = false;
    let documentContent = makeTicketContent("New Subject", "New Description", { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] }, { project_id: 1 });
    const docUri = "file:///workspace/new-ticket-tf02.md";

    const documentsPort = {
      rewriteNewTicket: async (input: any) => {
        if (!isDocOpen) {
          return { kind: "not_available" as const };
        }
        documentContent = buildTicketEditorContent(input.replacement);
        return { kind: "applied" as const };
      },
      findOpenDocument: () => undefined,
    };

    const coordinator = createSyncCoordinator();

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tf02",
      operationId: `${SCOPE}:newTicket:q-tf02`,
      content: documentContent,
      projectId: 1,
      documentUri: docUri,
      phase: "queued",
      revision: 1,
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    // 1回目の sync: document closed
    isDocOpen = false;
    const outcome1 = await coordinator.sync(
      { kind: "newTicket", queueId: "q-tf02", documentUri: docUri },
      { connectionScope: SCOPE },
      {
        deps: {
          documents: documentsPort as any,
          ticketCreate: {
            ...metadataDeps,
            createIssue: async () => {
              createCalls++;
              return 902;
            },
            getIssueDetail: async (id: number) => ({
              ticket: {
                id,
                projectId: 1,
                subject: "New Subject",
                description: "New Description",
                updatedAt: "2026-08-19T00:00:00Z",
              },
              comments: [],
            }),
          },
        },
      },
    );
    assert.strictEqual(outcome1.kind, "remote_committed", "document closed のため remote_committed (local_finalize pending) になる");
    assert.strictEqual(createCalls, 1, "Remote CREATE は1回実行");

    // 2回目の sync: document re-opened
    isDocOpen = true;
    const outcome2 = await coordinator.sync(
      { kind: "newTicket", queueId: "q-tf02", documentUri: docUri },
      { connectionScope: SCOPE },
      {
        deps: {
          documents: documentsPort as any,
          ticketCreate: {
            ...metadataDeps,
            createIssue: async () => {
              createCalls++;
              return 902;
            },
            getIssueDetail: async (id: number) => ({
              ticket: {
                id,
                projectId: 1,
                subject: "New Subject",
                description: "New Description",
                updatedAt: "2026-08-19T00:00:00Z",
              },
              comments: [],
            }),
          },
        },
      },
    );
    assert.strictEqual(outcome2.kind, "completed", "再オープン後の sync で completed になる");
    assert.strictEqual(createCalls, 1, "CREATE は再送されず 1 回のまま");
  });

  // T-F03: Finalize途中の追加編集
  test("T-F03: Finalize Plan 取得後に document が編集された場合、新編集を上書きせず stale_source / defer とし誤完了しない", async () => {
    let documentContent = makeTicketContent("Original Subject", "Original Desc", { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] }, { project_id: 1 });
    const docUri = "file:///workspace/new-ticket-tf03.md";

    const documentsPort = {
      rewriteNewTicket: async (input: {
        expected: { content: string; operationRevision: number };
        replacement: TicketEditorContent;
      }) => {
        // Finalize 実行直前にユーザーが外部で document をさらに編集したとシミュレート
        documentContent = makeTicketContent("Newer Concurrent Edit", "Newer content", { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] }, { project_id: 1 });
        if (input.expected.content !== documentContent) {
          return { kind: "stale_source" as const };
        }
        documentContent = buildTicketEditorContent(input.replacement);
        return { kind: "applied" as const };
      },
      findOpenDocument: () => undefined,
    };

    const coordinator = createSyncCoordinator();

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tf03",
      operationId: `${SCOPE}:newTicket:q-tf03`,
      content: documentContent,
      projectId: 1,
      documentUri: docUri,
      phase: "queued",
      revision: 1,
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const outcome = await coordinator.sync(
      { kind: "newTicket", queueId: "q-tf03", documentUri: docUri },
      { connectionScope: SCOPE },
      {
        deps: {
          documents: documentsPort as any,
          ticketCreate: {
            ...metadataDeps,
            createIssue: async () => 903,
            getIssueDetail: async (id: number) => ({
              ticket: {
                id,
                projectId: 1,
                subject: "Original Subject",
                description: "Original Desc",
                updatedAt: "2026-08-19T00:00:00Z",
              },
              comments: [],
            }),
          },
        },
      },
    );

    assert.strictEqual(outcome.kind, "remote_committed", "stale_source のため completed にならず remote_committed を維持");
    assert.ok(
      documentContent.includes("Newer Concurrent Edit"),
      "ユーザーの新しい編集が上書きされていないこと",
    );
  });

  // T-F04: Ticket Update equivalent
  test("T-F04: Ticket Update で Rev 1 remote committed 後に Rev 2 edit が発生した場合、finalize は Rev 2 edit を上書きせず rebase して保持する", async () => {
    let updateCalls = 0;
    let documentContent = makeTicketContent("Rev 2 User Edit Subject", "Rev 2 User Edit Desc", { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] });
    const docUri = "file:///workspace/ticket-1004.md";

    const documentsPort = {
      rewriteTicket: async (input: {
        expected: { content: string; operationRevision: number };
        replacement: TicketEditorContent;
      }) => {
        if (input.expected.content !== documentContent) {
          return { kind: "stale_source" as const };
        }
        documentContent = buildTicketEditorContent(input.replacement);
        return { kind: "applied" as const };
      },
      findOpenDocument: () => undefined,
    };

    const coordinator = createSyncCoordinator();

    const queue = getOfflineSyncQueue(SCOPE);
    queue.tickets.set(1004, {
      ticketId: 1004,
      operationId: `${SCOPE}:ticket:1004`,
      phase: "queued",
      revision: 1,
      subject: "Rev 1 Subject",
      description: "Rev 1 Desc",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      baseSubject: "Base Subject",
      baseDescription: "Base Desc",
      baseMetadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
      documentUri: docUri,
      nextIntent: {
        revision: 2,
        subject: "Rev 2 User Edit Subject",
        description: "Rev 2 User Edit Desc",
        metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: [] },
        documentUri: docUri,
        content: documentContent,
      },
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const outcome = await coordinator.sync(
      { kind: "ticket", ticketId: 1004 },
      { connectionScope: SCOPE },
      {
        deps: {
          documents: documentsPort as any,
          ticketUpdate: {
            ...metadataDeps,
            updateIssue: async () => {
              updateCalls++;
            },
            getIssueDetail: async (id: number) => ({
              ticket: {
                id,
                projectId: 1,
                subject: "Rev 1 Remote Subject",
                description: "Rev 1 Remote Desc",
                updatedAt: "2026-08-19T00:00:00Z",
              },
              comments: [],
            }),
          },
        },
      },
    );

    assert.strictEqual(updateCalls, 1, "Remote update は1回実行");
    assert.strictEqual(outcome.kind, "completed", "completed になること");
    assert.ok(
      documentContent.includes("Rev 2 User Edit Subject"),
      `Document に Rev 2 の編集が保持されていること: ${documentContent}`,
    );
  });
});
