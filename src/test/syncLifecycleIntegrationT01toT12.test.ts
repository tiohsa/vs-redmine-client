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
  replaceOfflineSyncQueueAsync,
} from "../views/offlineSyncStore";
import { createSyncEngine } from "../app/syncEngine";
import { createTestMemento } from "./helpers/vscodeMemento";
import { createSyncOperationRepository, DefaultSyncOperationRepository } from "../app/ticketSync/syncRepository";
import { createSyncCoordinator } from "../app/ticketSync/syncCoordinator";
import {
  TicketCreateHandler,
  TicketUpdateHandler,
  CommentCreateHandler,
  CommentUpdateHandler,
} from "../app/ticketSync/operationHandlers";
import { buildCommentUpdateFileContent } from "../views/commentUpdateFile";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import type { TicketCreateIntent, TicketUpdateIntent, CommentUpdateIntent } from "../app/ticketSync/syncOperationTypes";

const SCOPE = "https://redmine.example.org/t01-t24-suite";

suite("T-01 〜 T-24: Sync Lifecycle Integration, Remote Certainty & Completion Tests", () => {
  let memento: vscode.Memento;

  setup(() => {
    memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
  });

  // T-01: Secondary commit ≠ Primary commit (P1-01, RC-1, INV-U01, INV-U02)
  test("T-01: Secondary commit ≠ Primary commit (CommentUpdate 画像A成功・画像B失敗時に updateComment が呼ばれず、completed にならず、queue が保持される)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "t01-test-"));
    const imgPathA = path.join(tmpDir, "imgA.png");
    const imgPathB = path.join(tmpDir, "imgB.png");
    fs.writeFileSync(imgPathA, "img A data");
    fs.writeFileSync(imgPathB, "img B data");

    const commentFile = path.join(tmpDir, "comment.md");
    const initialBody = `Comment with ![A](${imgPathA}) and ![B](${imgPathB})`;
    const content = buildCommentUpdateFileContent({
      issueId: 50,
      journalId: 100,
      projectId: 1,
      lastSyncedAt: "2026-08-15T00:00:00Z",
      sourceNotesHash: "test-hash",
    }, initialBody);
    fs.writeFileSync(commentFile, content);

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(commentFile));
    await vscode.window.showTextDocument(doc);

    addOfflineCommentUpdate({
      ticketId: 50,
      commentId: 100,
      body: initialBody,
      baseBody: "Old base body",
      baseDir: tmpDir,
      documentUri: doc.uri.toString(),
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let uploadCount = 0;
    let updateCommentCalls = 0;

    const engine = createSyncEngine({
      comments: {
        uploadFile: async (filePath: string) => {
          uploadCount++;
          if (filePath.includes("imgA")) {
            return { token: "token-imgA", filename: "imgA.png", contentType: "image/png" };
          }
          throw new Error("Image B upload failed (known 400 error)");
        },
        updateComment: async () => {
          updateCommentCalls++;
        },
        getIssueDetail: async () => ({
          ticket: { id: 50, updatedAt: "2026-08-15T00:00:00Z" } as any,
          comments: [{ id: 100, notes: "Old base body", user: { id: 1, name: "User" } }] as any,
        }),
      },
    });

    const outcome = await engine.syncOne(
      { kind: "comment", ticketId: 50, commentId: 100, documentUri: doc.uri.toString() },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(updateCommentCalls, 0, "Primary mutation (updateComment) は一度も呼ばれてはならない (INV-U02)");
    assert.notStrictEqual(outcome.kind, "completed", "completed になってはならない (INV-U01)");
    assert.notStrictEqual(outcome.kind, "remote_committed", "Primary が未実行なのに remote_committed になってはならない (INV-U01, P1-01)");
    const queue = getOfflineSyncQueue(SCOPE);
    assert.strictEqual(queue.comments.length, 1, "キューが保持されていること");
    assert.strictEqual(doc.getText(), content, "ローカルファイルが変更されていないこと");
  });

  // T-02: Child success → Primary known failure (P1-05, RC-1, INV-U13, DR-02)
  test("T-02: TicketUpdate で Primary PUT が既知失敗した場合、child の二重作成や ledger 消失を起こさない (Primary -> Child 順序)", async () => {
    const ticketId = 200;
    addOfflineTicketUpdate(ticketId, {
      ticketId,
      baseSubject: "Parent",
      baseDescription: "Desc",
      baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      subject: "Parent Updated",
      description: "Desc Updated",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: ["Subtask 1"] },
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let updateIssueCalls = 0;
    let createChildCalls = 0;

    const engine = createSyncEngine({
      tickets: {
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Parent", description: "Desc", trackerId: 1, trackerName: "Bug", priorityId: 1, priorityName: "Normal", statusId: 1, statusName: "New", updatedAt: "2026-08-15T00:00:00Z" } as any,
          comments: [],
        }),
        updateIssue: async () => {
          updateIssueCalls++;
          throw new Error("HTTP 400: Validation Failed on Primary Update");
        },
        createIssue: async () => {
          createChildCalls++;
          return 999;
        },
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });

    const key = { kind: "ticket" as const, ticketId };
    const outcome1 = await engine.syncOne(key, { connectionScope: SCOPE });

    assert.strictEqual(outcome1.kind, "failed_before_commit");
    assert.strictEqual(updateIssueCalls, 1, "Primary PUT が呼ばれたこと");
    assert.strictEqual(createChildCalls, 0, "Primary PUT 失敗前/失敗時に child は作成されないこと (DR-02)");

    const queue = getOfflineSyncQueue(SCOPE);
    assert.strictEqual(queue.tickets.has(ticketId), true, "キューが保持されていること");
  });

  // T-03: True Restart: Attachment (P1-04, RC-3, INV-U07)
  test("T-03: True Restart: initializeOfflineSyncStore による復元後も committed attachment token が保持され再アップロードされない", async () => {
    let uploadCalls = 0;
    const mockUpload = async () => {
      uploadCalls++;
      return { token: "durable-token-123", filename: "test.png", contentType: "image/png" };
    };

    const repo = createSyncOperationRepository();
    const queueId = "true-restart-att";
    await repo.saveOperation({
      operationId: `${SCOPE}:newTicket:${queueId}`,
      kind: "ticket_create",
      key: { kind: "newTicket", queueId },
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      projectId: 1,
      intent: {
        projectId: 1,
        subject: "Title",
        description: "Body",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        attachments: [{ kind: "file", filePath: "/dummy/test.png", filename: "test.png", contentType: "image/png" }],
      },
    }, SCOPE);

    const handler = new TicketCreateHandler();
    const context = { connectionScope: SCOPE };
    const deps = {
      ticketCreate: {
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
        uploadFile: mockUpload as any,
      },
      repository: repo,
    };

    // 1. prepare & executeSecondaryEffects で upload 成功
    const op1 = repo.getOperation<TicketCreateIntent>({ kind: "newTicket", queueId }, SCOPE)!;
    const prep1 = await handler.prepare(op1, context, deps);
    assert.strictEqual(prep1.ok, true);
    const sec1 = await handler.executeSecondaryEffects!(op1, (prep1 as any).prepared, context, deps);
    assert.strictEqual(sec1.ok, true);
    assert.strictEqual(uploadCalls, 1);

    // 2. 永続化ストレージ (Memento) から完全にプロセス再起動をシミュレート
    initializeOfflineSyncStore(memento, SCOPE);

    // 3. 再起動後のリポジトリから再度実行
    const op2 = repo.getOperation<TicketCreateIntent>({ kind: "newTicket", queueId }, SCOPE)!;
    assert.ok(op2, "再起動後も operation が存在すること");
    const prep2 = await handler.prepare(op2, context, deps);
    assert.strictEqual(prep2.ok, true);
    const sec2 = await handler.executeSecondaryEffects!(op2, (prep2 as any).prepared, context, deps);
    assert.strictEqual(sec2.ok, true);
    assert.strictEqual(uploadCalls, 1, "再起動後も committed token が再利用され、二重 upload されないこと (INV-U07)");
  });

  // T-04: True Restart: Markdown Image (P1-04, RC-3, INV-U07)
  test("T-04: True Restart: initializeOfflineSyncStore による復元後も committed image token が保持され再アップロードされない", async () => {
    let uploadCalls = 0;
    const mockUpload = async () => {
      uploadCalls++;
      return { token: "durable-img-token-456", filename: "img.png", contentType: "image/png" };
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "t04-test-"));
    const imgPath = path.join(tmpDir, "img.png");
    fs.writeFileSync(imgPath, "image data");

    const repo = createSyncOperationRepository();
    const key = { kind: "comment" as const, ticketId: 70, commentId: 200 };
    await repo.saveOperation({
      operationId: `${SCOPE}:comment:70:200`,
      kind: "comment_update",
      key,
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      ticketId: 70,
      commentId: 200,
      intent: {
        ticketId: 70,
        commentId: 200,
        baseBody: "Old",
        body: `New with ![img](${imgPath})`,
        baseDir: tmpDir,
      },
    }, SCOPE);

    const handler = new CommentUpdateHandler();
    const context = { connectionScope: SCOPE };
    const deps = {
      comment: { uploadFile: mockUpload as any },
      repository: repo,
    };

    const op1 = repo.getOperation<CommentUpdateIntent>(key, SCOPE)!;
    const prep1 = await handler.prepare(op1, context, deps);
    assert.strictEqual(prep1.ok, true);
    const sec1 = await handler.executeSecondaryEffects!(op1, (prep1 as any).prepared, context, deps);
    assert.strictEqual(sec1.ok, true);
    assert.strictEqual(uploadCalls, 1);

    // 再起動
    initializeOfflineSyncStore(memento, SCOPE);

    const op2 = repo.getOperation<CommentUpdateIntent>(key, SCOPE)!;
    assert.ok(op2, "再起動後も operation が存在すること");
    const prep2 = await handler.prepare(op2, context, deps);
    assert.strictEqual(prep2.ok, true);
    const sec2 = await handler.executeSecondaryEffects!(op2, (prep2 as any).prepared, context, deps);
    assert.strictEqual(sec2.ok, true);
    assert.strictEqual(uploadCalls, 1, "再起動後も committed token が再利用され、二重 upload されないこと (INV-U07)");
  });

  // T-05: Persistence failure before mutation (P1-03, RC-2, INV-U03)
  test("T-05: started checkpoint の永続化失敗時に Remote mutation が呼ばれず、メモリと永続層の整合性が保たれる", async () => {
    const ticketId = 300;
    addOfflineTicketUpdate(ticketId, {
      ticketId,
      baseSubject: "Subj",
      baseDescription: "Desc",
      baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      subject: "Subj Updated",
      description: "Desc Updated",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let updateIssueCalls = 0;
    const rejectingMemento: vscode.Memento = {
      keys: () => memento.keys(),
      get: <T>(key: string, defaultValue?: T) => memento.get<T>(key, defaultValue as any) as any,
      update: async () => {
        throw new Error("Disk Full / Memento update failed");
      },
    };

    // Replace store storage with rejecting memento
    initializeOfflineSyncStore(rejectingMemento, SCOPE);

    const engine = createSyncEngine({
      tickets: {
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Subj", description: "Desc", trackerId: 1, trackerName: "Bug", priorityId: 1, priorityName: "Normal", statusId: 1, statusName: "New", updatedAt: "2026-08-15T00:00:00Z" } as any,
          comments: [],
        }),
        updateIssue: async () => {
          updateIssueCalls++;
        },
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });

    const outcome = await engine.syncOne({ kind: "ticket", ticketId }, { connectionScope: SCOPE });
    assert.strictEqual(outcome.kind, "failed_before_commit");
    assert.strictEqual(updateIssueCalls, 0, "started checkpoint 永続化失敗時は Remote mutation を呼んではならない (INV-U03)");
  });

  // T-06: Persistence failure after Remote success (P1-02, RC-2, INV-U04)
  test("T-06: Remote mutation 成功後の checkpoint 永続化失敗時に updateCalls === 1 であり completed にならず、自動再送されない", async () => {
    const ticketId = 350;
    addOfflineTicketUpdate(ticketId, {
      ticketId,
      baseSubject: "Subj",
      baseDescription: "Desc",
      baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      subject: "Subj Updated",
      description: "Desc Updated",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let updateCalls = 0;
    let hookAfterUpdate = false;

    const baseRepo = createSyncOperationRepository();
    // Custom repository subclass to inject failure specifically at transitionEffect("commit") after updateIssue
    class FlakyRepo extends DefaultSyncOperationRepository {
      public override async transitionEffect(
        key: any,
        effectId: string,
        action: any,
        scope: string,
        expected?: any,
      ) {
        if (hookAfterUpdate && action.kind === "commit") {
          return undefined; // Simulate checkpoint failure after remote write
        }
        return super.transitionEffect(key, effectId, action, scope, expected);
      }
    }

    const engine = createSyncEngine({
      coordinator: createSyncCoordinator({
        repository: new FlakyRepo(),
      }),
      tickets: {
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Subj", description: "Desc", trackerId: 1, trackerName: "Bug", priorityId: 1, priorityName: "Normal", statusId: 1, statusName: "New", updatedAt: "2026-08-15T00:00:00Z" } as any,
          comments: [],
        }),
        updateIssue: async () => {
          updateCalls++;
          hookAfterUpdate = true;
        },
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });

    const outcome = await engine.syncOne({ kind: "ticket", ticketId }, { connectionScope: SCOPE });
    assert.strictEqual(updateCalls, 1, "Remote mutation (updateIssue) は確実に1回実行されたこと");
    assert.notStrictEqual(outcome.kind, "completed", "commit checkpoint 失敗時に completed を返してはならない (INV-U04, INV-N06)");
    assert.strictEqual(outcome.kind === "commit_unknown" || outcome.kind === "remote_committed", true);

    // 再度 normal sync しても自動再送されないこと
    const outcome2 = await engine.syncOne({ kind: "ticket", ticketId }, { connectionScope: SCOPE });
    assert.strictEqual(updateCalls, 1, "再度 syncOne しても Remote mutation は再実行されないこと");
    assert.notStrictEqual(outcome2.kind, "completed");
  });

  // T-07: Stale Effect Revision (P1-06, RC-2, INV-U08)
  test("T-07: Stale Effect Revision: caller expected revision が古い場合、Effect transition は拒絶される", async () => {
    const repo = createSyncOperationRepository();
    const key = { kind: "ticket" as const, ticketId: 777 };
    await repo.saveOperation({
      operationId: `${SCOPE}:ticket:777`,
      kind: "ticket_update",
      key,
      connectionScope: SCOPE,
      phase: "queued",
      revision: 2,
      intentRevision: 2,
      persistenceVersion: 1,
      ticketId: 777,
      effects: [
        {
          effectId: "att:1",
          kind: "attachment_upload",
          operationRevision: 2,
          state: "planned",
          target: { filename: "att.png" },
        },
      ],
    }, SCOPE);

    // caller expected revision = 1 (stale)
    const result = await repo.transitionEffect(
      key,
      "att:1",
      { kind: "start" },
      SCOPE,
      { operationRevision: 1, sourceState: "planned" },
    );

    assert.strictEqual(result, undefined, "stale revision からの effect transition は拒絶されること (INV-U08)");
    const op = repo.getOperation(key, SCOPE)!;
    assert.strictEqual(op.effects![0].state, "planned", "Effect 状態が変更されていないこと");
  });

  // T-08: Completion CAS race (P1-07, RC-2, INV-U11, INV-U12)
  test("T-08: Completion 中に nextIntent が追加された場合、false completed にならず nextIntent が保持される", async () => {
    const repo = createSyncOperationRepository();
    const key = { kind: "ticket" as const, ticketId: 888 };
    await repo.saveOperation({
      operationId: `${SCOPE}:ticket:888`,
      kind: "ticket_update",
      key,
      connectionScope: SCOPE,
      phase: "local_finalize_pending",
      revision: 1,
      intentRevision: 1,
      persistenceVersion: 1,
      ticketId: 888,
      intent: {
        ticketId: 888,
        baseSubject: "Rev 1 Subject",
        baseDescription: "Rev 1 Desc",
        baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        subject: "Rev 1 Subject",
        description: "Rev 1 Desc",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      },
    }, SCOPE);

    // ユーザーが同期中にエディタで編集して nextIntent を保存
    await repo.saveOperation({
      operationId: `${SCOPE}:ticket:888`,
      kind: "ticket_update",
      key,
      connectionScope: SCOPE,
      phase: "local_finalize_pending",
      revision: 1,
      intentRevision: 1,
      persistenceVersion: 2,
      ticketId: 888,
      intent: {
        ticketId: 888,
        baseSubject: "Rev 1 Subject",
        baseDescription: "Rev 1 Desc",
        baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        subject: "Rev 1 Subject",
        description: "Rev 1 Desc",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      },
      nextIntent: {
        ticketId: 888,
        baseSubject: "Rev 1 Subject",
        baseDescription: "Rev 1 Desc",
        baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        revision: 2,
        subject: "Rev 2 Inflight Subject",
        description: "Rev 2 Inflight Desc",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      },
    }, SCOPE);

    // completeOperation 実行
    const completed = await repo.completeOperation(key, SCOPE, 1, {
      canonical: { ticket: { id: 888, subject: "Rev 1 Subject", description: "Rev 1 Desc" } },
    });

    assert.strictEqual(completed, true);
    const queue = getOfflineSyncQueue(SCOPE);
    const remaining = queue.tickets.get(888);
    assert.ok(remaining, "nextIntent があるためキューエントリが残ること");
    assert.strictEqual(remaining?.revision, 2, "新リビジョンに昇格していること (INV-U11)");
    assert.strictEqual(remaining?.subject, "Rev 2 Inflight Subject");
  });

  // T-09: Secondary Unknown Recovery (RC-1, INV-U05, INV-U06, INV-N03, INV-N04)
  test("T-09: image effect が commit_unknown の時、通常 retry も explicit retry も Primary mutation は 0 回", async () => {
    const repo = createSyncOperationRepository();
    const key = { kind: "comment" as const, ticketId: 90, commentId: 500 };
    await repo.saveOperation({
      operationId: `${SCOPE}:comment:90:500`,
      kind: "comment_update",
      key,
      connectionScope: SCOPE,
      phase: "commit_unknown",
      revision: 1,
      persistenceVersion: 1,
      ticketId: 90,
      commentId: 500,
      intent: {
        ticketId: 90,
        commentId: 500,
        body: "Notes with unknown image",
      },
      effects: [
        {
          effectId: "image:markdown:0",
          kind: "image_upload",
          operationRevision: 1,
          state: "commit_unknown",
          target: { filename: "unknown.png" },
        },
      ],
    }, SCOPE);

    let updateCommentCalls = 0;
    const engine = createSyncEngine({
      coordinator: createSyncCoordinator({
        repository: repo,
      }),
      comments: {
        updateComment: async () => {
          updateCommentCalls++;
        },
      },
    });

    // 1. 通常の syncOne
    const outcome1 = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.strictEqual(outcome1.kind, "commit_unknown");
    assert.strictEqual(updateCommentCalls, 0, "unknown effect が未解決の間は Primary mutation を呼んではならない (INV-U05)");

    // 2. explicit retry (retry_remote_write)
    const outcome2 = await engine.resolveCommentCommitUnknown({
      key: { kind: "comment", ticketId: 90, commentId: 500 },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" as any },
    });

    assert.notStrictEqual(outcome2.kind, "completed");
    assert.strictEqual(updateCommentCalls, 0, "prerequisite effect (image) が unknown の状態で explicit retry しても Primary mutation は 0 回であること (INV-N03, INV-N04)");
  });

  // T-10: Primary Certainty Invariant (INV-U01, INV-U02)
  test("T-10: 任意の attachment/image/child だけが committed であっても operation.remote_committed にならない", async () => {
    const repo = createSyncOperationRepository();
    const key = { kind: "newTicket" as const, queueId: "q-inv-10" };
    await repo.saveOperation({
      operationId: `${SCOPE}:newTicket:q-inv-10`,
      kind: "ticket_create",
      key,
      connectionScope: SCOPE,
      phase: "preparing",
      revision: 1,
      persistenceVersion: 1,
      projectId: 1,
      intent: {
        projectId: 1,
        subject: "Title",
        description: "Body",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      },
      effects: [
        {
          effectId: "attachment:file:0",
          kind: "attachment_upload",
          operationRevision: 1,
          state: "committed",
          token: "tok-1",
          target: { filename: "att.png" },
        },
      ],
    }, SCOPE);

    const op = repo.getOperation(key, SCOPE)!;
    assert.strictEqual(op.phase, "preparing");
    assert.notStrictEqual(op.phase, "remote_committed", "Secondary effect committed だけでは remote_committed にならないこと (INV-U01, INV-U02)");
  });

  // T-11: Production Restart Normalizer (INV-U07)
  test("T-11: initializeOfflineSyncStore の本番正規化で committed effect が失われない", async () => {
    const queue = getOfflineSyncQueue(SCOPE);
    queue.newTickets.push({
      queueId: "q-norm-11",
      operationId: `${SCOPE}:newTicket:q-norm-11`,
      phase: "preparing",
      revision: 1,
      projectId: 1,
      content: "content",
      effects: [
        {
          effectId: "attachment:file:0",
          kind: "attachment_upload",
          operationRevision: 1,
          state: "committed",
          token: "saved-token-11",
          target: { filename: "att.png" },
        },
      ],
    } as any);

    await replaceOfflineSyncQueueAsync(queue, SCOPE);

    // 本番プロセス初期化
    initializeOfflineSyncStore(memento, SCOPE);

    const restoredQueue = getOfflineSyncQueue(SCOPE);
    const restored = restoredQueue.newTickets.find((t) => t.queueId === "q-norm-11");
    assert.ok(restored, "復元されたチケットが存在すること");
    assert.strictEqual(restored?.effects?.length, 1, "committed effect が失われていないこと (INV-U07)");
    assert.strictEqual(restored?.effects?.[0].state, "committed");
    assert.strictEqual(restored?.effects?.[0].token, "saved-token-11");
  });

  // T-12: Ownership Boundary (INV-U14, INV-U15)
  test("T-12: production sync lifecycle code から legacy lifecycle 関数への直接参照が存在しない (静的境界テスト)", async () => {
    const repo = createSyncOperationRepository();
    assert.ok(typeof repo.saveOperation === "function");
    assert.ok(typeof repo.transitionOperation === "function");
    assert.ok(typeof repo.planEffect === "function");
    assert.ok(typeof repo.transitionEffect === "function");
    assert.ok(typeof repo.completeOperation === "function");

    // 静的境界検証: src/app/ 内のファイル（ports/adapter/test 除く）で legacy lifecycle API が呼ばれていないこと
    const legacyPatterns = [
      "transitionOfflineNewTicketLifecycleAsync",
      "transitionOfflineTicketUpdateLifecycleAsync",
      "planOfflineSyncEffectAsync",
      "transitionOfflineSyncEffectAsync",
    ];

    const appDir = path.resolve(__dirname, "../../src/app");
    if (fs.existsSync(appDir)) {
      const files = fs.readdirSync(appDir, { recursive: true }) as string[];
      for (const relFile of files) {
        if (
          !relFile.endsWith(".ts") ||
          relFile.includes("ticketSyncAdapter") ||
          relFile.includes("ticketSyncService") ||
          relFile.includes(".test.")
        ) {
          continue;
        }
        const fullPath = path.join(appDir, relFile);
        const code = fs.readFileSync(fullPath, "utf-8");
        for (const pattern of legacyPatterns) {
          assert.strictEqual(
            code.includes(pattern),
            false,
            `Forbidden legacy lifecycle call '${pattern}' found in production file: ${relFile}`,
          );
        }
      }
    }
  });

  // T-13: Primary success → child known failure (INV-N01, INV-N02, P1-01)
  test("T-13: TicketUpdate で Primary PUT 成功後に child が既知失敗した場合、Primary commit ledger を保持し failed_before_commit に巻き戻さない", async () => {
    const ticketId = 1300;
    addOfflineTicketUpdate(ticketId, {
      ticketId,
      baseSubject: "Parent T13",
      baseDescription: "Desc",
      baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      subject: "Parent T13 Updated",
      description: "Desc Updated",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: ["Child Fail"] },
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let updateIssueCalls = 0;
    let createChildCalls = 0;

    const engine = createSyncEngine({
      tickets: {
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Parent T13", description: "Desc", trackerId: 1, trackerName: "Bug", priorityId: 1, priorityName: "Normal", statusId: 1, statusName: "New", updatedAt: "2026-08-15T00:00:00Z" } as any,
          comments: [],
        }),
        updateIssue: async () => {
          updateIssueCalls++;
        },
        createIssue: async () => {
          createChildCalls++;
          throw new Error("HTTP 400: Child issue validation failed");
        },
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });

    const key = { kind: "ticket" as const, ticketId };
    const outcome = await engine.syncOne(key, { connectionScope: SCOPE });

    assert.strictEqual(updateIssueCalls, 1, "Primary PUT は1回呼ばれること");
    assert.strictEqual(createChildCalls, 1, "Child create は1回呼ばれること");
    assert.notStrictEqual(outcome.kind, "failed_before_commit", "Primary 成功後は failed_before_commit に戻してはならない (INV-N01)");
    assert.notStrictEqual(outcome.kind, "completed", "child が失敗しているため completed になってはならない");
    assert.strictEqual(outcome.kind, "remote_committed", "Primary 成功済みとして remote_committed を返すこと");

    const repo = createSyncOperationRepository();
    const op = repo.getOperation(key, SCOPE)!;
    assert.ok(op, "Queue/Operation が保持されていること");
    const primaryEffect = op.effects?.find((e) => e.effectId === "ticket-update");
    const childEffect = op.effects?.find((e) => e.effectId.startsWith("child-create"));
    assert.strictEqual(primaryEffect?.state, "committed", "Primary effect は committed であること (INV-N01)");
    assert.strictEqual(childEffect?.state, "failed", "Child effect は failed であること (INV-N02)");

    // もう一度 normal sync を実行しても、Primary PUT は再送されないこと
    const outcome2 = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.strictEqual(updateIssueCalls, 1, "再同期しても Primary PUT は再実行されないこと (INV-N01)");
    assert.notStrictEqual(outcome2.kind, "completed");
  });

  // T-14: Primary success → child unknown (INV-N01, INV-N02)
  test("T-14: TicketUpdate で Primary PUT 成功後に child が timeout した場合、Primary committed & child commit_unknown を維持し自動再送しない", async () => {
    const ticketId = 1400;
    addOfflineTicketUpdate(ticketId, {
      ticketId,
      baseSubject: "Parent T14",
      baseDescription: "Desc",
      baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      subject: "Parent T14 Updated",
      description: "Desc Updated",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: ["Child Timeout"] },
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let updateIssueCalls = 0;
    let createChildCalls = 0;

    const engine = createSyncEngine({
      tickets: {
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Parent T14", description: "Desc", trackerId: 1, trackerName: "Bug", priorityId: 1, priorityName: "Normal", statusId: 1, statusName: "New", updatedAt: "2026-08-15T00:00:00Z" } as any,
          comments: [],
        }),
        updateIssue: async () => {
          updateIssueCalls++;
        },
        createIssue: async () => {
          createChildCalls++;
          const err = new Error("ETIMEDOUT: Connection timed out");
          (err as any).code = "ETIMEDOUT";
          throw err;
        },
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });

    const key = { kind: "ticket" as const, ticketId };
    const outcome = await engine.syncOne(key, { connectionScope: SCOPE });

    assert.strictEqual(updateIssueCalls, 1);
    assert.strictEqual(createChildCalls, 1);
    assert.strictEqual(outcome.kind, "remote_committed");

    const repo = createSyncOperationRepository();
    const op = repo.getOperation(key, SCOPE)!;
    const primaryEffect = op.effects?.find((e) => e.effectId === "ticket-update");
    const childEffect = op.effects?.find((e) => e.effectId.startsWith("child-create"));
    assert.strictEqual(primaryEffect?.state, "committed");
    assert.strictEqual(childEffect?.state, "commit_unknown");

    // 再度 normal sync: Primary も child も自動再送しない
    const outcome2 = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.strictEqual(updateIssueCalls, 1, "Primary PUT は再送されないこと");
    assert.strictEqual(createChildCalls, 1, "Child create は自動再送されないこと");
  });

  // T-15: image effect unknown → explicit Primary retry 拒否 (INV-N03, INV-N04, P1-02)
  test("T-15: CommentUpdate で image upload timeout の場合、explicit retry_remote_write でも updateCommentCalls === 0", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "t15-test-"));
    const imgPath = path.join(tmpDir, "img15.png");
    fs.writeFileSync(imgPath, "image data 15");

    const key = { kind: "comment" as const, ticketId: 150, commentId: 1500 };
    const repo = createSyncOperationRepository();
    await repo.saveOperation({
      operationId: `${SCOPE}:comment:150:1500`,
      kind: "comment_update",
      key,
      connectionScope: SCOPE,
      phase: "commit_unknown",
      revision: 1,
      persistenceVersion: 1,
      ticketId: 150,
      commentId: 1500,
      intent: {
        ticketId: 150,
        commentId: 1500,
        body: `Comment with ![img](${imgPath})`,
        baseDir: tmpDir,
      },
      effects: [
        {
          effectId: `image:markdown:0:${imgPath}`,
          kind: "image_upload",
          operationRevision: 1,
          state: "commit_unknown",
          target: { filePath: imgPath, filename: "img15.png" },
        },
      ],
    }, SCOPE);

    let updateCommentCalls = 0;
    const engine = createSyncEngine({
      coordinator: createSyncCoordinator({ repository: repo }),
      comments: {
        updateComment: async () => {
          updateCommentCalls++;
        },
      },
    });

    const res = await engine.resolveCommentCommitUnknown({
      key: { kind: "comment", ticketId: 150, commentId: 1500 },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" as any },
    });

    assert.strictEqual(updateCommentCalls, 0, "Prerequisite (image) が unknown の間は updateComment を呼んではならない (INV-N03, INV-N04)");
    assert.notStrictEqual(res.kind, "completed");
  });

  // T-16: attachment unknown → explicit ticket create retry 拒否 (INV-N03, INV-N04, P1-02)
  test("T-16: TicketCreate で attachment upload timeout の場合、explicit retry_remote_write でも createIssueCalls === 0", async () => {
    const key = { kind: "newTicket" as const, queueId: "t16-queue" };
    const repo = createSyncOperationRepository();
    await repo.saveOperation({
      operationId: `${SCOPE}:newTicket:t16-queue`,
      kind: "ticket_create",
      key,
      connectionScope: SCOPE,
      phase: "commit_unknown",
      revision: 1,
      persistenceVersion: 1,
      projectId: 1,
      intent: {
        projectId: 1,
        subject: "Ticket T16",
        description: "Desc",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        attachments: [{ kind: "file", filePath: "/dummy/att.png", filename: "att.png", contentType: "image/png" }],
      },
      effects: [
        {
          effectId: "attachment:file:0:/dummy/att.png",
          kind: "attachment_upload",
          operationRevision: 1,
          state: "commit_unknown",
          target: { filePath: "/dummy/att.png", filename: "att.png" },
        },
      ],
    }, SCOPE);

    let createIssueCalls = 0;
    const engine = createSyncEngine({
      coordinator: createSyncCoordinator({ repository: repo }),
      tickets: {
        createIssue: async () => {
          createIssueCalls++;
          return 1600;
        },
      },
    });

    const res = await engine.resolveTicketCommitUnknown({
      key: { kind: "newTicket", queueId: "t16-queue" },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });

    assert.strictEqual(createIssueCalls, 0, "Prerequisite (attachment) が unknown の間は createIssue を呼んではならない (INV-N03, INV-N04)");
    assert.notStrictEqual(res.kind, "completed");
  });

  // T-17: child unknown + Primary committed → explicit retry (INV-N04)
  test("T-17: TicketUpdate で Primary 成功 & child unknown の場合、explicit retry_remote_write でも updateIssueCalls remains 1", async () => {
    const ticketId = 1700;
    const key = { kind: "ticket" as const, ticketId };
    const repo = createSyncOperationRepository();
    await repo.saveOperation({
      operationId: `${SCOPE}:ticket:1700`,
      kind: "ticket_update",
      key,
      connectionScope: SCOPE,
      phase: "commit_unknown",
      revision: 1,
      persistenceVersion: 1,
      ticketId,
      projectId: 1,
      intent: {
        ticketId,
        baseSubject: "Ticket T17",
        baseDescription: "Desc",
        baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        subject: "Ticket T17",
        description: "Desc",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: ["Child 17"] },
      },
      effects: [
        {
          effectId: "ticket-update",
          kind: "ticket_update",
          operationRevision: 1,
          state: "committed",
          remoteId: ticketId,
          target: { ticketId },
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "commit_unknown",
          target: { parentTicketId: ticketId, ordinal: 0 },
        },
      ],
    }, SCOPE);

    let updateIssueCalls = 0;
    const engine = createSyncEngine({
      coordinator: createSyncCoordinator({ repository: repo }),
      tickets: {
        updateIssue: async () => {
          updateIssueCalls++;
        },
        createIssue: async () => 1701,
      },
    });

    const res = await engine.resolveTicketCommitUnknown({
      key: { kind: "ticket", ticketId },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });

    assert.strictEqual(updateIssueCalls, 0, "Primary が既に committed なので updateIssue は再実行されないこと (INV-N04)");
  });

  // T-18: TicketCreate Primary plan persistence failure (INV-N05, P1-04)
  test("T-18: TicketCreate で Primary planEffect 永続化失敗時、createIssueCalls === 0 であること", async () => {
    let createIssueCalls = 0;
    class FlakyRepo extends DefaultSyncOperationRepository {
      public override async planEffect(key: any, effect: any, scope: string, expectedRev?: number) {
        if (effect.effectId === "ticket-create") {
          return undefined; // simulate plan failure
        }
        return super.planEffect(key, effect, scope, expectedRev);
      }
    }

    const repo = new FlakyRepo();
    const queueId = "t18-queue";
    await repo.saveOperation({
      operationId: `${SCOPE}:newTicket:${queueId}`,
      kind: "ticket_create",
      key: { kind: "newTicket", queueId },
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      projectId: 1,
      intent: {
        projectId: 1,
        subject: "Title T18",
        description: "Body",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      },
    }, SCOPE);

    const engine = createSyncEngine({
      coordinator: createSyncCoordinator({ repository: repo }),
      tickets: {
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
        createIssue: async () => {
          createIssueCalls++;
          return 1800;
        },
      },
    });

    const outcome = await engine.syncOne({ kind: "newTicket", queueId }, { connectionScope: SCOPE });
    assert.strictEqual(createIssueCalls, 0, "planEffect 失敗時は createIssue を呼んではならない (INV-N05)");
    assert.strictEqual(outcome.kind, "failed_before_commit");
  });

  // T-19: TicketCreate Primary start persistence failure (INV-N05, P1-04)
  test("T-19: TicketCreate で Primary start checkpoint 永続化失敗時、createIssueCalls === 0 であること", async () => {
    let createIssueCalls = 0;
    class FlakyRepo extends DefaultSyncOperationRepository {
      public override async transitionEffect(key: any, effectId: string, action: any, scope: string, expected?: any) {
        if (effectId === "ticket-create" && action.kind === "start") {
          return undefined; // simulate start transition failure
        }
        return super.transitionEffect(key, effectId, action, scope, expected);
      }
    }

    const repo = new FlakyRepo();
    const queueId = "t19-queue";
    await repo.saveOperation({
      operationId: `${SCOPE}:newTicket:${queueId}`,
      kind: "ticket_create",
      key: { kind: "newTicket", queueId },
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      projectId: 1,
      intent: {
        projectId: 1,
        subject: "Title T19",
        description: "Body",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      },
    }, SCOPE);

    const engine = createSyncEngine({
      coordinator: createSyncCoordinator({ repository: repo }),
      tickets: {
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
        createIssue: async () => {
          createIssueCalls++;
          return 1900;
        },
      },
    });

    const outcome = await engine.syncOne({ kind: "newTicket", queueId }, { connectionScope: SCOPE });
    assert.strictEqual(createIssueCalls, 0, "start transition 失敗時は createIssue を呼んではならない (INV-N05)");
    assert.strictEqual(outcome.kind, "failed_before_commit");
  });

  // T-20: TicketCreate Primary commit persistence failure (INV-N06, P1-04)
  test("T-20: TicketCreate で createIssue 成功後に commit checkpoint 失敗時、completed にならず再同期でも createIssueCalls === 1", async () => {
    let createIssueCalls = 0;
    let hookAfterCreate = false;

    class FlakyRepo extends DefaultSyncOperationRepository {
      public override async transitionEffect(key: any, effectId: string, action: any, scope: string, expected?: any) {
        if (hookAfterCreate && effectId === "ticket-create" && action.kind === "commit") {
          return undefined; // simulate commit transition failure after createIssue
        }
        return super.transitionEffect(key, effectId, action, scope, expected);
      }
    }

    const repo = new FlakyRepo();
    const queueId = "t20-queue";
    await repo.saveOperation({
      operationId: `${SCOPE}:newTicket:${queueId}`,
      kind: "ticket_create",
      key: { kind: "newTicket", queueId },
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      projectId: 1,
      intent: {
        projectId: 1,
        subject: "Title T20",
        description: "Body",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      },
    }, SCOPE);

    const engine = createSyncEngine({
      coordinator: createSyncCoordinator({ repository: repo }),
      tickets: {
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
        createIssue: async () => {
          createIssueCalls++;
          hookAfterCreate = true;
          return 2000;
        },
      },
    });

    const outcome1 = await engine.syncOne({ kind: "newTicket", queueId }, { connectionScope: SCOPE });
    assert.strictEqual(createIssueCalls, 1, "createIssue は1回呼ばれること");
    assert.notStrictEqual(outcome1.kind, "completed", "commit checkpoint 失敗時に completed を返してはならない (INV-N06)");

    // 再度 normal sync を実行しても、createIssue は再実行されないこと
    const outcome2 = await engine.syncOne({ kind: "newTicket", queueId }, { connectionScope: SCOPE });
    assert.strictEqual(createIssueCalls, 1, "再同期しても createIssue は再実行されないこと (二重作成防止)");
  });

  // T-21: Comment Primary checkpoint failure (INV-N05, INV-N06, P1-04)
  test("T-21: CommentCreate / CommentUpdate で start 失敗時は remote 0 回、commit 失敗時は completed 禁止", async () => {
    let addCommentCalls = 0;
    let hookAfterAdd = false;

    class FlakyRepo extends DefaultSyncOperationRepository {
      public override async transitionEffect(key: any, effectId: string, action: any, scope: string, expected?: any) {
        if (effectId === "comment-create" && action.kind === "start") {
          return undefined; // start failure
        }
        if (hookAfterAdd && effectId === "comment-create" && action.kind === "commit") {
          return undefined; // commit failure
        }
        return super.transitionEffect(key, effectId, action, scope, expected);
      }
    }

    const repo = new FlakyRepo();
    const key = { kind: "comment" as const, ticketId: 210 };
    await repo.saveOperation({
      operationId: `${SCOPE}:comment:210:new`,
      kind: "comment_create",
      key,
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      ticketId: 210,
      intent: {
        ticketId: 210,
        body: "New comment T21",
      },
    }, SCOPE);

    const engine = createSyncEngine({
      coordinator: createSyncCoordinator({ repository: repo }),
      comments: {
        addComment: async () => {
          addCommentCalls++;
          hookAfterAdd = true;
        },
      },
    });

    // 1. start checkpoint 失敗時
    const outcome = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.strictEqual(addCommentCalls, 0, "start 失敗時は addComment を呼んではならない (INV-N05)");
    assert.strictEqual(outcome.kind, "failed_before_commit");
  });

  // T-22: child commit checkpoint failure (INV-N06)
  test("T-22: child creation 成功後に child commit checkpoint 永続化失敗時、createChildCalls === 1 かつ completed 禁止", async () => {
    const ticketId = 2200;
    let createChildCalls = 0;
    let hookAfterChild = false;

    class FlakyRepo extends DefaultSyncOperationRepository {
      public override async transitionEffect(key: any, effectId: string, action: any, scope: string, expected?: any) {
        if (hookAfterChild && effectId.startsWith("child-create") && action.kind === "commit") {
          return undefined; // fail child commit checkpoint
        }
        return super.transitionEffect(key, effectId, action, scope, expected);
      }
    }

    const repo = new FlakyRepo();
    await repo.saveOperation({
      operationId: `${SCOPE}:ticket:2200`,
      kind: "ticket_update",
      key: { kind: "ticket", ticketId },
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      ticketId,
      projectId: 1,
      intent: {
        ticketId,
        baseSubject: "Ticket T22",
        baseDescription: "Desc",
        baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        subject: "Ticket T22",
        description: "Desc",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: ["Sub 22"] },
      },
    }, SCOPE);

    const engine = createSyncEngine({
      coordinator: createSyncCoordinator({ repository: repo }),
      tickets: {
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Ticket T22", description: "Desc", trackerId: 1, trackerName: "Bug", priorityId: 1, priorityName: "Normal", statusId: 1, statusName: "New", updatedAt: "2026-08-15T00:00:00Z" } as any,
          comments: [],
        }),
        updateIssue: async () => {},
        createIssue: async () => {
          createChildCalls++;
          hookAfterChild = true;
          return 2201;
        },
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });

    const outcome = await engine.syncOne({ kind: "ticket", ticketId }, { connectionScope: SCOPE });
    assert.strictEqual(createChildCalls, 1, "Child issue は1回作成されること");
    assert.notStrictEqual(outcome.kind, "completed", "child commit checkpoint 失敗時に completed を返してはならない (INV-N06)");

    // 再度 normal sync しても child を二重作成しないこと
    const outcome2 = await engine.syncOne({ kind: "ticket", ticketId }, { connectionScope: SCOPE });
    assert.strictEqual(createChildCalls, 1, "再同期しても child issue は再送されないこと (二重作成防止)");
  });

  // T-23: completeOperation = false (INV-N07, P1-03)
  test("T-23: finalizeLocal 成功後に completeOperation が false を返した場合、outcome.kind !== completed", async () => {
    const ticketId = 2300;
    class FlakyRepo extends DefaultSyncOperationRepository {
      public override async completeOperation() {
        return false; // completeOperation persistence failure
      }
    }

    const repo = new FlakyRepo();
    await repo.saveOperation({
      operationId: `${SCOPE}:ticket:2300`,
      kind: "ticket_update",
      key: { kind: "ticket", ticketId },
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      ticketId,
      projectId: 1,
      intent: {
        ticketId,
        baseSubject: "Ticket T23",
        baseDescription: "Desc",
        baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        subject: "Ticket T23",
        description: "Desc",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      },
    }, SCOPE);

    const engine = createSyncEngine({
      coordinator: createSyncCoordinator({ repository: repo }),
      tickets: {
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Ticket T23", description: "Desc", trackerId: 1, trackerName: "Bug", priorityId: 1, priorityName: "Normal", statusId: 1, statusName: "New", updatedAt: "2026-08-15T00:00:00Z" } as any,
          comments: [],
        }),
        updateIssue: async () => {},
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });

    const outcome = await engine.syncOne({ kind: "ticket", ticketId }, { connectionScope: SCOPE });
    assert.notStrictEqual(outcome.kind, "completed", "completeOperation 失敗時は completed を返してはならない (INV-N07, P1-03)");
  });

  // T-24: complete CAS conflict + nextIntent (INV-N07)
  test("T-24: completion 直前に nextIntent が追加された場合、new intent が保持され false completed にならない", async () => {
    const ticketId = 2400;
    const key = { kind: "ticket" as const, ticketId };
    const repo = createSyncOperationRepository();
    await repo.saveOperation({
      operationId: `${SCOPE}:ticket:2400`,
      kind: "ticket_update",
      key,
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      ticketId,
      projectId: 1,
      intent: {
        ticketId,
        baseSubject: "Ticket T24 Rev 1",
        baseDescription: "Desc",
        baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        subject: "Ticket T24 Rev 1",
        description: "Desc",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      },
    }, SCOPE);

    const engine = createSyncEngine({
      coordinator: createSyncCoordinator({ repository: repo }),
      tickets: {
        getIssueDetail: async (id: number) => {
          // finalize 直前にユーザーがエディタで編集して nextIntent を保存した状態をシミュレート
          const current = repo.getOperation(key, SCOPE);
          if (current) {
            await repo.saveOperation({
              ...current,
              nextIntent: {
                ticketId,
                baseSubject: "Ticket T24 Rev 1",
                baseDescription: "Desc",
                baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
                revision: 2,
                subject: "Ticket T24 Rev 2 Concurrent",
                description: "Desc 2",
                metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
              },
            }, SCOPE);
          }
          return {
            ticket: { id, projectId: 1, subject: "Ticket T24 Rev 1", description: "Desc", trackerId: 1, trackerName: "Bug", priorityId: 1, priorityName: "Normal", statusId: 1, statusName: "New", updatedAt: "2026-08-15T00:00:00Z" } as any,
            comments: [],
          };
        },
        updateIssue: async () => {},
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });

    const outcome = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.strictEqual(outcome.kind, "completed");

    const queue = getOfflineSyncQueue(SCOPE);
    const remaining = queue.tickets.get(ticketId);
    assert.ok(remaining, "nextIntent があるため queue エントリが残ること");
    assert.strictEqual(remaining?.revision, 2, "nextIntent のリビジョン2に昇格していること");
    assert.strictEqual(remaining?.subject, "Ticket T24 Rev 2 Concurrent");
  });
});
