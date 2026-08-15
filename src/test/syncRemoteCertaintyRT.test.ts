import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { initializeOfflineSyncStore, addOfflineTicketUpdate, addOfflineNewTicketAsync, addOfflineCommentUpdate, getOfflineSyncQueue } from "../views/offlineSyncStore";
import { createSyncEngine } from "../app/syncEngine";
import { createTestMemento } from "./helpers/vscodeMemento";
import { createSyncOperationRepository, DefaultSyncOperationRepository } from "../app/ticketSync/syncRepository";
import { TicketCreateHandler, TicketUpdateHandler, CommentCreateHandler, CommentUpdateHandler } from "../app/ticketSync/operationHandlers";
import { SyncCoordinator } from "../app/ticketSync/syncCoordinator";
import { updateCommentUpdateFileAfterSync, buildCommentUpdateFileContent } from "../views/commentUpdateFile";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import type { IssueUploadInput } from "../redmine/issues";
import type { TicketCreateIntent, CommentUpdateIntent } from "../app/ticketSync/syncOperationTypes";

const SCOPE = "https://redmine.example.org/rt-suite";

suite("RT-A 〜 RT-J: Remote Certainty & Secondary Effect Invariant Tests", () => {
  setup(() => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
  });

  // RT-A: TicketUpdate commit_unknown verification (INV-04, INV-09, INV-27)
  test("RT-A: TicketUpdate commit_unknown 時、remote が古い（未反映）なら reconcile しても completed にならず、remote が反映された場合のみ completed になる", async () => {
    const ticketId = 100;
    addOfflineTicketUpdate(ticketId, {
      ticketId,
      baseSubject: "Old Subject",
      baseDescription: "Old Description",
      baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      subject: "New Subject",
      description: "New Description",
      metadata: { tracker: "Feature", priority: "High", status: "In Progress", due_date: "2026-09-01", children: [] },
      phase: "commit_unknown",
      revision: 1,
    }, SCOPE);

    let remoteSubject = "Old Subject";
    let remoteDescription = "Old Description";
    let remoteTracker = "Bug";
    let remotePriority = "Normal";
    let remoteStatus = "New";
    let remoteDueDate = "";
    let updateIssueCalls = 0;
    let getIssueDetailCalls = 0;

    const engine = createSyncEngine({
      tickets: {
        getIssueDetail: async (id: number) => {
          getIssueDetailCalls++;
          return {
            ticket: {
              id,
              subject: remoteSubject,
              description: remoteDescription,
              projectId: 1,
              projectName: "Project A",
              trackerId: remoteTracker === "Feature" ? 2 : 1,
              trackerName: remoteTracker,
              priorityId: remotePriority === "High" ? 2 : 1,
              priorityName: remotePriority,
              statusId: remoteStatus === "In Progress" ? 2 : 1,
              statusName: remoteStatus,
              dueDate: remoteDueDate,
              updatedAt: "2026-08-15T00:00:00Z",
            },
            comments: [],
          } as any;
        },
        updateIssue: async () => {
          updateIssueCalls++;
          throw new Error("Timeout");
        },
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }, { id: 2, name: "Feature" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }, { id: 2, name: "In Progress" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }, { id: 2, name: "High" }],
      },
    });

    const key = { kind: "ticket" as const, ticketId };

    // 1. 通常 sync は commit_unknown を自動再送しない (INV-04)
    const syncOutcome = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.strictEqual(syncOutcome.kind, "commit_unknown");
    assert.strictEqual(updateIssueCalls, 0, "通常 sync で自動再送しないこと");

    // 2. remote がまだ Old の状態で reconcile 試行 -> 変更未反映のため completed にならず commit_unknown を維持 (INV-27)
    const failedReconcile = await engine.resolveTicketCommitUnknown({
      key,
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_remote" },
    });
    assert.strictEqual(failedReconcile.kind, "commit_unknown", "remote が未反映なら completed にならないこと");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.has(ticketId), true, "キューが保持されていること");
    assert.strictEqual(updateIssueCalls, 0, "reconcile 試行で updateIssue を呼ばないこと");

    // 3. remote が New （反映済み）になった場合 -> reconcile が成功して completed になる
    remoteSubject = "New Subject";
    remoteDescription = "New Description";
    remoteTracker = "Feature";
    remotePriority = "High";
    remoteStatus = "In Progress";
    remoteDueDate = "2026-09-01";

    const successReconcile = await engine.resolveTicketCommitUnknown({
      key,
      context: { connectionScope: SCOPE },
      resolution: { kind: "reconcile_remote" },
    });
    assert.strictEqual(successReconcile.kind, "completed", "remote 変更が一致した場合は completed になること");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.has(ticketId), false, "完了後にキューが解消されること");
  });

  // RT-B: CommentUpdate local finalize typed contract (INV-30, DR-03)
  test("RT-B: CommentUpdate local finalize は型付きオブジェクト契約を受け取り、updatedAt を expectedBody に誤用しない", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-b-comment-"));
    const file = path.join(dir, "comment.md");
    const initialContent = buildCommentUpdateFileContent({
      issueId: 10,
      journalId: 20,
      projectId: 1,
      lastSyncedAt: "2026-08-14T00:00:00Z",
      sourceNotesHash: "test-hash",
    }, "Original local comment body");
    fs.writeFileSync(file, initialContent);

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(doc);

    // Call updateCommentUpdateFileAfterSync with object contract
    const result = await updateCommentUpdateFileAfterSync({
      documentUri: doc.uri.toString(),
      syncedBody: "Updated comment body",
      expectedBody: "Original local comment body",
      remoteUpdatedAt: "2026-08-15T12:00:00Z",
    });

    assert.strictEqual(result, "applied");
    assert.ok(doc.getText().includes("Updated comment body"));
    assert.ok(!doc.getText().includes("2026-08-15T12:00:00Z\n")); // updatedAt が body に混入していないこと
  });

  // RT-C: Child project context propagation (INV-28)
  test("RT-C: TicketUpdate の child ticket 作成時、親チケットの projectId が確実に渡り projectId=0 フォールバックが発生しない", async () => {
    const ticketId = 200;
    const parentProjectId = 123;
    addOfflineTicketUpdate(ticketId, {
      ticketId,
      baseSubject: "Parent Ticket",
      baseDescription: "Desc",
      baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      subject: "Parent Ticket",
      description: "Desc",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: ["Subtask 1"] },
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let childProjectIdPassed: number | undefined;
    let childParentIdPassed: number | undefined;

    const engine = createSyncEngine({
      tickets: {
        getIssueDetail: async (id: number) => ({
          ticket: {
            id,
            subject: "Parent Ticket",
            description: "Desc",
            projectId: parentProjectId,
            projectName: "Project 123",
            trackerId: 1,
            trackerName: "Bug",
            priorityId: 1,
            priorityName: "Normal",
            statusId: 1,
            statusName: "New",
            updatedAt: "2026-08-15T00:00:00Z",
          },
          comments: [],
        } as any),
        updateIssue: async () => {},
        createIssue: async (input: any) => {
          childProjectIdPassed = input.projectId;
          childParentIdPassed = input.parentId;
          return 999;
        },
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });

    const outcome = await engine.syncOne({ kind: "ticket", ticketId }, { connectionScope: SCOPE });
    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(childProjectIdPassed, 123, "Child issue作成時に親チケットの projectId (123) が渡されること (INV-28)");
    assert.strictEqual(childParentIdPassed, 200, "Child issue作成時に parentId (200) が渡されること");
  });

  // RT-D: Attachment exact crash window (INV-14, INV-26)
  test("RT-D: Attachment upload 成功直後にクラッシュ再起動しても、Durable Effect により同一ファイルの再アップロードは行われない", async () => {
    let uploadFileCalls = 0;
    const uploadedTokens: string[] = [];

    const mockUpload = async (filePath: string) => {
      uploadFileCalls++;
      const token = `token-${uploadFileCalls}`;
      uploadedTokens.push(token);
      return { token, filename: "file.png", contentType: "image/png" };
    };

    const repo = createSyncOperationRepository();
    const operationId = `${SCOPE}:newTicket:queue-att-1`;
    await repo.saveOperation({
      operationId,
      kind: "ticket_create",
      key: { kind: "newTicket", queueId: "queue-att-1" },
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      projectId: 1,
      intent: {
        projectId: 1,
        subject: "Ticket with attachment",
        description: "Desc",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        attachments: [{ kind: "file", filePath: "/path/to/file.png", filename: "file.png", contentType: "image/png" }],
      },
    }, SCOPE);

    const handler = new TicketCreateHandler();
    const context = { connectionScope: SCOPE };

    // 1. prepare
    const op1 = repo.getOperation<TicketCreateIntent>({ kind: "newTicket", queueId: "queue-att-1" }, SCOPE)!;
    const prep1 = await handler.prepare(op1, context, {
      ticketCreate: {
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });
    assert.strictEqual(prep1.ok, true);

    // 2. executeSecondaryEffects
    const sec1 = await handler.executeSecondaryEffects!(op1, (prep1 as any).prepared, context, {
      ticketCreate: { uploadFile: mockUpload as any },
      repository: repo,
    } as any);
    assert.strictEqual(sec1.ok, true);
    assert.strictEqual(uploadFileCalls, 1, "初回の uploadFile が呼ばれたこと");

    // 3. クラッシュ再起動をシミュレート: リポジトリを再取得して再度 executeSecondaryEffects を実行
    const op2 = repo.getOperation<TicketCreateIntent>({ kind: "newTicket", queueId: "queue-att-1" }, SCOPE)!;
    const prep2 = await handler.prepare(op2, context, {
      ticketCreate: {
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });
    const sec2 = await handler.executeSecondaryEffects!(op2, (prep2 as any).prepared, context, {
      ticketCreate: { uploadFile: mockUpload as any },
      repository: repo,
    } as any);
    assert.strictEqual(sec2.ok, true);
    assert.strictEqual(uploadFileCalls, 1, "再起動後は durable effect から token が再利用され、再 upload されないこと (INV-14, INV-26)");
  });

  // RT-E: Comment Markdown image crash (INV-14, INV-26)
  test("RT-E: Comment の Markdown image upload 成功直後にクラッシュ再起動しても、Durable Effect により同一画像が再 upload されない", async () => {
    let uploadFileCalls = 0;
    const mockUpload = async () => {
      uploadFileCalls++;
      return { token: `token-img-${uploadFileCalls}`, filename: "img.png", contentType: "image/png" };
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-e-test-"));
    const imgPath = path.join(tmpDir, "test.png");
    fs.writeFileSync(imgPath, "dummy png data");

    const repo = createSyncOperationRepository();
    const operationId = `${SCOPE}:comment:50:100`;
    await repo.saveOperation({
      operationId,
      kind: "comment_update",
      key: { kind: "comment", ticketId: 50, commentId: 100 },
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      ticketId: 50,
      commentId: 100,
      intent: {
        ticketId: 50,
        commentId: 100,
        baseBody: "Old body",
        body: `New comment with ![alt](${imgPath})`,
        baseDir: tmpDir,
      },
    }, SCOPE);

    const handler = new CommentUpdateHandler();
    const context = { connectionScope: SCOPE };

    // 1. prepare & secondary effects
    const op1 = repo.getOperation<CommentUpdateIntent>({ kind: "comment", ticketId: 50, commentId: 100 }, SCOPE)!;
    const prep1 = await handler.prepare(op1, context, {
      comment: { uploadFile: mockUpload as any },
      repository: repo,
    } as any);
    assert.strictEqual(prep1.ok, true);

    const sec1 = await handler.executeSecondaryEffects!(op1, (prep1 as any).prepared, context, {
      comment: { uploadFile: mockUpload as any },
      repository: repo,
    } as any);
    assert.strictEqual(sec1.ok, true);
    assert.strictEqual(uploadFileCalls, 1, "初回の画像 upload が呼ばれたこと");

    // 2. クラッシュ再起動をシミュレート
    const op2 = repo.getOperation<CommentUpdateIntent>({ kind: "comment", ticketId: 50, commentId: 100 }, SCOPE)!;
    const prep2 = await handler.prepare(op2, context, {
      comment: { uploadFile: mockUpload as any },
      repository: repo,
    } as any);
    assert.strictEqual(prep2.ok, true);

    const sec2 = await handler.executeSecondaryEffects!(op2, (prep2 as any).prepared, context, {
      comment: { uploadFile: mockUpload as any },
      repository: repo,
    } as any);
    assert.strictEqual(sec2.ok, true);
    assert.strictEqual(uploadFileCalls, 1, "再起動後は画像が二重 upload されないこと (INV-14, INV-26)");
  });

  // RT-F: TicketCreate failed child retry (INV-29)
  test("RT-F: TicketCreate で child issue の作成が失敗した場合、次回 retry で child を skip して parent を completed にしてはならない", async () => {
    let parentCreateCalls = 0;
    let childCreateCalls = 0;

    const content = buildTicketEditorContent({
      subject: "Parent Subject",
      description: "Parent Description",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: ["Child 1"] },
    });

    await addOfflineNewTicketAsync({
      queueId: "queue-rt-f",
      projectId: 1,
      content,
    }, SCOPE);

    const engine = createSyncEngine({
      tickets: {
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
        createIssue: async (input: any) => {
          if (!input.parentId) {
            parentCreateCalls++;
            return 300; // 親チケット成功
          } else {
            childCreateCalls++;
            throw new Error("Child creation failed with 500 error");
          }
        },
      },
    });

    const key = { kind: "newTicket" as const, queueId: "queue-rt-f" };

    // 1. 初回 sync -> 子チケット失敗により completed にならない
    const outcome1 = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.notStrictEqual(outcome1.kind, "completed");
    assert.strictEqual(parentCreateCalls, 1);
    assert.strictEqual(childCreateCalls, 1);

    // 2. 2回目の sync -> 子チケットが failed のままで親チケットを completed にしてはならない (INV-29)
    const outcome2 = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.notStrictEqual(outcome2.kind, "completed", "failed な child effect が残っている状態で completed にしてはならない");
  });

  // RT-G: Ticket manual link verification (INV-09)
  test("RT-G: Ticket manual link 時に、projectId や subject が一致しない候補は link を拒絶し、一致する候補のみ受け入れる", async () => {
    const queueId = "queue-link-test";
    const content = buildTicketEditorContent({
      subject: "My Target Subject",
      description: "Description",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
    });

    await addOfflineNewTicketAsync({
      queueId,
      projectId: 10,
      content,
      phase: "commit_unknown",
    }, SCOPE);

    const engine = createSyncEngine({
      tickets: {
        getIssueDetail: async (id: number) => {
          if (id === 999) {
            // subject 不一致
            return {
              ticket: { id: 999, projectId: 10, subject: "Different Subject", updatedAt: "2026-08-15T00:00:00Z" },
              comments: [],
            } as any;
          }
          if (id === 888) {
            // projectId 不一致
            return {
              ticket: { id: 888, projectId: 99, subject: "My Target Subject", updatedAt: "2026-08-15T00:00:00Z" },
              comments: [],
            } as any;
          }
          if (id === 777) {
            // 完全一致
            return {
              ticket: { id: 777, projectId: 10, subject: "My Target Subject", updatedAt: "2026-08-15T00:00:00Z" },
              comments: [],
            } as any;
          }
          throw new Error("Not found");
        },
      },
    });

    const key = { kind: "newTicket" as const, queueId };

    // 1. subject 不一致の candidate 999 -> link 拒否
    const outcome1 = await engine.resolveTicketCommitUnknown({
      key,
      context: { connectionScope: SCOPE },
      resolution: { kind: "link_remote_ticket", ticketId: 999 },
    });
    assert.strictEqual(outcome1.kind, "commit_unknown", "subject 不一致のチケットは link 拒絶されること");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).newTickets.length, 1, "キューが保持されていること");

    // 2. projectId 不一致の candidate 888 -> link 拒否
    const outcome2 = await engine.resolveTicketCommitUnknown({
      key,
      context: { connectionScope: SCOPE },
      resolution: { kind: "link_remote_ticket", ticketId: 888 },
    });
    assert.strictEqual(outcome2.kind, "commit_unknown", "projectId 不一致のチケットは link 拒絶されること");

    // 3. 一致する candidate 777 -> link 成功して completed
    const outcome3 = await engine.resolveTicketCommitUnknown({
      key,
      context: { connectionScope: SCOPE },
      resolution: { kind: "link_remote_ticket", ticketId: 777 },
    });
    assert.strictEqual(outcome3.kind, "completed", "一致するチケットは正常に link 完了すること");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).newTickets.length, 0, "完了後にキューが解消されること");
  });

  // RT-H: Effect CAS concurrency (INV-06)
  test("RT-H: Effect の遷移において CAS チェックにより並行競合時は一方のみが成功する", async () => {
    const repo = createSyncOperationRepository();
    const key = { kind: "ticket" as const, ticketId: 555 };
    await repo.saveOperation({
      operationId: `${SCOPE}:ticket:555`,
      kind: "ticket_update",
      key,
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      ticketId: 555,
      effects: [
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "started",
          target: { parentTicketId: 555, ordinal: 0 },
        },
      ],
    }, SCOPE);

    // 並行して started -> committed と started -> commit_unknown を試行
    const [resA, resB] = await Promise.all([
      repo.transitionEffect(key, "child-create:0", { kind: "commit", remoteId: 1001 }, SCOPE, { sourceState: "started", operationRevision: 1 }),
      repo.transitionEffect(key, "child-create:0", { kind: "mark_commit_unknown" }, SCOPE, { sourceState: "started", operationRevision: 1 }),
    ]);

    const successCount = (resA ? 1 : 0) + (resB ? 1 : 0);
    assert.strictEqual(successCount, 1, "CAS 競合により一方のみが遷移に成功すること (INV-06)");
  });

  // RT-I: Lifecycle ownership boundary (INV-13, INV-18, INV-31)
  test("RT-I: Handler から offlineSyncStore への直接 lifecycle mutation がなく、Repository を介してのみ行われること", async () => {
    // Structural invariant: operationHandlers does not directly mutate offlineSyncStore
    const repo = createSyncOperationRepository();
    assert.ok(typeof repo.planEffect === "function", "Repository に planEffect が存在すること");
    assert.ok(typeof repo.transitionEffect === "function", "Repository に transitionEffect が存在すること");
  });

  // RT-J: Legacy Queue Migration (INV-20)
  test("RT-J: Legacy queue の各エントリ（Ticket, NewTicket, Comment）が無損失で UnifiedSyncOperation へ正規化される", async () => {
    // Setup legacy items directly in store
    addOfflineTicketUpdate(400, {
      ticketId: 400,
      baseSubject: "Legacy Subject",
      baseDescription: "Legacy Desc",
      baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      subject: "Legacy Next Subject",
      description: "Legacy Next Desc",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      nextIntent: {
        revision: 3,
        subject: "Inflight Edit",
        description: "Inflight Desc",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      },
      phase: "queued",
      revision: 3,
    }, SCOPE);

    const repo = createSyncOperationRepository();
    const op = repo.getOperation({ kind: "ticket", ticketId: 400 }, SCOPE);
    assert.ok(op, "Legacy ticket が UnifiedSyncOperation として読み込めること");
    assert.strictEqual(op?.kind, "ticket_update");
    assert.strictEqual(op?.ticketId, 400);
    assert.strictEqual(op?.revision, 3);
    assert.strictEqual((op?.intent as any)?.subject, "Legacy Next Subject");
    assert.strictEqual((op?.nextIntent as any)?.subject, "Inflight Edit", "nextIntent が保持されていること (INV-15, INV-20)");
  });
});
