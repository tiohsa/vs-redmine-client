import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  initializeOfflineSyncStore,
  addOfflineTicketUpdate,
  addOfflineNewTicketAsync,
  addOfflineCommentUpdate,
  getOfflineSyncQueue,
} from "../views/offlineSyncStore";
import { createSyncEngine } from "../app/syncEngine";
import { createTestMemento } from "./helpers/vscodeMemento";
import {
  createSyncOperationRepository,
  DefaultSyncOperationRepository,
} from "../app/ticketSync/syncRepository";
import { SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import {
  TicketCreateHandler,
  TicketUpdateHandler,
  CommentCreateHandler,
  CommentUpdateHandler,
} from "../app/ticketSync/operationHandlers";
import {
  applyGenericTransition,
  retainDurableEffectsForRetry,
} from "../app/ticketSync/syncStateMachine";
import type {
  UnifiedSyncOperation,
  SyncOperationKey,
  TicketCreateIntent,
} from "../app/ticketSync/syncOperationTypes";
import type { DurableSyncEffect } from "../app/syncEffects";

const SCOPE = "https://redmine.example.org/f01-f20-suite";

suite("F-01 〜 F-20: Reproduction & Invariant Tests", () => {
  let memento: vscode.Memento;

  setup(() => {
    memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
  });

  // F-01: planEffect monotonicity
  test("F-01: planEffect monotonicity (committed/started/failed な Effect は planned で上書き・巻戻しされない)", async () => {
    const repo = createSyncOperationRepository();
    addOfflineNewTicketAsync(
      {
        queueId: "f01-op",
        content: "Test Content",
        projectId: 1,
        phase: "queued",
        revision: 1,
      },
      SCOPE,
    );

    const key: SyncOperationKey = { kind: "newTicket", queueId: "f01-op" };

    // 1. Initial plan & commit
    await repo.planEffect(
      key,
      {
        effectId: "ticket-create",
        kind: "ticket_create",
        operationRevision: 1,
        state: "planned",
        target: {},
      },
      SCOPE,
      1,
    );
    await repo.transitionEffect(
      key,
      "ticket-create",
      { kind: "start" },
      SCOPE,
      { operationRevision: 1, sourceState: "planned" },
    );
    await repo.transitionEffect(
      key,
      "ticket-create",
      { kind: "commit", remoteId: 999 },
      SCOPE,
      { operationRevision: 1, sourceState: "started" },
    );

    const afterCommit = repo.getOperation(key, SCOPE);
    const committedEffect = afterCommit?.effects?.find((e) => e.effectId === "ticket-create");
    assert.strictEqual(committedEffect?.state, "committed");
    assert.strictEqual(committedEffect?.remoteId, 999);

    // 2. Try to planEffect again on same revision with planned state
    await repo.planEffect(
      key,
      {
        effectId: "ticket-create",
        kind: "ticket_create",
        operationRevision: 1,
        state: "planned",
        target: {},
      },
      SCOPE,
      1,
    );

    const afterReplan = repo.getOperation(key, SCOPE);
    const effectAfterReplan = afterReplan?.effects?.find((e) => e.effectId === "ticket-create");
    assert.strictEqual(
      effectAfterReplan?.state,
      "committed",
      "F-01: committed な Effect は planEffect で planned に巻き戻されてはならない",
    );
    assert.strictEqual(effectAfterReplan?.remoteId, 999);
  });

  // F-02: failed(non_retriable) normal retry禁止
  test("F-02: failed(non_retriable) な Effect を持つ Operation は normal sync で再送されない", async () => {
    let createIssueCalls = 0;
    addOfflineNewTicketAsync(
      {
        queueId: "f02-op",
        content: "Non-retriable fail ticket",
        projectId: 1,
        phase: "queued",
        revision: 1,
        effects: [
          {
            effectId: "ticket-create",
            kind: "ticket_create",
            operationRevision: 1,
            state: "failed",
            target: {},
            failure: {
              disposition: "non_retriable",
              detail: "403 Forbidden - Access Denied",
            },
          },
        ],
      },
      SCOPE,
    );

    const coordinator = new SyncCoordinator({
      handlers: {
        ticketCreate: new TicketCreateHandler(),
      },
    });

    const outcome = await coordinator.sync(
      { kind: "newTicket", queueId: "f02-op" },
      { connectionScope: SCOPE },
      {
        deps: {
          ticketCreate: {
            createIssue: async () => {
              createIssueCalls++;
              return 100;
            },
          },
        },
      },
    );

    assert.strictEqual(createIssueCalls, 0, "F-02: non_retriable failed では createIssue を呼んではならない");
    assert.strictEqual(outcome.kind, "failed_before_commit");
  });

  // F-03: failed(retryable) explicit only (normal sync retry = 0)
  test("F-03: failed(retryable) な Effect は normal sync から自動再送されず 0 回である", async () => {
    let createIssueCalls = 0;
    addOfflineNewTicketAsync(
      {
        queueId: "f03-op",
        content: "Retryable fail ticket",
        projectId: 1,
        phase: "queued",
        revision: 1,
        effects: [
          {
            effectId: "ticket-create",
            kind: "ticket_create",
            operationRevision: 1,
            state: "failed",
            target: {},
            failure: {
              disposition: "retryable",
              detail: "500 Internal Server Error",
            },
          },
        ],
      },
      SCOPE,
    );

    const coordinator = new SyncCoordinator({
      handlers: {
        ticketCreate: new TicketCreateHandler(),
      },
    });

    const outcome = await coordinator.sync(
      { kind: "newTicket", queueId: "f03-op" },
      { connectionScope: SCOPE },
      {
        deps: {
          ticketCreate: {
            createIssue: async () => {
              createIssueCalls++;
              return 100;
            },
          },
        },
      },
    );

    assert.strictEqual(createIssueCalls, 0, "F-03: failed(retryable) は normal sync で自動再送されてはならない (0回)");
  });

  // F-06: exact Primary retry snapshot
  test("F-06: Primary explicit retry は stored API-ready snapshot のみを使用する", async () => {
    let passedInput: any = undefined;
    const repo = createSyncOperationRepository();

    const snapshotRequest = {
      projectId: 1,
      subject: "Original Frozen Subject",
      description: "Original Frozen Description",
      statusId: 5,
      trackerId: 2,
      priorityId: 3,
      dueDate: "2026-12-31",
      parentId: 42,
      startDate: "2026-01-01",
      doneRatio: 50,
      estimatedHours: 8,
      assigneeId: 10,
    };

    await addOfflineNewTicketAsync(
      {
        queueId: "f06-op",
        content: "Modified local content after failure",
        projectId: 1,
        phase: "commit_unknown",
        revision: 1,
        effects: [
          {
            effectId: "ticket-create",
            kind: "ticket_create",
            operationRevision: 1,
            state: "commit_unknown",
            target: {},
            requestSnapshot: {
              kind: "ticket_create",
              request: snapshotRequest,
            },
          },
        ],
      },
      SCOPE,
    );

    const coordinator = new SyncCoordinator({
      repository: repo,
      handlers: {
        ticketCreate: new TicketCreateHandler(),
      },
    });

    await coordinator.resolveCommitUnknown({
      key: { kind: "newTicket", queueId: "f06-op" },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
      deps: {
        ticketCreate: {
          createIssue: async (input: any) => {
            passedInput = input;
            return 888;
          },
          getIssueDetail: async () => ({
            ticket: { id: 888, projectId: 1, subject: "Original Frozen Subject", updatedAt: "2026-08-17T00:00:00Z" } as any,
            comments: [],
          }),
        },
      },
    });

    assert.ok(passedInput, "createIssue が呼ばれていること");
    assert.strictEqual(passedInput.subject, "Original Frozen Subject", "F-06: retry 時に保存された snapshot の subject が使われること");
    assert.strictEqual(passedInput.parentId, 42, "F-06: parentId が保存された snapshot から保持されること");
    assert.strictEqual(passedInput.doneRatio, 50, "F-06: doneRatio が snapshot から保持されること");
  });

  // F-07: TicketCreate API parity
  test("F-07: TicketCreate API parity (Snapshot と API Input が完全一致しメタデータが欠落しない)", async () => {
    let capturedInput: any = undefined;
    const repo = createSyncOperationRepository();

    addOfflineNewTicketAsync(
      {
        queueId: "f07-op",
        content: "Subject: Ticket with full metadata\nTracker: Feature\nPriority: High\nStatus: In Progress\nDue Date: 2026-12-31\nStart Date: 2026-01-01\nParent: 99\n\nTicket body here",
        projectId: 1,
        phase: "queued",
        revision: 1,
      },
      SCOPE,
    );

    const coordinator = new SyncCoordinator({
      repository: repo,
      handlers: {
        ticketCreate: new TicketCreateHandler(),
      },
    });

    await coordinator.sync(
      { kind: "newTicket", queueId: "f07-op" },
      { connectionScope: SCOPE },
      {
        deps: {
          ticketCreate: {
            resolveMetadataForCreate: async () => ({
              trackerId: 2,
              priorityId: 4,
              statusId: 3,
              doneRatio: 20,
              estimatedHours: 4,
              assigneeId: 15,
            }),
            createIssue: async (input: any) => {
              capturedInput = input;
              return 777;
            },
            getIssueDetail: async () => ({
              ticket: { id: 777, projectId: 1, subject: "Ticket with full metadata", updatedAt: "2026-08-17T00:00:00Z" } as any,
              comments: [],
            }),
          } as any,
        },
      },
    );

    assert.ok(capturedInput, "createIssue が呼ばれたこと");
    assert.strictEqual(capturedInput.parentId, 99, "F-07: parentId が渡されること");
    assert.strictEqual(capturedInput.doneRatio, 20, "F-07: doneRatio が渡されること");
    assert.strictEqual(capturedInput.estimatedHours, 4, "F-07: estimatedHours が渡されること");
    assert.strictEqual(capturedInput.assigneeId, 15, "F-07: assigneeId が渡されること");

    const op = repo.getOperation({ kind: "newTicket", queueId: "f07-op" }, SCOPE);
    const primaryEffect = op?.effects?.find((e) => e.effectId === "ticket-create");
    assert.ok(primaryEffect?.requestSnapshot, "Primary effect に requestSnapshot が記録されていること");
    assert.strictEqual(primaryEffect?.requestSnapshot?.kind, "ticket_create");
    assert.deepStrictEqual((primaryEffect?.requestSnapshot as any).request, capturedInput, "F-07: API Input と Snapshot.request が同一であること");
  });

  // F-08: TicketUpdate API parity
  test("F-08: TicketUpdate API parity (Snapshot.request が { issueId, fields } 構造で snake_case を持たない)", async () => {
    let capturedUpdateInput: any = undefined;
    const repo = createSyncOperationRepository();

    addOfflineTicketUpdate(
      100,
      {
        ticketId: 100,
        baseSubject: "Base Subject",
        baseDescription: "Base Desc",
        baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        subject: "Updated Subject",
        description: "Updated Desc",
        metadata: { tracker: "Bug", priority: "High", status: "In Progress", due_date: "2026-12-31", children: [] },
        phase: "queued",
        revision: 1,
      },
      SCOPE,
    );

    const coordinator = new SyncCoordinator({
      repository: repo,
      handlers: {
        ticketUpdate: new TicketUpdateHandler(),
      },
    });

    await coordinator.sync(
      { kind: "ticket", ticketId: 100 },
      { connectionScope: SCOPE },
      {
        deps: {
          ticketUpdate: {
            updateIssue: async (input: any) => {
              capturedUpdateInput = input;
            },
            getIssueDetail: async () => ({
              ticket: { id: 100, projectId: 1, subject: "Updated Subject", description: "Updated Desc", updatedAt: "2026-08-17T00:00:00Z" } as any,
              comments: [],
            }),
          },
        },
      },
    );

    assert.ok(capturedUpdateInput, "updateIssue が呼ばれたこと");
    assert.strictEqual(capturedUpdateInput.issueId, 100);
    assert.strictEqual(capturedUpdateInput.fields.subject, "Updated Subject");
    assert.strictEqual((capturedUpdateInput as any).tracker_id, undefined, "snake_case フィールドはルートに存在しない");

    const op = repo.getOperation({ kind: "ticket", ticketId: 100 }, SCOPE);
    const primaryEffect = op?.effects?.find((e) => e.effectId === "ticket-update");
    assert.ok(primaryEffect?.requestSnapshot);
    assert.strictEqual(primaryEffect?.requestSnapshot?.kind, "ticket_update");
    assert.deepStrictEqual((primaryEffect?.requestSnapshot as any).request, capturedUpdateInput, "F-08: TicketUpdate Snapshot.request と API Input が完全一致");
  });

  // F-13: Clipboard identity
  test("F-13: Clipboard identity (bytes を spool へ保存し contentHash/contentSize を freeze し retry 時に live clipboard を再読込しない)", async () => {
    let clipboardReadCount = 0;
    const repo = createSyncOperationRepository();

    const op: UnifiedSyncOperation<TicketCreateIntent> = {
      operationId: "f13-op",
      kind: "ticket_create",
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      key: { kind: "newTicket", queueId: "f13-op" },
      intent: {
        projectId: 1,
        subject: "New Ticket with clipboard image",
        description: "New Ticket with clipboard image",
        metadata: { tracker: "Feature", priority: "Normal", status: "New", due_date: "", children: [] },
        attachments: [
          { kind: "clipboard", filename: "pasted.png", contentType: "image/png" },
        ],
      },
    };
    await repo.saveOperation(op, SCOPE);

    const handler = new TicketCreateHandler();

    const prepared = await handler.prepare(
      repo.getOperation({ kind: "newTicket", queueId: "f13-op" }, SCOPE)!,
      { connectionScope: SCOPE },
    );
    assert.ok(prepared.ok);

    const secRes = await handler.executeSecondaryEffects!(
      repo.getOperation({ kind: "newTicket", queueId: "f13-op" }, SCOPE)!,
      prepared.prepared,
      { connectionScope: SCOPE },
      {
        repository: repo,
        ticketCreate: {
          uploadClipboardImage: async () => {
            clipboardReadCount++;
            return { token: "tok-clip-1", filename: "pasted.png", contentType: "image/png" };
          },
        } as any,
      },
    );
    assert.ok(secRes.ok);

    const finalOp = repo.getOperation({ kind: "newTicket", queueId: "f13-op" }, SCOPE);
    const clipEffect = finalOp?.effects?.find((e) => e.effectId.startsWith("attachment:clipboard:"));
    assert.ok(clipEffect, "clipboard effect が記録されていること");
    assert.strictEqual(clipEffect?.state, "committed");
    assert.ok(clipEffect?.requestSnapshot, "snapshot が記録されていること");
    const snap = clipEffect.requestSnapshot as any;
    assert.notStrictEqual(snap.contentHash, "clipboard", "F-13: contentHash は 'clipboard' 文字列ではなく実際のハッシュであること");
    assert.ok(snap.contentSize > 0, "F-13: contentSize は 0 より大きいこと");
  });

  // F-15: Operation/Effect ownership separation
  test("F-15: applyGenericTransition は effects[] を直接変更しない", () => {
    const initialOp: UnifiedSyncOperation = {
      operationId: "f15-op",
      kind: "ticket_create",
      connectionScope: SCOPE,
      phase: "preparing",
      revision: 1,
      persistenceVersion: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: "planned",
          target: {},
        },
      ],
    };

    const nextOp = applyGenericTransition(initialOp, { kind: "start_normal_remote_write" });
    assert.ok(nextOp);
    assert.strictEqual(nextOp.phase, "remote_write_started");
    // Operation State Machine は effect state を started に変更してはならない (F-15, D-01)
    const effect = nextOp.effects?.find((e) => e.effectId === "ticket-create");
    assert.strictEqual(
      effect?.state,
      "planned",
      "F-15: applyGenericTransition は Effect state を変更してはならない (Ownership分離)",
    );
  });

  // F-16: Primary atomic checkpoint
  test("F-16: transitionPrimaryRemoteWrite で Operation phase と Primary effect state が1回の persistence で atomic に遷移する", async () => {
    const repo = createSyncOperationRepository();
    addOfflineNewTicketAsync(
      {
        queueId: "f16-op",
        content: "Atomic Checkpoint Ticket",
        projectId: 1,
        phase: "preparing",
        revision: 1,
      },
      SCOPE,
    );

    const key: SyncOperationKey = { kind: "newTicket", queueId: "f16-op" };

    const snapshotRequest = {
      projectId: 1,
      subject: "Atomic Checkpoint Ticket",
      description: "Desc",
    };

    // Plan effect
    await repo.planEffect(
      key,
      {
        effectId: "ticket-create",
        kind: "ticket_create",
        operationRevision: 1,
        state: "planned",
        target: {},
        requestSnapshot: { kind: "ticket_create", request: snapshotRequest as any },
      },
      SCOPE,
      1,
    );

    // Call transitionPrimaryRemoteWrite start
    const started = await (repo as any).transitionPrimaryRemoteWrite(
      key,
      {
        kind: "start",
        requestSnapshot: { kind: "ticket_create", request: snapshotRequest as any },
      },
      SCOPE,
      { operationId: "f16-op", revision: 1, sourcePhase: "preparing" },
    );

    assert.ok(started, "transitionPrimaryRemoteWrite が成功すること");
    assert.strictEqual(started.phase, "remote_write_started", "Operation phase が remote_write_started に遷移");
    const startedEffect = started.effects?.find((e: DurableSyncEffect) => e.effectId === "ticket-create");
    assert.strictEqual(startedEffect?.state, "started", "Primary effect state が started に遷移");

    // Call transitionPrimaryRemoteWrite commit
    const committed = await (repo as any).transitionPrimaryRemoteWrite(
      key,
      {
        kind: "commit",
        remoteId: 555,
        projectId: 1,
        remoteUpdatedAt: "2026-08-17T00:00:00Z",
      },
      SCOPE,
      { operationId: "f16-op", revision: 1, sourcePhase: "remote_write_started" },
    );

    assert.ok(committed, "commit transition が成功すること");
    assert.strictEqual(committed.phase, "remote_committed");
    assert.strictEqual(committed.createdRemoteId, 555);
    const committedEffect = committed.effects?.find((e: DurableSyncEffect) => e.effectId === "ticket-create");
    assert.strictEqual(committedEffect?.state, "committed");
    assert.strictEqual(committedEffect?.remoteId, 555);
  });

  // F-17: Secondary failed evidence retention
  test("F-17: abort_known_remote_failure 時に failed な Secondary Effect が破棄されず保持される", () => {
    const effects: DurableSyncEffect[] = [
      {
        effectId: "attachment:file:0",
        kind: "attachment_upload",
        operationRevision: 1,
        state: "failed",
        target: {},
        failure: { disposition: "retryable", detail: "Network timeout" },
      },
      {
        effectId: "attachment:file:1",
        kind: "attachment_upload",
        operationRevision: 1,
        state: "committed",
        token: "tok-1",
        target: {},
      },
    ];

    const retained = retainDurableEffectsForRetry(effects);
    assert.strictEqual(retained.length, 2, "F-17: failed な effect も committed な effect と同様に保持されること");
    assert.ok(retained.some((e) => e.effectId === "attachment:file:0" && e.state === "failed"));
  });

  // F-20: scope/revision fence
  test("F-20: ConnectionScope または Revision が不一致の場合 transition は拒否される", async () => {
    const repo = createSyncOperationRepository();
    addOfflineNewTicketAsync(
      {
        queueId: "f20-op",
        content: "Fence Test Ticket",
        projectId: 1,
        phase: "queued",
        revision: 1,
      },
      SCOPE,
    );

    const key: SyncOperationKey = { kind: "newTicket", queueId: "f20-op" };

    // Scope mismatch
    const scopeMismatch = await repo.transitionOperation(
      key,
      { kind: "begin_preparation" },
      "https://other-scope.example.org",
    );
    assert.strictEqual(scopeMismatch, undefined, "F-20: 異なる scope では操作できないこと");

    // Revision mismatch
    const revMismatch = await repo.transitionOperation(
      key,
      { kind: "begin_preparation" },
      SCOPE,
      { operationId: "f20-op", revision: 99, sourcePhase: "queued" },
    );
    assert.strictEqual(revMismatch, undefined, "F-20: 異なる revision では遷移できないこと");
  });
});
