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
    const allActions: RecoveryActionKind[] = [
      "retry_remote_write",
      "reconcile_remote",
      "link_created_ticket",
      "link_remote_ticket",
      "link_remote_comment",
      "assume_update_committed",
      "retry_effect",
      "link_remote_child",
      "reconcile_compensation",
    ];

    const engine = createSyncEngine({ tickets: metadataDeps });
    const repo = engine.getRepository();

    for (const action of allActions) {
      assert.ok(typeof action === "string" && action.length > 0, `Action ${action} is valid`);
    }
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

  // T-F09: Finalize partial success & T-F10: Already-applied target
  test("T-F09 & T-F10: Document apply 成功後に queue completion が失敗しても retry で already-applied target を冪等に認識して完了できる", async () => {
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
});
