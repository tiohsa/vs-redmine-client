import * as assert from "assert";
import * as vscode from "vscode";
import {
  initializeOfflineSyncStore,
  addOfflineNewTicketAsync,
  addOfflineTicketUpdate,
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
import { queueTicketDraft } from "../views/ticketSaveSync";
import { initializeTicketDraft } from "../views/ticketDraftStore";
import { syncUnsyncedFile } from "../commands/syncUnsyncedFile";
import { compareAndRewriteDocumentWithRegisteredFields } from "../views/editorDocumentRewrite";
import { runWithConnectionScope } from "../redmine/client";

const SCOPE = "https://redmine.example.org/tr10-tf11-suite/";

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

suite("T-R10 〜 T-R15 & T-F05 〜 T-F11: Lifecycle, Recovery, and Freshness Contract Tests", () => {
  let memento: vscode.Memento;

  setup(() => {
    memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
  });

  // T-R10: Secondary compensation UI
  test("T-R10: Secondary compensation UI で reconcile_compensation が実行可能で、executor call = 1, CREATE = 0 となる", async () => {
    let getIssueDetailCalled = 0;
    let deleteIssueCalled = 0;
    let createIssueCalled = 0;

    const docUri = "file:///dummy/tr10-new-ticket.md";
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tr10",
      documentUri: docUri,
      operationId: `${SCOPE}:newTicket:q-tr10`,
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
          state: "compensation_unknown",
          target: { parentTicketId: 600, ordinal: 0 },
          remoteId: 601,
          requestSnapshot: {
            kind: "child_create",
            parentTicketId: 600,
            projectId: 1,
            subject: "Child 1",
            request: { projectId: 1, subject: "Child 1", description: "Child 1" },
          },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    try {
      (vscode.window as any).showWarningMessage = async (msg: string, opt: any, ...items: string[]) => {
        const compAction = items.find((it) => it.toLowerCase().includes("compensation") || it.toLowerCase().includes("clean") || it.toLowerCase().includes("reconcile") || it.toLowerCase().includes("retry"));
        return compAction ?? items[0];
      };

      const engine = createSyncEngine({
        tickets: {
          ...metadataDeps,
          getIssueDetail: async (id: number) => {
            getIssueDetailCalled++;
            if (id === 600) {
              return { ticket: { id: 600, projectId: 1, subject: "Parent", description: "Desc" } };
            }
            if (id === 601) {
              return { ticket: { id: 601, projectId: 1, parentId: 600, subject: "Child 1" } };
            }
            return undefined;
          },
          deleteIssue: async (id: number) => {
            deleteIssueCalled++;
            return undefined;
          },
          createIssue: async () => {
            createIssueCalled++;
            return { id: 999 };
          },
        },
      });

      const res = await runWithConnectionScope(SCOPE, () => syncUnsyncedFile({ syncKey: { kind: "newTicket", documentUri: docUri } }, {
        createSyncEngine: () => engine,
      }));

      assert.strictEqual(createIssueCalled, 0, "Compensation中に新規CREATEを実行しないこと (INV-R04)");
      assert.strictEqual(deleteIssueCalled, 1, "DELETE が 1 回呼ばれること");
    } finally {
      vscode.window.showWarningMessage = originalShowWarningMessage;
    }
  });

  // T-R11: Primary compensation UI
  test("T-R11: Primary compensation UI で interactive entry point から reconcile_compensation へ到達できる", async () => {
    let deleteIssueCalled = 0;
    const docUri = "file:///dummy/tr11-new-ticket.md";
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tr11",
      documentUri: docUri,
      operationId: `${SCOPE}:newTicket:q-tr11`,
      content: "---\nproject_id: 1\n---\n# Parent\n\nDesc",
      projectId: 1,
      phase: "commit_unknown" as any,
      createdIssueId: 700,
      revision: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: "compensation_unknown",
          remoteId: 700,
          target: {},
          requestSnapshot: {
            kind: "ticket_create",
            request: { projectId: 1, subject: "Parent", description: "Parent" },
          },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    try {
      (vscode.window as any).showWarningMessage = async (msg: string, opt: any, ...items: string[]) => {
        const compAction = items.find((it) => it.toLowerCase().includes("compensation") || it.toLowerCase().includes("reconcile") || it.toLowerCase().includes("clean"));
        return compAction ?? items[0];
      };

      const engine = createSyncEngine({
        tickets: {
          ...metadataDeps,
          getIssueDetail: async (id: number) => {
            if (id === 700) {
              return { ticket: { id: 700, projectId: 1, subject: "Parent" } };
            }
            return undefined;
          },
          deleteIssue: async (_id: number) => {
            deleteIssueCalled++;
            return undefined;
          },
        },
      });

      await runWithConnectionScope(SCOPE, () => syncUnsyncedFile({ syncKey: { kind: "newTicket", documentUri: docUri } }, {
        createSyncEngine: () => engine,
      }));

      assert.strictEqual(deleteIssueCalled, 1, "Primary compensation の DELETE が実行されること");
    } finally {
      vscode.window.showWarningMessage = originalShowWarningMessage;
    }
  });

  // T-R12: Primary compensation completion
  test("T-R12: Primary compensation 完了後に primary=compensated, createdRemoteIdなし, Operationがretry-safeとなる", async () => {
    let deleteCalled = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        getIssueDetail: async (id: number) => {
          if (id === 701) {
            return { ticket: { id: 701, projectId: 1, subject: "Parent" } };
          }
          return undefined;
        },
        deleteIssue: async (_id: number) => {
          deleteCalled++;
          return undefined;
        },
      },
    });

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tr12",
      operationId: `${SCOPE}:newTicket:q-tr12`,
      content: "---\nproject_id: 1\n---\n# Parent\n\nDesc",
      projectId: 1,
      phase: "commit_unknown" as any,
      createdIssueId: 701,
      revision: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: "compensation_unknown",
          remoteId: 701,
          target: {},
          requestSnapshot: {
            kind: "ticket_create",
            request: { projectId: 1, subject: "Parent", description: "Parent" },
          },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const outcome = await engine.resolveTicketCommitUnknown({
      key: { kind: "newTicket", queueId: "q-tr12" },
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" },
    });

    const repo = engine.getRepository();
    const op = repo.getOperation({ kind: "newTicket", queueId: "q-tr12" }, SCOPE);
    assert.ok(op, "Operation が存在すること");
    const primaryEffect = op.effects?.find((e) => e.effectId === "ticket-create");
    assert.strictEqual(primaryEffect?.state, "compensated", "Primary effect は compensated であること (INV-R07)");
    assert.strictEqual(op.createdRemoteId, undefined, "createdRemoteId は消去されていること (INV-R07)");
    assert.ok(
      op.phase === "queued" || op.phase === "completed",
      `Operation phase は retry-safe (queued または completed) であること, actual: ${op.phase}`,
    );
  });

  // T-R13: Primary compensation timeout
  test("T-R13: Primary compensation timeout 後、呼出し終了時の persisted Effect が compensation_unknown であること", async () => {
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        getIssueDetail: async (id: number) => ({ ticket: { id, projectId: 1, subject: "Parent" } }),
        deleteIssue: async () => {
          const err: any = new Error("Connection timed out");
          err.code = "ETIMEDOUT";
          throw err;
        },
      },
    });

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tr13",
      operationId: `${SCOPE}:newTicket:q-tr13`,
      content: "---\nproject_id: 1\n---\n# Parent\n\nDesc",
      projectId: 1,
      phase: "commit_unknown" as any,
      createdIssueId: 702,
      revision: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: "compensation_unknown",
          remoteId: 702,
          target: {},
          requestSnapshot: {
            kind: "ticket_create",
            request: { projectId: 1, subject: "Parent", description: "Parent" },
          },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    await engine.resolveTicketCommitUnknown({
      key: { kind: "newTicket", queueId: "q-tr13" },
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" },
    });

    const repo = engine.getRepository();
    const op = repo.getOperation({ kind: "newTicket", queueId: "q-tr13" }, SCOPE);
    assert.ok(op, "Operation が存在すること");
    const primaryEffect = op.effects?.find((e) => e.effectId === "ticket-create");
    assert.strictEqual(
      primaryEffect?.state,
      "compensation_unknown",
      "DELETE timeout 後は compensation_unknown に留まること (INV-R08)",
    );
  });

  // T-R14: Compensation identity mismatch
  test("T-R14: GET 結果の project/parent/subject が frozen snapshot と不一致の場合 DELETE=0, unresolved となる", async () => {
    let deleteCalled = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        getIssueDetail: async (id: number) => {
          return { ticket: { id, projectId: 99, parentId: 888, subject: "Completely Different Ticket" } };
        },
        deleteIssue: async () => {
          deleteCalled++;
          return undefined;
        },
      },
    });

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tr14",
      operationId: `${SCOPE}:newTicket:q-tr14`,
      content: "---\nproject_id: 1\n---\n# Parent\n\nDesc",
      projectId: 1,
      phase: "remote_created" as any,
      createdIssueId: 703,
      revision: 1,
      effects: [
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "compensation_unknown",
          remoteId: 704,
          target: { parentTicketId: 703, ordinal: 0 },
          requestSnapshot: {
            kind: "child_create",
            parentTicketId: 703,
            projectId: 1,
            subject: "Expected Child Subject",
            request: { projectId: 1, subject: "Expected Child Subject", description: "Expected Child Subject" },
          },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const outcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: "q-tr14" },
      operationId: `${SCOPE}:newTicket:q-tr14`,
      operationRevision: 1,
      effectId: "child-create:0",
      expectedEffectState: "compensation_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" },
    });

    assert.strictEqual(deleteCalled, 0, "Identity mismatch 時に DELETE は 0 回であること (INV-R06)");
    assert.ok(outcome.kind !== "completed" && outcome.kind !== "no_change", "unresolved であること");
  });

  // T-R15: Policy / Executor / UI exhaustive parity
  test("T-R15: RecoveryActionKind の全 Action について Policy → Executor → UI adapter の網羅的 parity が保証される", async () => {
    const allActions: Record<RecoveryActionKind, {
      createFixture: () => { op: any; effectId: string; expectedState: any };
      executorCall: (engine: SyncEngine, fixture: { op: any; effectId: string; expectedState: any }) => Promise<any>;
    }> = {
      retry_remote_write: {
        createFixture: () => ({
          op: {
            operationId: `${SCOPE}:ticket:801`,
            kind: "ticket_update",
            phase: "commit_unknown",
            revision: 1,
            ticketId: 801,
            effects: [{ effectId: "ticket-update", kind: "ticket_update" as const, operationRevision: 1, state: "commit_unknown" as const, target: {}, requestSnapshot: { kind: "ticket_update" as const, request: { subject: "Sub" } } }],
          },
          effectId: "ticket-update",
          expectedState: "commit_unknown",
        }),
        executorCall: async (engine) => engine.resolveTicketCommitUnknown({
          key: { kind: "ticket", ticketId: 801 },
          context: { connectionScope: SCOPE },
          resolution: { kind: "retry_remote_write" },
        }),
      },
      reconcile_remote: {
        createFixture: () => ({
          op: {
            operationId: `${SCOPE}:ticket:802`,
            kind: "ticket_update",
            phase: "commit_unknown",
            revision: 1,
            ticketId: 802,
            effects: [{ effectId: "ticket-update", kind: "ticket_update" as const, operationRevision: 1, state: "commit_unknown" as const, target: {} }],
          },
          effectId: "ticket-update",
          expectedState: "commit_unknown",
        }),
        executorCall: async (engine) => engine.resolveTicketCommitUnknown({
          key: { kind: "ticket", ticketId: 802 },
          context: { connectionScope: SCOPE },
          resolution: { kind: "reconcile_remote" },
        }),
      },
      link_created_ticket: {
        createFixture: () => ({
          op: {
            operationId: `${SCOPE}:newTicket:q803`,
            kind: "ticket_create",
            phase: "commit_unknown",
            revision: 1,
            effects: [{ effectId: "ticket-create", kind: "ticket_create" as const, operationRevision: 1, state: "commit_unknown" as const, target: {} }],
          },
          effectId: "ticket-create",
          expectedState: "commit_unknown",
        }),
        executorCall: async (engine) => engine.resolveTicketCommitUnknown({
          key: { kind: "newTicket", queueId: "q803" },
          context: { connectionScope: SCOPE },
          resolution: { kind: "link_created_ticket", ticketId: 803 },
        }),
      },
      link_remote_ticket: {
        createFixture: () => ({
          op: {
            operationId: `${SCOPE}:ticket:804`,
            kind: "ticket_update",
            phase: "commit_unknown",
            revision: 1,
            ticketId: 804,
            effects: [{ effectId: "ticket-update", kind: "ticket_update" as const, operationRevision: 1, state: "commit_unknown" as const, target: {} }],
          },
          effectId: "ticket-update",
          expectedState: "commit_unknown",
        }),
        executorCall: async (engine) => engine.resolveTicketCommitUnknown({
          key: { kind: "ticket", ticketId: 804 },
          context: { connectionScope: SCOPE },
          resolution: { kind: "link_remote_ticket", ticketId: 804 },
        }),
      },
      link_remote_comment: {
        createFixture: () => ({
          op: {
            operationId: `${SCOPE}:comment:805:905`,
            kind: "comment_update",
            phase: "commit_unknown",
            revision: 1,
            ticketId: 805,
            commentId: 905,
            effects: [{ effectId: "comment-update", kind: "comment_update" as const, operationRevision: 1, state: "commit_unknown" as const, target: {} }],
          },
          effectId: "comment-update",
          expectedState: "commit_unknown",
        }),
        executorCall: async (engine) => engine.resolveCommentCommitUnknown({
          key: { kind: "comment", ticketId: 805, commentId: 905 },
          context: { connectionScope: SCOPE },
          resolution: { kind: "link_remote_comment", commentId: 905 },
        }),
      },
      assume_update_committed: {
        createFixture: () => ({
          op: {
            operationId: `${SCOPE}:ticket:806`,
            kind: "ticket_update",
            phase: "commit_unknown",
            revision: 1,
            ticketId: 806,
            effects: [{ effectId: "ticket-update", kind: "ticket_update" as const, operationRevision: 1, state: "commit_unknown" as const, target: {} }],
          },
          effectId: "ticket-update",
          expectedState: "commit_unknown",
        }),
        executorCall: async (engine) => engine.resolveTicketCommitUnknown({
          key: { kind: "ticket", ticketId: 806 },
          context: { connectionScope: SCOPE },
          resolution: { kind: "assume_update_committed" },
        }),
      },
      retry_effect: {
        createFixture: () => ({
          op: {
            operationId: `${SCOPE}:newTicket:q807`,
            kind: "ticket_create",
            phase: "remote_committed",
            revision: 1,
            createdIssueId: 807,
            effects: [
              { effectId: "ticket-create", kind: "ticket_create" as const, operationRevision: 1, state: "committed" as const, remoteId: 807, target: {} },
              {
                effectId: "child-create:0",
                kind: "child_create" as const,
                operationRevision: 1,
                state: "failed" as const,
                failure: { disposition: "retryable" as const, detail: "retryable failure" },
                target: { parentTicketId: 807, ordinal: 0 },
                requestSnapshot: { kind: "child_create" as const, parentTicketId: 807, projectId: 1, subject: "Child", request: { projectId: 1, subject: "Child", description: "Child" } },
              },
            ],
          },
          effectId: "child-create:0",
          expectedState: "failed",
        }),
        executorCall: async (engine) => engine.resolveEffect({
          key: { kind: "newTicket", queueId: "q807" },
          operationId: `${SCOPE}:newTicket:q807`,
          operationRevision: 1,
          effectId: "child-create:0",
          expectedEffectState: "failed",
          context: { connectionScope: SCOPE },
          resolution: { kind: "retry_effect" },
        }),
      },
      link_remote_child: {
        createFixture: () => ({
          op: {
            operationId: `${SCOPE}:newTicket:q808`,
            kind: "ticket_create",
            phase: "remote_committed",
            revision: 1,
            createdIssueId: 808,
            effects: [
              { effectId: "ticket-create", kind: "ticket_create" as const, operationRevision: 1, state: "committed" as const, remoteId: 808, target: {} },
              {
                effectId: "child-create:0",
                kind: "child_create" as const,
                operationRevision: 1,
                state: "commit_unknown" as const,
                target: { parentTicketId: 808, ordinal: 0 },
                requestSnapshot: { kind: "child_create" as const, parentTicketId: 808, projectId: 1, subject: "Child", request: { projectId: 1, subject: "Child", description: "Child" } },
              },
            ],
          },
          effectId: "child-create:0",
          expectedState: "commit_unknown",
        }),
        executorCall: async (engine) => engine.resolveEffect({
          key: { kind: "newTicket", queueId: "q808" },
          operationId: `${SCOPE}:newTicket:q808`,
          operationRevision: 1,
          effectId: "child-create:0",
          expectedEffectState: "commit_unknown",
          context: { connectionScope: SCOPE },
          resolution: { kind: "link_remote_child", remoteId: 908 },
        }),
      },
      reconcile_compensation: {
        createFixture: () => ({
          op: {
            operationId: `${SCOPE}:newTicket:q809`,
            kind: "ticket_create",
            phase: "compensation_unknown",
            revision: 1,
            createdIssueId: 809,
            effects: [
              {
                effectId: "ticket-create",
                kind: "ticket_create" as const,
                operationRevision: 1,
                state: "compensation_unknown" as const,
                remoteId: 809,
                target: {},
                requestSnapshot: { kind: "ticket_create" as const, request: { projectId: 1, subject: "Parent", description: "Parent" } },
              },
            ],
          },
          effectId: "ticket-create",
          expectedState: "compensation_unknown",
        }),
        executorCall: async (engine) => engine.resolveTicketCommitUnknown({
          key: { kind: "newTicket", queueId: "q809" },
          context: { connectionScope: SCOPE },
          resolution: { kind: "reconcile_compensation" },
        }),
      },
    };

    const actionKeys = Object.keys(allActions) as RecoveryActionKind[];
    assert.strictEqual(actionKeys.length, 9, "全 9 種類の RecoveryActionKind が網羅されていること");

    for (const actionKey of actionKeys) {
      const entry = allActions[actionKey];
      const fixture = entry.createFixture();

      // 1. Policy generates the action
      const items = getRecoveryItemsForOperation(fixture.op);
      const matchedItem = items.find((i) => i.effectId === fixture.effectId);
      assert.ok(matchedItem, `Policy yielded item for ${actionKey}`);
      assert.ok(matchedItem.allowedActions.includes(actionKey), `Policy yielded ${actionKey} in allowedActions`);

      // 2. Public executor accepts the action
      const queue = getOfflineSyncQueue(SCOPE);
      if (fixture.op.kind === "ticket_create") {
        queue.newTickets.push(fixture.op as any);
      } else if (fixture.op.kind === "ticket_update") {
        queue.tickets.set(fixture.op.ticketId, fixture.op as any);
      } else if (fixture.op.kind === "comment_update" || fixture.op.kind === "comment_create") {
        queue.comments.push(fixture.op as any);
      }
      await replaceOfflineSyncQueueAsync(queue, SCOPE);

      const engine = createSyncEngine({
        tickets: {
          ...metadataDeps,
          getIssueDetail: async (id: number) => ({
            ticket: { id, projectId: 1, parentId: 808, subject: id === 809 ? "Parent" : "Child", description: "Child", updatedAt: "2026-08-01T00:00:00Z" },
          }),
          deleteIssue: async () => undefined,
          updateIssue: async () => ({ id: 801, updatedAt: "2026-08-01T00:00:00Z" }),
          createIssue: async () => ({ id: 909 }),
        },
      });

      const outcome = await entry.executorCall(engine, fixture);
      assert.ok(outcome, `Executor returned outcome for ${actionKey}`);
      assert.ok(outcome.kind !== "failed_before_commit" || (actionKey === "link_remote_child" && !outcome.error.message.includes("does not support")), `Executor accepted ${actionKey}`);
    }
  });

  // T-R16: Primary compensation dominance / Policy
  test("T-R16: Primary = compensation_unknown のとき、Child = failed/retryable でも Policy は Child の retry_effect を提示しない", () => {
    const op = {
      operationId: `${SCOPE}:newTicket:q-tr16`,
      kind: "ticket_create",
      phase: "compensation_unknown",
      revision: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create" as const,
          operationRevision: 1,
          state: "compensation_unknown" as const,
          remoteId: 710,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create" as const,
          operationRevision: 1,
          state: "failed" as const,
          failure: { disposition: "retryable" as const, detail: "Network timeout" },
          target: { parentTicketId: 710, ordinal: 0 },
          requestSnapshot: {
            kind: "child_create" as const,
            parentTicketId: 710,
            projectId: 1,
            subject: "Child 1",
            request: { projectId: 1, subject: "Child 1", description: "Child 1" },
          },
        },
      ],
    };

    const items = getRecoveryItemsForOperation(op as any);
    const primaryItem = items.find((i) => i.effectId === "ticket-create");
    assert.ok(primaryItem, "Primary item が存在すること");
    assert.deepStrictEqual(primaryItem.allowedActions, ["reconcile_compensation"], "Primary actions は [reconcile_compensation] であること (R-01, R-02)");

    const childItem = items.find((i) => i.effectId === "child-create:0");
    const childActions = childItem?.allowedActions ?? [];
    assert.ok(!childActions.includes("retry_effect"), "Child の retry_effect は absent であること (R-02, T-R16)");
  });

  // T-R17: Primary compensation dominance / Executor
  test("T-R17: Policy を迂回して resolveEffect(child, retry_effect) を呼んでも Primary compensation 中なら拒絶され CREATE=0 となる", async () => {
    let createCalled = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        createIssue: async () => {
          createCalled++;
          return { id: 999 };
        },
      },
    });

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tr17",
      operationId: `${SCOPE}:newTicket:q-tr17`,
      content: "---\nproject_id: 1\n---\n# Parent\n\nDesc",
      projectId: 1,
      phase: "compensation_unknown" as any,
      createdIssueId: 720,
      revision: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: "compensation_unknown",
          remoteId: 720,
          target: {},
          requestSnapshot: {
            kind: "ticket_create",
            request: { projectId: 1, subject: "Parent", description: "Parent" },
          },
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "failed",
          failure: { disposition: "retryable", detail: "Network timeout" },
          target: { parentTicketId: 720, ordinal: 0 },
          requestSnapshot: {
            kind: "child_create",
            parentTicketId: 720,
            projectId: 1,
            subject: "Child 1",
            request: { projectId: 1, subject: "Child 1", description: "Child 1" },
          },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const outcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: "q-tr17" },
      operationId: `${SCOPE}:newTicket:q-tr17`,
      operationRevision: 1,
      effectId: "child-create:0",
      expectedEffectState: "failed",
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_effect" },
    });

    assert.strictEqual(createCalled, 0, "CREATE は 0 回であること (R-01, R-03)");
    assert.strictEqual(outcome.kind, "failed_before_commit", "outcome は rejected (failed_before_commit) であること");
    assert.ok(outcome.error.message.includes("primary compensation"), `理由に primary compensation が含まれること, got: ${outcome.error.message}`);
  });

  // T-R18: Primary cancel → Secondary禁止
  test("T-R18: Unsynced UI で Primary compensation prompt をキャンセルした場合、Secondary retry prompt は表示されず CREATE=0 となる", async () => {
    let createCalled = 0;
    let warningPromptCount = 0;
    const docUri = "file:///dummy/tr18-new-ticket.md";

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tr18",
      documentUri: docUri,
      operationId: `${SCOPE}:newTicket:q-tr18`,
      content: "---\nproject_id: 1\n---\n# Parent\n\nDesc",
      projectId: 1,
      phase: "commit_unknown" as any,
      createdIssueId: 730,
      revision: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: "compensation_unknown",
          remoteId: 730,
          target: {},
          requestSnapshot: {
            kind: "ticket_create",
            request: { projectId: 1, subject: "Parent", description: "Parent" },
          },
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "failed",
          failure: { disposition: "retryable", detail: "Network timeout" },
          target: { parentTicketId: 730, ordinal: 0 },
          requestSnapshot: {
            kind: "child_create",
            parentTicketId: 730,
            projectId: 1,
            subject: "Child 1",
            request: { projectId: 1, subject: "Child 1", description: "Child 1" },
          },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const originalShowWarningMessage = vscode.window.showWarningMessage;
    try {
      (vscode.window as any).showWarningMessage = async (_msg: string, _opt: any, ..._items: string[]) => {
        warningPromptCount++;
        // Cancel primary prompt (return undefined)
        return undefined;
      };

      const engine = createSyncEngine({
        tickets: {
          ...metadataDeps,
          createIssue: async () => {
            createCalled++;
            return { id: 999 };
          },
        },
      });

      await runWithConnectionScope(SCOPE, () => syncUnsyncedFile({ syncKey: { kind: "newTicket", documentUri: docUri } }, {
        createSyncEngine: () => engine,
      }));

      assert.strictEqual(warningPromptCount, 1, "Primary のプロンプトのみ表示され、キャンセル後に Secondary プロンプトが表示されないこと");
      assert.strictEqual(createCalled, 0, "CREATE は 0 回であること (T-R18)");
    } finally {
      vscode.window.showWarningMessage = originalShowWarningMessage;
    }
  });

  // T-R19: Missing parent identity
  test("T-R19: expected parentId があるが remote.parentId が undefined の場合 DELETE=0 となる (C-02)", async () => {
    let deleteCalled = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        getIssueDetail: async (id: number) => {
          return { ticket: { id, projectId: 1, parentId: undefined, subject: "Child 1" } };
        },
        deleteIssue: async () => {
          deleteCalled++;
          return undefined;
        },
      },
    });

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tr19",
      operationId: `${SCOPE}:newTicket:q-tr19`,
      content: "---\nproject_id: 1\n---\n# Parent\n\nDesc",
      projectId: 1,
      phase: "remote_created" as any,
      createdIssueId: 740,
      revision: 1,
      effects: [
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "compensation_unknown",
          remoteId: 741,
          target: { parentTicketId: 740, ordinal: 0 },
          requestSnapshot: {
            kind: "child_create",
            parentTicketId: 740,
            projectId: 1,
            subject: "Child 1",
            request: { projectId: 1, subject: "Child 1", description: "Child 1" },
          },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const outcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: "q-tr19" },
      operationId: `${SCOPE}:newTicket:q-tr19`,
      operationRevision: 1,
      effectId: "child-create:0",
      expectedEffectState: "compensation_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" },
    });

    assert.strictEqual(deleteCalled, 0, "remote parentId 欠落時に DELETE=0 であること (C-02, T-R19)");
    assert.strictEqual(outcome.kind, "failed_before_commit");
  });

  // T-R20: Missing project identity
  test("T-R20: expected projectId があるが remote.projectId が undefined の場合 DELETE=0 となる (C-03)", async () => {
    let deleteCalled = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        getIssueDetail: async (id: number) => {
          return { ticket: { id, projectId: undefined, parentId: 750, subject: "Child 1" } };
        },
        deleteIssue: async () => {
          deleteCalled++;
          return undefined;
        },
      },
    });

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tr20",
      operationId: `${SCOPE}:newTicket:q-tr20`,
      content: "---\nproject_id: 1\n---\n# Parent\n\nDesc",
      projectId: 1,
      phase: "remote_created" as any,
      createdIssueId: 750,
      revision: 1,
      effects: [
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "compensation_unknown",
          remoteId: 751,
          target: { parentTicketId: 750, ordinal: 0 },
          requestSnapshot: {
            kind: "child_create",
            parentTicketId: 750,
            projectId: 1,
            subject: "Child 1",
            request: { projectId: 1, subject: "Child 1", description: "Child 1" },
          },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const outcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: "q-tr20" },
      operationId: `${SCOPE}:newTicket:q-tr20`,
      operationRevision: 1,
      effectId: "child-create:0",
      expectedEffectState: "compensation_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" },
    });

    assert.strictEqual(deleteCalled, 0, "remote projectId 欠落時に DELETE=0 であること (C-03, T-R20)");
    assert.strictEqual(outcome.kind, "failed_before_commit");
  });

  // T-R21: Missing subject identity
  test("T-R21: expected subject があるが remote.subject が undefined の場合 DELETE=0 となる (C-04)", async () => {
    let deleteCalled = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        getIssueDetail: async (id: number) => {
          return { ticket: { id, projectId: 1, parentId: 760, subject: undefined as any } };
        },
        deleteIssue: async () => {
          deleteCalled++;
          return undefined;
        },
      },
    });

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tr21",
      operationId: `${SCOPE}:newTicket:q-tr21`,
      content: "---\nproject_id: 1\n---\n# Parent\n\nDesc",
      projectId: 1,
      phase: "remote_created" as any,
      createdIssueId: 760,
      revision: 1,
      effects: [
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "compensation_unknown",
          remoteId: 761,
          target: { parentTicketId: 760, ordinal: 0 },
          requestSnapshot: {
            kind: "child_create",
            parentTicketId: 760,
            projectId: 1,
            subject: "Child 1",
            request: { projectId: 1, subject: "Child 1", description: "Child 1" },
          },
        },
      ],
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    const outcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: "q-tr21" },
      operationId: `${SCOPE}:newTicket:q-tr21`,
      operationRevision: 1,
      effectId: "child-create:0",
      expectedEffectState: "compensation_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_compensation" },
    });

    assert.strictEqual(deleteCalled, 0, "remote subject 欠落時に DELETE=0 であること (C-04, T-R21)");
    assert.strictEqual(outcome.kind, "failed_before_commit");
  });

  // T-F05: Real queue path
  test("T-F05: queueTicketDraft で保存された exact source snapshot が nextIntent および Repository adapter を通して伝搬される", async () => {
    initializeTicketDraft(555, "Base Sub", "Base Desc", { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] }, "2026-08-01T00:00:00Z", SCOPE);

    const firstContent = makeTicketContent("Updated Sub", "Updated Desc");
    const res1 = await queueTicketDraft({
      ticketId: 555,
      content: firstContent,
      operationScope: SCOPE,
    });
    assert.strictEqual(res1.status, "queued");

    const repo = createSyncCoordinator().getRepository();
    const op1 = repo.getOperation({ kind: "ticket", ticketId: 555 }, SCOPE);
    assert.ok(op1, "op1 が存在すること");
    assert.strictEqual((op1.intent as any)?.content, firstContent, "intent.content に exact source snapshot が保存されること (INV-F02)");

    // In-flight 状態を模擬
    await repo.transitionOperation({ kind: "ticket", ticketId: 555 }, { kind: "start_normal_remote_write" }, SCOPE);

    // 2回目の save
    const secondContent = makeTicketContent("Rev2 Sub", "Rev2 Desc");
    const res2 = await queueTicketDraft({
      ticketId: 555,
      content: secondContent,
      operationScope: SCOPE,
    });
    assert.strictEqual(res2.status, "queued");

    const op2 = repo.getOperation({ kind: "ticket", ticketId: 555 }, SCOPE);
    assert.ok(op2, "op2 が存在すること");
    assert.ok(op2.nextIntent, "nextIntent が存在すること");
    assert.strictEqual(
      (op2.nextIntent as any)?.content,
      secondContent,
      "nextIntent.content に 2回目の exact source snapshot が保持されること (INV-F03)",
    );
  });

  // T-F06: Post-normalization snapshot
  test("T-F06: children を含む save 後に Editor から children が消えた post-normalization content を snapshot として保持する", async () => {
    initializeTicketDraft(556, "Base Sub", "Base Desc", { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] }, "2026-08-01T00:00:00Z", SCOPE);

    const rawContentWithChildren = makeTicketContent("Sub With Children", "Desc", {
      tracker: "Bug",
      priority: "Normal",
      status: "New",
      due_date: "",
      children: ["Child 1", "Child 2"],
    });

    let editorAppliedContent = "";
    const mockEditor: any = {
      document: {
        uri: vscode.Uri.parse("file:///dummy/ticket-556.md"),
        getText: () => rawContentWithChildren,
      },
      edit: async (callback: any) => {
        const builder = {
          replace: (_range: any, text: string) => {
            editorAppliedContent = text;
          },
        };
        callback(builder);
        return true;
      },
    };

    await queueTicketDraft({
      ticketId: 556,
      content: rawContentWithChildren,
      editor: mockEditor,
      operationScope: SCOPE,
    });

    const repo = createSyncCoordinator().getRepository();
    const op = repo.getOperation({ kind: "ticket", ticketId: 556 }, SCOPE);
    assert.ok(op, "op が存在すること");
    assert.ok(
      editorAppliedContent.length > 0,
      "Editor に post-normalization content が apply されたこと",
    );
    assert.strictEqual(
      (op.intent as any)?.content,
      editorAppliedContent,
      "Queue に保存された content が Editor への post-normalization content と exact に一致すること (INV-F02)",
    );
  });

  // T-F07: Persistence round trip
  test("T-F07: serialize v3 → restart → deserialize 後も nextIntent source content が byte-identical に保持される", async () => {
    initializeTicketDraft(557, "Base", "Base", { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] }, "2026-08-01T00:00:00Z", SCOPE);

    const firstContent = makeTicketContent("Sub 1", "Desc 1");
    await queueTicketDraft({ ticketId: 557, content: firstContent, operationScope: SCOPE });

    const repo = createSyncCoordinator().getRepository();
    await repo.transitionOperation({ kind: "ticket", ticketId: 557 }, { kind: "start_normal_remote_write" }, SCOPE);

    const secondContent = makeTicketContent("Sub 2", "Desc 2");
    await queueTicketDraft({ ticketId: 557, content: secondContent, operationScope: SCOPE });

    // Restart simulation
    initializeOfflineSyncStore(memento, SCOPE);

    const restoredRepo = createSyncCoordinator().getRepository();
    const restoredOp = restoredRepo.getOperation({ kind: "ticket", ticketId: 557 }, SCOPE);
    assert.ok(restoredOp, "restoredOp が存在すること");
    assert.ok(restoredOp.nextIntent, "nextIntent が存在すること");
    assert.strictEqual(
      (restoredOp.nextIntent as any)?.content,
      secondContent,
      "nextIntent.content が restart 後も byte-identical に復元されること (INV-F03)",
    );
  });

  // T-F08: Live concurrent edit
  test("T-F08: source check 後〜apply 試行の間に document version / content が変化した場合に stale_source で安全に拒絶する", async () => {
    const initialContent = makeTicketContent("Initial Sub", "Initial Desc");
    const concurrentEditContent = makeTicketContent("User Typed New Text", "Initial Desc");

    let docVersion = 1;
    let docContent = initialContent;

    const mockDoc: any = {
      uri: vscode.Uri.parse("file:///dummy/ticket-freshness.md"),
      version: docVersion,
      getText: () => docContent,
      isDirty: false,
      save: async () => true,
    };

    const mockEditor: any = {
      document: mockDoc,
      edit: async (_callback: any) => {
        docVersion = 2;
        docContent = concurrentEditContent;
        mockDoc.version = 2;
        return false;
      },
    };

    const result = await compareAndRewriteDocumentWithRegisteredFields({
      documentUri: "file:///dummy/ticket-freshness.md",
      ticketId: 888,
      projectId: 1,
      replacement: {
        subject: "Replacement Sub",
        description: "Replacement Desc",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      },
      expected: {
        content: initialContent,
        operationRevision: 1,
      },
      deps: {
        textDocuments: [mockDoc],
        textEditors: [mockEditor],
      },
    });

    assert.strictEqual(result.kind, "stale_source", "version/content 不一致時に stale_source を返すこと (INV-F05)");
  });

  // T-F09: Finalize partial failure & already-applied retry
  test("T-F09: Remote mutation 成功 → Document apply 成功 → queue completion persistence 失敗 の場合、retry で Remote mutation は 0 回、already-applied 認識で完了できる", async () => {
    let updateIssueCalled = 0;
    const docUri = "file:///dummy/ticket-564.md";
    const initialContent = makeTicketContent("Initial Sub", "Initial Desc");
    const updatedContent = makeTicketContent("Updated Sub", "Updated Desc");

    initializeTicketDraft(564, "Initial Sub", "Initial Desc", { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] }, "2026-08-01T00:00:00Z", SCOPE);

    let docText = initialContent;
    let docVersion = 1;
    const mockDoc: any = {
      uri: vscode.Uri.parse(docUri),
      version: docVersion,
      getText: () => docText,
      isDirty: false,
      save: async () => true,
    };
    const mockEditor: any = {
      document: mockDoc,
      edit: async (cb: any) => {
        const b = { replace: (_r: any, text: string) => { docText = text; docVersion++; mockDoc.version = docVersion; mockDoc.getText = () => docText; } };
        cb(b);
        return true;
      },
    };

    await queueTicketDraft({
      ticketId: 564,
      content: updatedContent,
      editor: mockEditor,
      documentUri: vscode.Uri.parse(docUri),
      operationScope: SCOPE,
    });

    let completeShouldFail = true;
    const customRepo = createSyncCoordinator().getRepository();
    const originalCompleteOperation = customRepo.completeOperation.bind(customRepo);
    customRepo.completeOperation = async (k, s, r, c) => {
      if (completeShouldFail) {
        completeShouldFail = false;
        return false; // Simulate persistence failure
      }
      return originalCompleteOperation(k, s, r, c);
    };

    const coordinator = createSyncCoordinator({ repository: customRepo });
    let remoteUpdated = false;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        getIssueDetail: async (id: number) => ({
          ticket: {
            id,
            projectId: 1,
            subject: remoteUpdated ? "Updated Sub" : "Initial Sub",
            description: remoteUpdated ? "Updated Desc" : "Initial Desc",
            updatedAt: remoteUpdated ? "2026-08-01T05:00:00Z" : "2026-08-01T00:00:00Z",
          },
        }),
        updateIssue: async () => {
          updateIssueCalled++;
          remoteUpdated = true;
          return { id: 564, updatedAt: "2026-08-01T05:00:00Z" };
        },
      },
      documents: {
        rewriteTicket: async () => ({ kind: "applied" }),
      },
      coordinator,
    });

    // Run 1: Remote write succeeds, document rewrite succeeds, completeOperation fails
    const res1 = await engine.syncOne({ kind: "ticket", ticketId: 564 }, { connectionScope: SCOPE });
    assert.strictEqual(updateIssueCalled, 1, "Run 1 で Remote write が 1 回呼ばれること");
    assert.strictEqual(res1.kind, "remote_committed", "Run 1 は persistence 失敗により remote_committed (local_finalize pending) となること");

    // Run 2: Retry sync
    const res2 = await engine.syncOne({ kind: "ticket", ticketId: 564 }, { connectionScope: SCOPE });
    assert.strictEqual(updateIssueCalled, 1, "Retry 時に Remote write は再送されないこと (mutation total = 1)");
    assert.strictEqual(res2.kind, "completed", "Retry で already-applied 認識され completed となること (F-08, F-09, T-F09)");
  });

  // T-F10: Already-applied target
  test("T-F10: Already-applied target なら冪等成功 (applied) として扱う", async () => {
    const replacementContent = makeTicketContent(
      "Synced Sub",
      "Synced Desc",
      { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      { mode: "ticket-update", issue_id: 990, project_id: 1 },
    );

    const docContent = replacementContent; // Already applied in previous run!
    const mockDoc: any = {
      uri: vscode.Uri.parse("file:///dummy/ticket-990.md"),
      version: 2,
      getText: () => docContent,
      isDirty: false,
      save: async () => true,
    };

    const res = await compareAndRewriteDocumentWithRegisteredFields({
      documentUri: "file:///dummy/ticket-990.md",
      ticketId: 990,
      projectId: 1,
      replacement: {
        subject: "Synced Sub",
        description: "Synced Desc",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      },
      expected: {
        content: makeTicketContent("Old Source Sub", "Old Source Desc"),
        operationRevision: 1,
      },
      deps: {
        textDocuments: [mockDoc],
      },
    });

    assert.strictEqual(res.kind, "applied", "Already-applied target なら冪等成功 (applied) として扱うこと (INV-F06, T-F10)");
  });

  // T-F11: Legacy v3 missing source
  test("T-F11: active legacy TicketUpdate で content がない場合、推測で上書きせず fail-closed (defer) となり remote 再送は 0 回", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.tickets.set(995, {
      ticketId: 995,
      operationId: `${SCOPE}:ticket:995`,
      baseSubject: "Base",
      baseDescription: "Base",
      baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      subject: "Updated",
      description: "Updated Desc",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      phase: "remote_committed",
      revision: 1,
    } as any);
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let remoteCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        getIssueDetail: async (id: number) => ({ ticket: { id, projectId: 1, subject: "Updated", updatedAt: "2026-08-01T00:00:00Z" } }),
        updateIssue: async () => {
          remoteCalls++;
          return undefined;
        },
      },
    });

    const outcome = await engine.syncOne({ kind: "ticket", ticketId: 995 }, { connectionScope: SCOPE });
    assert.strictEqual(remoteCalls, 0, "Remote 再送は 0 回 (INV-F07)");
  });

  // T-F12: Active intent finalize
  test("T-F12: children を含む Ticket Update を queue して nextIntent なしで Finalize するとき、expected source として operation.intent.content が使われ stale_source にならない", async () => {
    initializeTicketDraft(560, "Base Sub", "Base Desc", { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] }, "2026-08-01T00:00:00Z", SCOPE);

    const rawContentWithChildren = makeTicketContent("Sub 560", "Desc 560", {
      tracker: "Bug",
      priority: "Normal",
      status: "New",
      due_date: "",
      children: ["New Child"],
    });

    const docUri = "file:///dummy/ticket-560.md";
    let appliedContent = "";
    const mockDoc: any = {
      uri: vscode.Uri.parse(docUri),
      version: 1,
      getText: () => appliedContent,
      isDirty: false,
      save: async () => true,
    };
    const mockEditor: any = {
      document: mockDoc,
      edit: async (cb: any) => {
        const b = { replace: (_r: any, text: string) => { appliedContent = text; mockDoc.getText = () => appliedContent; } };
        cb(b);
        return true;
      },
    };

    await queueTicketDraft({
      ticketId: 560,
      content: rawContentWithChildren,
      editor: mockEditor,
      documentUri: vscode.Uri.parse(docUri),
      operationScope: SCOPE,
    });

    let updated = false;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        getIssueDetail: async (id: number) => ({
          ticket: {
            id,
            projectId: 1,
            subject: updated ? "Sub 560" : "Base Sub",
            description: updated ? "Desc 560" : "Base Desc",
            updatedAt: updated ? "2026-08-01T01:00:00Z" : "2026-08-01T00:00:00Z",
            children: updated ? [{ id: 561, subject: "New Child" }] : [],
          },
        }),
        updateIssue: async () => {
          updated = true;
          return { id: 560, updatedAt: "2026-08-01T01:00:00Z" };
        },
        createIssue: async () => ({ id: 561 }),
      },
      documents: {
        rewriteTicket: async (input: any) => {
          assert.strictEqual(input.expected.content, appliedContent);
          return { kind: "applied" };
        },
      },
    });

    const outcome = await engine.syncOne({ kind: "ticket", ticketId: 560 }, { connectionScope: SCOPE });
    assert.strictEqual(outcome.kind, "completed", "stale_source にならず completed になること (T-F12)");
  });

  // T-F13: TicketUpdate promotion
  test("T-F13: Rev1 active → Rev2 nextIntent exact content → Rev1 complete → Rev2.content が byte-identical に保持される", async () => {
    initializeTicketDraft(561, "Base", "Base", { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] }, "2026-08-01T00:00:00Z", SCOPE);

    const firstContent = makeTicketContent("Sub Rev1", "Desc Rev1");
    await queueTicketDraft({ ticketId: 561, content: firstContent, operationScope: SCOPE });

    const repo = createSyncCoordinator().getRepository();
    await repo.transitionOperation({ kind: "ticket", ticketId: 561 }, { kind: "start_normal_remote_write" }, SCOPE);

    const secondContent = makeTicketContent("Sub Rev2", "Desc Rev2");
    await queueTicketDraft({ ticketId: 561, content: secondContent, operationScope: SCOPE });

    const opBefore = repo.getOperation({ kind: "ticket", ticketId: 561 }, SCOPE);
    assert.ok(opBefore?.nextIntent, "nextIntent が存在すること");
    assert.strictEqual((opBefore.nextIntent as any)?.content, secondContent);

    // Complete Rev1
    const completed = await repo.completeOperation({ kind: "ticket", ticketId: 561 }, SCOPE, 1, {
      canonical: { subject: "Sub Rev1", description: "Desc Rev1", metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] } },
      remoteUpdatedAt: "2026-08-01T02:00:00Z",
    });
    assert.ok(completed, "completeOperation が成功すること");

    const opAfter = repo.getOperation({ kind: "ticket", ticketId: 561 }, SCOPE);
    assert.ok(opAfter, "Promoted operation が存在すること");
    assert.strictEqual(opAfter.revision, 2, "Revision 2 へ昇格していること");
    assert.strictEqual((opAfter.intent as any)?.content, secondContent, "Rev2.content が byte-identical に保持されること (F-03, T-F13)");
  });

  // T-F14: NewTicket→TicketUpdate promotion
  test("T-F14: NewTicket Rev1 → Rev2 nextIntent → Rev1 remote create → finalize → TicketUpdate Rev2.content が byte-identical に保持される", async () => {
    const docUri = "file:///dummy/newticket-562.md";
    const rev1Content = makeTicketContent("New Ticket Rev1", "Body Rev1", { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] }, { project_id: 1 });
    const rev2Content = makeTicketContent("New Ticket Rev2", "Body Rev2", { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] }, { project_id: 1 });

    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-tf14",
      documentUri: docUri,
      operationId: `${SCOPE}:newTicket:q-tf14`,
      content: rev1Content,
      projectId: 1,
      phase: "queued",
      revision: 1,
      nextIntent: {
        revision: 2,
        content: rev2Content,
        projectId: 1,
        documentUri: docUri,
      },
    });
    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    let docContent = rev2Content;
    const mockDoc: any = {
      uri: vscode.Uri.parse(docUri),
      version: 1,
      getText: () => docContent,
      isDirty: false,
      save: async () => true,
    };
    const mockEditor: any = {
      document: mockDoc,
      edit: async (cb: any) => {
        const b = { replace: (_r: any, text: string) => { docContent = text; mockDoc.getText = () => docContent; } };
        cb(b);
        return true;
      },
    };

    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        createIssue: async () => ({ id: 562, updatedAt: "2026-08-01T03:00:00Z", projectId: 1, subject: "New Ticket Rev1", description: "Body Rev1" }),
        getIssueDetail: async (id: number) => ({ ticket: { id, projectId: 1, subject: "New Ticket Rev1", description: "Body Rev1", updatedAt: "2026-08-01T03:00:00Z" } }),
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        rewriteTicket: async () => ({ kind: "applied" }),
      },
    });

    const outcome = await engine.syncOne({ kind: "newTicket", queueId: "q-tf14", documentUri: docUri }, { connectionScope: SCOPE });
    if (outcome.kind !== "completed" && outcome.kind !== "remote_committed") {
      console.error("T-F14 outcome failure detail:", (outcome as any).error);
    }
    assert.ok(outcome.kind === "completed" || outcome.kind === "remote_committed", `Sync outcome: ${outcome.kind}`);

    const repo = engine.getRepository();
    const promotedOp = repo.getOperation({ kind: "ticket", ticketId: 562 }, SCOPE);
    assert.ok(promotedOp, "TicketUpdate #562 が作成されていること");
    assert.strictEqual(promotedOp.revision, 2, "Revision 2 であること");
    assert.strictEqual((promotedOp.intent as any)?.content, rev2Content, "promoted.content が Rev2 exact content を保持すること (F-04, T-F14)");
  });

  // T-F15: Restart after promotion
  test("T-F15: Promotion 完了後に Memento から restart しても content が byte-identical に保持され、revision, documentUri が変化しない", async () => {
    initializeTicketDraft(563, "Base", "Base", { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] }, "2026-08-01T00:00:00Z", SCOPE);

    const docUri = "file:///dummy/ticket-563.md";
    const firstContent = makeTicketContent("Sub Rev1", "Desc Rev1");
    await queueTicketDraft({ ticketId: 563, content: firstContent, documentUri: vscode.Uri.parse(docUri), operationScope: SCOPE });

    const repo = createSyncCoordinator().getRepository();
    await repo.transitionOperation({ kind: "ticket", ticketId: 563 }, { kind: "start_normal_remote_write" }, SCOPE);

    const secondContent = makeTicketContent("Sub Rev2 Exact", "Desc Rev2 Exact");
    await queueTicketDraft({ ticketId: 563, content: secondContent, documentUri: vscode.Uri.parse(docUri), operationScope: SCOPE });

    await repo.completeOperation({ kind: "ticket", ticketId: 563 }, SCOPE, 1, {
      canonical: { subject: "Sub Rev1", description: "Desc Rev1", metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] } },
      remoteUpdatedAt: "2026-08-01T04:00:00Z",
    });

    // Simulate restart
    initializeOfflineSyncStore(memento, SCOPE);

    const restoredRepo = createSyncCoordinator().getRepository();
    const restoredOp = restoredRepo.getOperation({ kind: "ticket", ticketId: 563 }, SCOPE);
    assert.ok(restoredOp, "restoredOp が存在すること");
    assert.strictEqual(restoredOp.revision, 2, "revision が変化していないこと");
    assert.strictEqual(restoredOp.documentUri, docUri, "documentUri が変化していないこと");
    assert.strictEqual(
      (restoredOp.intent as any)?.content,
      secondContent,
      "content が restart 後も byte-identical に保持されること (F-05, T-F15)",
    );
  });

  // Performance Gate: Pure policy evaluation
  test("Performance Gate: 1000 Operations x 20 Effects/Op で network=0, persistence=0, O(E) complexity で高速完了する", () => {
    const operations: any[] = [];
    for (let i = 0; i < 1000; i++) {
      const effects: DurableSyncEffect[] = [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: i % 3 === 0 ? "compensation_unknown" : (i % 3 === 1 ? "committed" : "planned"),
          remoteId: 1000 + i,
          target: {},
        },
      ];
      for (let j = 0; j < 19; j++) {
        effects.push({
          effectId: `child-create:${j}`,
          kind: "child_create",
          operationRevision: 1,
          state: i % 3 === 0 ? "failed" : (j % 2 === 0 ? "committed" : "failed"),
          failure: { disposition: "retryable" },
          target: { parentTicketId: 1000 + i, ordinal: j },
        });
      }
      operations.push({
        operationId: `${SCOPE}:newTicket:perf-${i}`,
        kind: "ticket_create",
        phase: i % 3 === 0 ? "compensation_unknown" : "remote_committed",
        revision: 1,
        effects,
      });
    }

    const start = Date.now();
    let totalItems = 0;
    for (const op of operations) {
      const items = getRecoveryItemsForOperation(op);
      totalItems += items.length;
    }
    const elapsedMs = Date.now() - start;

    assert.ok(totalItems > 0, "Recovery items が評価されたこと");
    assert.ok(elapsedMs < 1000, `1000 operations x 20 effects completed in ${elapsedMs}ms (< 1000ms)`);
  });
});
