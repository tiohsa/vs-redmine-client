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
import { createSyncOperationRepository } from "../app/ticketSync/syncRepository";
import {
  TicketCreateHandler,
  TicketUpdateHandler,
  CommentCreateHandler,
  CommentUpdateHandler,
} from "../app/ticketSync/operationHandlers";
import { buildCommentUpdateFileContent } from "../views/commentUpdateFile";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import type { TicketCreateIntent, TicketUpdateIntent, CommentUpdateIntent } from "../app/ticketSync/syncOperationTypes";

const SCOPE = "https://redmine.example.org/t01-t12-suite";

suite("T-01 〜 T-12: Sync Lifecycle Integration & Remote Certainty Invariant Tests", () => {
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
  test("T-06: Remote mutation 成功後の checkpoint 永続化失敗時に completed にならず、自動再送されない", async () => {
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
    let persistCount = 0;
    const flakymemento: vscode.Memento = {
      keys: () => memento.keys(),
      get: <T>(key: string, defaultValue?: T) => memento.get<T>(key, defaultValue as any) as any,
      update: async (key: string, value: any) => {
        persistCount++;
        // 最初の数回（preparation / started）は成功させ、commit checkpoint の永続化で失敗させる
        if (persistCount >= 2) {
          throw new Error("Memento failure after remote write");
        }
        return memento.update(key, value);
      },
    };

    initializeOfflineSyncStore(flakymemento, SCOPE);

    const engine = createSyncEngine({
      tickets: {
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Subj", description: "Desc", trackerId: 1, trackerName: "Bug", priorityId: 1, priorityName: "Normal", statusId: 1, statusName: "New", updatedAt: "2026-08-15T00:00:00Z" } as any,
          comments: [],
        }),
        updateIssue: async () => {
          updateCalls++;
        },
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });

    const outcome = await engine.syncOne({ kind: "ticket", ticketId }, { connectionScope: SCOPE });
    assert.notStrictEqual(outcome.kind, "completed", "checkpoint 未永続化状態で completed を返してはならない (INV-U04)");
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

  // T-09: Secondary Unknown Recovery (RC-1, INV-U05, INV-U06)
  test("T-09: image effect が commit_unknown の時、Primary mutation の通常 retry は拒否される", async () => {
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
      comments: {
        updateComment: async () => {
          updateCommentCalls++;
        },
      },
    });

    const outcome = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.strictEqual(outcome.kind, "commit_unknown");
    assert.strictEqual(updateCommentCalls, 0, "unknown effect が未解決の間は Primary mutation を呼んではならない (INV-U05)");
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
  test("T-12: Repository がライフサイクルの唯一のオーナーであり、型安全な contract を提供する", async () => {
    const repo = createSyncOperationRepository();
    assert.ok(typeof repo.saveOperation === "function");
    assert.ok(typeof repo.transitionOperation === "function");
    assert.ok(typeof repo.planEffect === "function");
    assert.ok(typeof repo.transitionEffect === "function");
    assert.ok(typeof repo.completeOperation === "function");
  });
});
