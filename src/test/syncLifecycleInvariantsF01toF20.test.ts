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
import {
  type DurableSyncEffect,
  restoreDurableSyncEffect,
} from "../app/syncEffects";
import {
  computeFileHashAndSize,
  computeFileHashAndSizeAsync,
} from "../utils/fileHash";

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
      operationId: "f06-op",
      operationRevision: 1,
      context: { connectionScope: SCOPE },
      attemptGeneration: 1,
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
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
    const repo = createSyncOperationRepository();
    let clipboardReadCount = 0;

    await vscode.env.clipboard.writeText("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

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

    const metadataDeps = {
      getProjectTrackers: async () => [{ id: 1, name: "Feature" }],
      listIssueStatuses: async () => [{ id: 1, name: "New" }],
      listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
    };

    const prepared = await handler.prepare(
      repo.getOperation({ kind: "newTicket", queueId: "f13-op" }, SCOPE)!,
      { connectionScope: SCOPE },
      {
        ticketCreate: metadataDeps as any,
      },
    );
    assert.ok(prepared.ok);

    const secRes = await handler.executeSecondaryEffects!(
      repo.getOperation({ kind: "newTicket", queueId: "f13-op" }, SCOPE)!,
      prepared.prepared,
      { connectionScope: SCOPE },
      {
        repository: repo,
        ticketCreate: {
          ...metadataDeps,
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
    await addOfflineNewTicketAsync(
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
  test("F-04: Secondary Remote 成功 + commit checkpoint failure で Effect evidence を失わず normal sync で再送しない", async () => {
    let uploadCalls = 0;
    const tmpFile = path.join(os.tmpdir(), "f04-test-file.txt");
    fs.writeFileSync(tmpFile, "F04 attachment test content");

    const metadataDeps = {
      getProjectTrackers: async () => [{ id: 1, name: "Feature" }],
      listIssueStatuses: async () => [{ id: 1, name: "New" }],
      listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      getIssueDetail: async (id: number) => ({
        ticket: { id, projectId: 1, subject: "F04", description: "" },
        comments: [],
      }),
    };

    try {
      const memento = createTestMemento();
      initializeOfflineSyncStore(memento, SCOPE);
      const repo = createSyncOperationRepository();

      await repo.saveOperation({
        operationId: "f04-op",
        kind: "ticket_create",
        key: { kind: "newTicket", queueId: "f04-op" },
        connectionScope: SCOPE,
        phase: "queued",
        revision: 1,
        persistenceVersion: 1,
        projectId: 1,
        intent: {
          projectId: 1,
          subject: "F04 Ticket Content",
          description: "F04 Ticket Content",
          metadata: { tracker: "Feature", priority: "Normal", status: "New", due_date: "", children: [] },
        },
      }, SCOPE);

      // Custom handler that fails commit checkpoint after upload
      class CustomTicketCreateHandler extends TicketCreateHandler {
        public override async executeSecondaryEffects(
          op: any,
          prep: any,
          ctx: any,
          deps?: any,
        ) {
          const currentRepo = deps?.repository ?? repo;
          const currentOp = currentRepo.getOperation(op.key, SCOPE) ?? op;
          const effectId = `attachment:file:0:${tmpFile}`;
          const existingEffect = currentOp.effects?.find((e: any) => e.effectId === effectId);
          if (existingEffect?.state === "commit_unknown") {
            return { ok: false as const, error: new Error("Already commit_unknown"), commitUnknown: true };
          }
          uploadCalls++;
          const fileId = computeFileHashAndSize(tmpFile)!;
          const uploadSnapshot = {
            kind: "upload" as const,
            filePath: tmpFile,
            filename: "f04-test-file.txt",
            contentType: "text/plain",
            contentHash: fileId.contentHash,
            contentSize: fileId.contentSize,
          };
          await currentRepo.planEffect(op.key, {
            effectId,
            kind: "attachment_upload",
            operationRevision: 1,
            state: "planned",
            target: { filePath: tmpFile },
            requestSnapshot: uploadSnapshot,
          }, SCOPE, 1);
          await currentRepo.transitionEffect(op.key, effectId, { kind: "start", requestSnapshot: uploadSnapshot }, SCOPE, { operationRevision: 1, sourceState: "planned" });
          // Upload succeeds remotely, but commit checkpoint fails
          await currentRepo.transitionEffect(op.key, effectId, { kind: "mark_commit_unknown" }, SCOPE, { operationRevision: 1, sourceState: "started" });
          return { ok: false as const, error: new Error("Commit checkpoint failed"), commitUnknown: true };
        }
      }

      const coordinator = new SyncCoordinator({
        repository: repo,
        handlers: {
          ticketCreate: new CustomTicketCreateHandler(),
        },
      });

      const outcome1 = await coordinator.sync(
        { kind: "newTicket", queueId: "f04-op" },
        { connectionScope: SCOPE },
        { deps: { ticketCreate: metadataDeps as any } },
      );
      assert.strictEqual(outcome1.kind, "failed_before_commit");

      // Verify effect evidence remains
      const afterFirst = repo.getOperation({ kind: "newTicket", queueId: "f04-op" }, SCOPE);
      const effect = afterFirst?.effects?.find((e) => e.effectId.startsWith("attachment:file:0"));
      assert.ok(effect, "F-04: Effect evidence が保持されていること");
      assert.strictEqual(effect?.state, "commit_unknown");

      // Second normal sync: must not retry upload
      const outcome2 = await coordinator.sync(
        { kind: "newTicket", queueId: "f04-op" },
        { connectionScope: SCOPE },
        { deps: { ticketCreate: metadataDeps as any } },
      );
      assert.strictEqual(uploadCalls, 1, "F-04: commit_unknown な Secondary Effect は normal sync で再送されないこと (uploadCalls === 1)");
      assert.strictEqual(outcome2.kind, "failed_before_commit");
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  });

  // F-05: Primary atomic START crash gap
  test("F-05: Coordinator から Primary Operation-only start を呼ばず、transitionPrimaryRemoteWrite で Operation と Effect が atomic に遷移する", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
    const repo = createSyncOperationRepository();

    await repo.saveOperation({
      operationId: "f05-op",
      kind: "ticket_create",
      key: { kind: "newTicket", queueId: "f05-op" },
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      projectId: 1,
      intent: {
        projectId: 1,
        subject: "F05 Ticket Content",
        description: "F05 Ticket Content",
        metadata: { tracker: "Feature", priority: "Normal", status: "New", due_date: "", children: [] },
      },
    }, SCOPE);

    let observedOperationPhaseBeforeRemote: string | undefined;
    let observedEffectStateBeforeRemote: string | undefined;
    let observedSnapshotBeforeRemote: any = undefined;

    const metadataDeps = {
      getProjectTrackers: async () => [{ id: 1, name: "Feature" }],
      listIssueStatuses: async () => [{ id: 1, name: "New" }],
      listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      getIssueDetail: async (id: number) => ({
        ticket: { id, projectId: 1, subject: "F05 Ticket Content", description: "F05 Ticket Content" },
        comments: [],
      }),
    };

    class ObservingTicketCreateHandler extends TicketCreateHandler {
      public override async executeRemoteWrite(
        op: any,
        prep: any,
        ctx: any,
        deps?: any,
      ) {
        const currentRepo = deps?.repository ?? repo;
        // executeRemoteWrite enters with preparing phase
        const beforeStart = currentRepo.getOperation(op.key, SCOPE);
        assert.ok(
          beforeStart?.phase === "queued" || beforeStart?.phase === "preparing",
          "F-05: Coordinator は handler 呼び出し前に start_normal_remote_write で Operation だけ進めてはならない",
        );

        const snap = {
          kind: "ticket_create" as const,
          request: { projectId: 1, subject: "F05", description: "" },
        };
        const started = await currentRepo.transitionPrimaryRemoteWrite(
          op.key,
          { kind: "start", requestSnapshot: snap },
          SCOPE,
          { operationId: op.operationId, revision: 1, sourcePhase: beforeStart?.phase ?? op.phase },
        );
        assert.ok(started, "transitionPrimaryRemoteWrite(start) が成功すること");

        const inFlight = currentRepo.getOperation(op.key, SCOPE);
        observedOperationPhaseBeforeRemote = inFlight?.phase;
        const primaryEffect = inFlight?.effects?.find((e: any) => e.effectId === "ticket-create");
        observedEffectStateBeforeRemote = primaryEffect?.state;
        observedSnapshotBeforeRemote = primaryEffect?.requestSnapshot;

        // Commit
        await currentRepo.transitionPrimaryRemoteWrite(
          op.key,
          { kind: "commit", remoteId: 777, projectId: 1, requestSnapshot: snap },
          SCOPE,
          { operationId: op.operationId, revision: 1, sourcePhase: "remote_write_started" },
        );

        return {
          ok: true as const,
          createdRemoteId: 777,
          projectId: 1,
        };
      }
    }

    const coordinator = new SyncCoordinator({
      repository: repo,
      handlers: {
        ticketCreate: new ObservingTicketCreateHandler(),
      },
    });

    const outcome = await coordinator.sync(
      { kind: "newTicket", queueId: "f05-op" },
      { connectionScope: SCOPE },
      { deps: { ticketCreate: metadataDeps as any } },
    );
    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(observedOperationPhaseBeforeRemote, "remote_write_started");
    assert.strictEqual(observedEffectStateBeforeRemote, "started");
    assert.ok(observedSnapshotBeforeRemote, "RequestSnapshot が durable に保存されていること");
  });

  // F-09: Primary known failure durability
  test("F-09: Primary known failure で failed Effect が durable に保持され、normal sync=0, explicit retry=1 (non_retriable は retry=0)", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
    const repo = createSyncOperationRepository();
    let createCalls = 0;

    const metadataDeps = {
      getProjectTrackers: async () => [{ id: 1, name: "Feature" }],
      listIssueStatuses: async () => [{ id: 1, name: "New" }],
      listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      getIssueDetail: async (id: number) => ({
        ticket: { id, projectId: 1, subject: "F09 Ticket Content", description: "F09 Ticket Content" },
        comments: [],
      }),
    };

    await repo.saveOperation({
      operationId: "f09-op",
      kind: "ticket_create",
      key: { kind: "newTicket", queueId: "f09-op" },
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      projectId: 1,
      intent: {
        projectId: 1,
        subject: "F09 Ticket Content",
        description: "F09 Ticket Content",
        metadata: { tracker: "Feature", priority: "Normal", status: "New", due_date: "", children: [] },
      },
    }, SCOPE);

    const coordinator = new SyncCoordinator({
      repository: repo,
      handlers: {
        ticketCreate: new TicketCreateHandler(),
      },
    });

    // 1. Initial attempt fails with retryable error (503 Service Unavailable)
    const outcome1 = await coordinator.sync(
      { kind: "newTicket", queueId: "f09-op" },
      { connectionScope: SCOPE },
      {
        deps: {
          ticketCreate: {
            ...metadataDeps,
            createIssue: async () => {
              createCalls++;
              throw new Error("503 Service Unavailable");
            },
          },
        },
      },
    );
    assert.strictEqual(outcome1.kind, "failed_before_commit");
    assert.strictEqual(createCalls, 1);

    // Verify Effect is failed(retryable) and Operation persists
    const afterFail = repo.getOperation({ kind: "newTicket", queueId: "f09-op" }, SCOPE);
    assert.ok(afterFail, "F-09: Operation が保持されていること");
    const primaryEffect = afterFail?.effects?.find((e) => e.effectId === "ticket-create");
    assert.strictEqual(primaryEffect?.state, "failed");
    assert.strictEqual(primaryEffect?.failure?.disposition, "retryable");

    // 2. Second normal sync: Remote call = 0
    const outcome2 = await coordinator.sync(
      { kind: "newTicket", queueId: "f09-op" },
      { connectionScope: SCOPE },
      {
        deps: {
          ticketCreate: {
            ...metadataDeps,
            createIssue: async () => {
              createCalls++;
              return 888;
            },
          },
        },
      },
    );
    assert.strictEqual(createCalls, 1, "F-09: failed(retryable) は normal sync で自動再送されない (0回)");

    // 3. Explicit recovery retry: Remote call = 1 and succeeds
    const outcome3 = await coordinator.resolveCommitUnknown({
      key: { kind: "newTicket", queueId: "f09-op" },
      operationId: "f09-op",
      operationRevision: 1,
      context: { connectionScope: SCOPE },
      attemptGeneration: 1,
      resolution: { kind: "retry_remote_write" },
      deps: {
        ticketCreate: {
          ...metadataDeps,
          createIssue: async () => {
            createCalls++;
            return 888;
          },
        },
      },
    });
    assert.strictEqual(outcome3.kind, "completed");
    assert.strictEqual(createCalls, 2, "F-09: explicit recovery で 1回だけ Remote API が呼ばれること");

    // 4. Non-retriable failure: explicit recovery rejected
    await repo.saveOperation({
      operationId: "f09-non-retriable",
      kind: "ticket_create",
      key: { kind: "newTicket", queueId: "f09-non-retriable" },
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      projectId: 1,
      intent: {
        projectId: 1,
        subject: "F09 Non Retriable Content",
        description: "F09 Non Retriable Content",
        metadata: { tracker: "Feature", priority: "Normal", status: "New", due_date: "", children: [] },
      },
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: "failed",
          target: {},
          failure: { disposition: "non_retriable", detail: "422 Unprocessable Entity" },
        },
      ],
    }, SCOPE);

    let nonRetriableCalls = 0;
    const outcome4 = await coordinator.resolveCommitUnknown({
      key: { kind: "newTicket", queueId: "f09-non-retriable" },
      operationId: "f09-non-retriable",
      operationRevision: 1,
      context: { connectionScope: SCOPE },
      attemptGeneration: 1,
      resolution: { kind: "retry_remote_write" },
      deps: {
        ticketCreate: {
          createIssue: async () => {
            nonRetriableCalls++;
            return 999;
          },
        },
      },
    });
    assert.strictEqual(outcome4.kind, "failed_before_commit");
    assert.strictEqual(nonRetriableCalls, 0, "F-09: non_retriable な Primary は explicit retry でも Remote mutation = 0");
  });

  // F-10: File missing
  test("F-10: 存在しない filePath では identity 取得失敗 (undefined) となり Effect start なし・Remote upload=0", async () => {
    const missingPath = path.join(os.tmpdir(), "non-existent-file-12345.png");

    const syncIdentity = computeFileHashAndSize(missingPath);
    assert.strictEqual(syncIdentity, undefined, "F-10: 存在しないファイルで path 文字列 hash を生成せず undefined を返すこと");

    const asyncIdentity = await computeFileHashAndSizeAsync(missingPath);
    assert.strictEqual(asyncIdentity, undefined, "F-10: async 版も存在しないファイルで undefined を返すこと");

    let uploadCalls = 0;
    const handler = new TicketCreateHandler();
    const result = await handler.executeSecondaryEffects(
      {
        operationId: "f10-op",
        kind: "ticket_create",
        phase: "preparing",
        revision: 1,
        intent: {
          projectId: 1,
          attachments: [{ kind: "file", filePath: missingPath, filename: "missing.png" }],
        },
      } as any,
      { uploadTokens: [] } as any,
      { connectionScope: SCOPE },
      {
        ticketCreate: {
          uploadFile: async () => {
            uploadCalls++;
            return { token: "tok", filename: "missing.png", contentType: "image/png" };
          },
        },
      } as any,
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(uploadCalls, 0, "F-10: missing file の場合 Remote upload = 0 であること");
  });

  // F-11: File changed after snapshot
  test("F-11: Snapshot 後にファイル内容が変更された場合、Remote upload=0", async () => {
    const tmpFile = path.join(os.tmpdir(), "f11-test-file.txt");
    fs.writeFileSync(tmpFile, "Original content v1");

    try {
      const repo = createSyncOperationRepository();
      const initialId = computeFileHashAndSize(tmpFile)!;

      const snapshot = {
        kind: "upload" as const,
        filePath: tmpFile,
        filename: "f11-test-file.txt",
        contentType: "text/plain",
        contentHash: initialId.contentHash,
        contentSize: initialId.contentSize,
      };

      await addOfflineNewTicketAsync(
        {
          queueId: "f11-op",
          content: "F11 Content",
          projectId: 1,
          phase: "queued",
          revision: 1,
          effects: [
            {
              effectId: "attachment:file:0",
              kind: "attachment_upload",
              operationRevision: 1,
              state: "failed",
              target: { filePath: tmpFile },
              requestSnapshot: snapshot,
              failure: { disposition: "retryable", detail: "timeout" },
            },
          ],
        },
        SCOPE,
      );

      // Modify file content
      fs.writeFileSync(tmpFile, "Changed content v2");

      let uploadCalls = 0;
      const handler = new TicketCreateHandler();
      const outcome = await handler.resolveEffect({
        key: { kind: "newTicket", queueId: "f11-op" },
        effectId: "attachment:file:0",
        operation: repo.getOperation({ kind: "newTicket", queueId: "f11-op" }, SCOPE) as any,
        context: { connectionScope: SCOPE },
        deps: {
          repository: repo,
          ticketCreate: {
            uploadFile: async () => {
              uploadCalls++;
              return { token: "tok-v2", filename: "f11.txt", contentType: "text/plain" };
            },
          },
        } as any,
        resolution: { kind: "retry_effect" },
      });

      assert.strictEqual(outcome.kind, "failed_before_commit");
      assert.strictEqual(uploadCalls, 0, "F-11: 内容が変更されたファイルは retry されず Remote upload = 0");
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  });

  // F-12: File removed after snapshot
  test("F-12: Snapshot 後にファイルが削除された場合、Remote upload=0", async () => {
    const tmpFile = path.join(os.tmpdir(), "f12-test-file.txt");
    fs.writeFileSync(tmpFile, "Temporary content");
    const initialId = computeFileHashAndSize(tmpFile)!;

    const repo = createSyncOperationRepository();
    const snapshot = {
      kind: "upload" as const,
      filePath: tmpFile,
      filename: "f12-test-file.txt",
      contentType: "text/plain",
      contentHash: initialId.contentHash,
      contentSize: initialId.contentSize,
    };

    await addOfflineNewTicketAsync(
      {
        queueId: "f12-op",
        content: "F12 Content",
        projectId: 1,
        phase: "queued",
        revision: 1,
        effects: [
          {
            effectId: "attachment:file:0",
            kind: "attachment_upload",
            operationRevision: 1,
            state: "failed",
            target: { filePath: tmpFile },
            requestSnapshot: snapshot,
            failure: { disposition: "retryable", detail: "network" },
          },
        ],
      },
      SCOPE,
    );

    // Delete file
    fs.unlinkSync(tmpFile);

    let uploadCalls = 0;
    const handler = new TicketCreateHandler();
    const outcome = await handler.resolveEffect({
      key: { kind: "newTicket", queueId: "f12-op" },
      effectId: "attachment:file:0",
      operation: repo.getOperation({ kind: "newTicket", queueId: "f12-op" }, SCOPE) as any,
      context: { connectionScope: SCOPE },
      deps: {
        repository: repo,
        ticketCreate: {
          uploadFile: async () => {
            uploadCalls++;
            return { token: "tok", filename: "f12.txt", contentType: "text/plain" };
          },
        },
      } as any,
      resolution: { kind: "retry_effect" },
    });

    assert.strictEqual(outcome.kind, "failed_before_commit");
    assert.strictEqual(uploadCalls, 0, "F-12: 削除されたファイルは retry されず Remote upload = 0");
  });

  // F-14: same Revision / different planned Snapshot
  test("F-14: same Revision で planned な Effect に対する different Snapshot の planEffect は拒絶される", async () => {
    const repo = createSyncOperationRepository();
    const key: SyncOperationKey = { kind: "newTicket", queueId: "f14-op" };

    await addOfflineNewTicketAsync(
      {
        queueId: "f14-op",
        content: "F14 Content",
        projectId: 1,
        phase: "queued",
        revision: 1,
      },
      SCOPE,
    );

    const snapshotA = {
      kind: "upload" as const,
      filename: "a.png",
      contentType: "image/png",
      contentHash: "hash-A",
      contentSize: 100,
    };
    const snapshotB = {
      kind: "upload" as const,
      filename: "b.png",
      contentType: "image/png",
      contentHash: "hash-B",
      contentSize: 200,
    };

    // 1. Plan with Snapshot A -> Success
    const resA = await repo.planEffect(
      key,
      {
        effectId: "image:1",
        kind: "image_upload",
        operationRevision: 1,
        state: "planned",
        target: {},
        requestSnapshot: snapshotA,
      },
      SCOPE,
      1,
    );
    assert.ok(resA, "Snapshot A の planEffect は成功すること");

    // 2. Plan same revision with identical Snapshot A -> Idempotent Success
    const resAIdempotent = await repo.planEffect(
      key,
      {
        effectId: "image:1",
        kind: "image_upload",
        operationRevision: 1,
        state: "planned",
        target: {},
        requestSnapshot: snapshotA,
      },
      SCOPE,
      1,
    );
    assert.ok(resAIdempotent, "同一 Snapshot A での planEffect は idempotent に成功すること");

    // 3. Plan same revision with different Snapshot B -> Rejected (undefined)
    const resB = await repo.planEffect(
      key,
      {
        effectId: "image:1",
        kind: "image_upload",
        operationRevision: 1,
        state: "planned",
        target: {},
        requestSnapshot: snapshotB,
      },
      SCOPE,
      1,
    );
    assert.strictEqual(resB, undefined, "F-14: same revision で異なる Snapshot B の planEffect は拒絶されること");

    const current = repo.getOperation(key, SCOPE);
    const effect = current?.effects?.find((e) => e.effectId === "image:1");
    assert.strictEqual((effect?.requestSnapshot as any)?.contentHash, "hash-A", "F-14: stored snapshot は Snapshot A のままであること");
  });

  // F-18: restart normalization
  test("F-18: restart normalization (started は commit_unknown に正規化され、failed/commit_unknown/committed/compensation は保持され automatic retry=0)", () => {
    const rawEffects: DurableSyncEffect[] = [
      { effectId: "e-planned", kind: "ticket_create", operationRevision: 1, state: "planned", target: {} },
      { effectId: "e-started", kind: "attachment_upload", operationRevision: 1, state: "started", target: {} },
      { effectId: "e-failed", kind: "attachment_upload", operationRevision: 1, state: "failed", target: {}, failure: { disposition: "retryable" } },
      { effectId: "e-unknown", kind: "comment_create", operationRevision: 1, state: "commit_unknown", target: {} },
      { effectId: "e-committed", kind: "image_upload", operationRevision: 1, state: "committed", token: "tok-c", target: {} },
      { effectId: "e-comp-started", kind: "ticket_create", operationRevision: 1, state: "compensation_started", target: {} },
      { effectId: "e-comp-unknown", kind: "ticket_create", operationRevision: 1, state: "compensation_unknown", target: {} },
    ];

    const restored = rawEffects.map(restoreDurableSyncEffect);

    assert.strictEqual(restored.find((e) => e.effectId === "e-planned")?.state, "planned");
    assert.strictEqual(restored.find((e) => e.effectId === "e-started")?.state, "commit_unknown", "F-18: started は restart で commit_unknown に正規化される");
    assert.strictEqual(restored.find((e) => e.effectId === "e-failed")?.state, "failed", "F-18: failed は保持される");
    assert.strictEqual(restored.find((e) => e.effectId === "e-unknown")?.state, "commit_unknown", "F-18: commit_unknown は保持される");
    assert.strictEqual(restored.find((e) => e.effectId === "e-committed")?.state, "committed", "F-18: committed は保持される");
    assert.strictEqual(restored.find((e) => e.effectId === "e-comp-started")?.state, "compensation_unknown", "F-18: compensation_started は restart で compensation_unknown に正規化される");
    assert.strictEqual(restored.find((e) => e.effectId === "e-comp-unknown")?.state, "compensation_unknown", "F-18: compensation_unknown は保持される");

    // Retained effects filter test: none of durable states are deleted
    const retained = retainDurableEffectsForRetry(restored);
    assert.strictEqual(retained.length, 6, "F-18: planned 以外の durable な Effect はすべて保持されること");
  });

  // F-19: Normal Sync vs Recovery race
  test("F-19: Normal Sync と Recovery の並行実行時に Remote mutation <= 1 となる", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
    let createCalls = 0;
    const repo = createSyncOperationRepository();

    await addOfflineNewTicketAsync(
      {
        queueId: "f19-op",
        content: "F19 Race Ticket Content",
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
              request: { projectId: 1, subject: "F19", description: "" },
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

    const createDeps = {
      ticketCreate: {
        getProjectTrackers: async () => [{ id: 1, name: "Feature" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "F19", description: "" },
          comments: [],
        }),
        createIssue: async () => {
          createCalls++;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return 999;
        },
      },
    };

    // Run normal sync and recovery simultaneously
    const [outcome1, outcome2] = await Promise.all([
      coordinator.sync({ kind: "newTicket", queueId: "f19-op" }, { connectionScope: SCOPE }, { deps: createDeps }),
      coordinator.resolveCommitUnknown({
        key: { kind: "newTicket", queueId: "f19-op" },
        operationId: "f19-op",
        operationRevision: 1,
        context: { connectionScope: SCOPE },
        attemptGeneration: 1,
        resolution: { kind: "retry_remote_write" },
        deps: createDeps,
      }),
    ]);

    assert.ok(outcome1.kind === "commit_unknown" || outcome1.kind === "completed" || outcome1.kind === "failed_before_commit");
    assert.ok(outcome2.kind === "completed" || outcome2.kind === "commit_unknown" || outcome2.kind === "failed_before_commit" || outcome2.kind === "remote_committed");
    assert.ok(createCalls <= 1, `F-19: 並行実行時の Remote mutation は 1回以下であること (実際: ${createCalls})`);
  });
});
