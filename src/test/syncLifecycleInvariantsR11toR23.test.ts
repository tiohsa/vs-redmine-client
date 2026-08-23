import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  initializeOfflineSyncStore,
  addOfflineNewTicketAsync,
  addOfflineCommentUpdate,
  getOfflineSyncQueue,
} from "../views/offlineSyncStore";
import { createSyncEngine } from "../app/syncEngine";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildTicketEditorContent } from "../views/ticketEditorContent";

const SCOPE = "https://redmine.example.org/r11-r23-suite";

const metadataDeps = {
  deleteIssue: async () => undefined,
  listIssueStatuses: async () => [{ id: 1, name: "New" }, { id: 2, name: "In Progress" }, { id: 3, name: "Closed" }],
  listTrackers: async () => [{ id: 1, name: "Bug" }, { id: 2, name: "Feature" }, { id: 3, name: "Task" }],
  listIssuePriorities: async () => [{ id: 1, name: "Low" }, { id: 2, name: "Normal" }, { id: 3, name: "High" }],
  searchUsers: async () => [],
  uploadFile: async () => ({ token: "dummy-token", filename: "dummy.png", contentType: "image/png" }),
  getProjectTrackers: async () => [{ id: 1, name: "Bug" }, { id: 2, name: "Feature" }, { id: 3, name: "Task" }],
};

suite("R11 〜 R23: Invariant & Lifecycle Recovery Tests", () => {
  let memento: vscode.Memento;

  setup(() => {
    memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
  });

  // R11: Known failed child retry (Primary write=0, Child retry=1, Final=completed)
  test("R11: Primary committed 後に child CREATE が known retryable failure で failed となった場合、explicit retry で child が committed になり completed に到達する", async () => {
    const content = buildTicketEditorContent({
      subject: "Parent Ticket",
      description: "Description",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: ["Child Task 1"] },
    });
    const newTicket = await addOfflineNewTicketAsync({
      content,
      projectId: 1,
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let parentCreateCalls = 0;
    let childCreateCalls = 0;
    let failChildOnce = true;

    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        deleteIssue: undefined,
        createIssue: async (input: any) => {
          if (input.parentId) {
            childCreateCalls++;
            if (failChildOnce) {
              failChildOnce = false;
              const err: any = new Error("503 Service Unavailable");
              err.status = 503;
              throw err;
            }
            return 8001; // Child issue ID
          }
          parentCreateCalls++;
          return 7001; // Parent issue ID
        },
        getIssueDetail: async (id: number) => ({
          ticket: {
            id,
            projectId: 1,
            subject: id === 7001 ? "Parent Ticket" : "Child Task 1",
            updatedAt: "2026-08-16T00:00:00Z",
          },
        }),
      },
    });

    // 1回目の同期: 親は成功、子は 503 で失敗
    const firstOutcome = await engine.syncOne(
      { kind: "newTicket", queueId: newTicket.queueId },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(parentCreateCalls, 1, "親チケットは1回作成される");
    assert.strictEqual(childCreateCalls, 1, "子チケット作成が1回試行される");
    assert.strictEqual(firstOutcome.kind, "remote_committed", "親が committed なので remote_committed");

    const queueAfterFirst = getOfflineSyncQueue(SCOPE);
    const savedNewTicket = queueAfterFirst.newTickets.find((t) => t.queueId === newTicket.queueId);
    assert.ok(savedNewTicket, "キューにチケットが存在する");
    const childEffect = savedNewTicket.effects?.find((e) => e.effectId === "child-create:0" || e.kind === "child_create");
    assert.ok(childEffect, "child effect が存在する");
    assert.ok(childEffect.state === "failed" || childEffect.state === "commit_unknown", "child effect は failed または commit_unknown 状態");

    // 2回目: resolveEffect 経由で explicit retry
    const retryOutcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: newTicket.queueId },
      operationId: savedNewTicket.operationId ?? savedNewTicket.queueId,
      operationRevision: savedNewTicket.revision ?? 1,
      attemptGeneration: savedNewTicket.attemptGeneration ?? 1,
      effectId: childEffect.effectId,
      expectedEffectState: childEffect.state,
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_effect" },
    });

    assert.strictEqual(parentCreateCalls, 1, "親チケットの追加作成は 0 回 (再送しない)");
    assert.strictEqual(childCreateCalls, 2, "子チケット作成が explicit retry で 1回再試行される");
    assert.strictEqual(retryOutcome.kind, "completed", "最終的に completed に到達する");
  });

  // R12: Non-retriable known failure (Remote mutation = 0, Effect remains failed)
  test("R12: Effect が non_retriable known failure の場合、retry request は Remote mutation=0 で拒絶される", async () => {
    const content = buildTicketEditorContent({
      subject: "Parent Ticket",
      description: "Description",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: ["Invalid Child"] },
    });
    const newTicket = await addOfflineNewTicketAsync({
      content,
      projectId: 1,
      phase: "local_finalize_pending",
      createdIssueId: 7002,
      revision: 1,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          state: "committed",
          remoteId: 7002,
          operationRevision: 1,
          target: {},
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          state: "failed",
          failure: { disposition: "non_retriable", detail: "Validation Failed" },
          operationRevision: 1,
          target: { ordinal: 0 },
        },
      ],
    }, SCOPE);

    let childCreateCalls = 0;

    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        createIssue: async (input: any) => {
          if (input.parentId) {
            childCreateCalls++;
            const err: any = new Error("422 Unprocessable Entity - Validation Failed");
            err.status = 422;
            throw err;
          }
          return 7002;
        },
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Parent Ticket", updatedAt: "2026-08-16T00:00:00Z" },
        }),
      },
    });

    const queue = getOfflineSyncQueue(SCOPE);
    const saved = queue.newTickets.find((t) => t.queueId === newTicket.queueId)!;
    const childEffect = saved.effects?.find((e) => e.effectId === "child-create:0" || e.kind === "child_create")!;
    assert.strictEqual(childEffect.state, "failed");
    assert.strictEqual(childEffect.failure?.disposition, "non_retriable");

    const callsBeforeRetry = childCreateCalls;

    // retry 試行
    const retryOutcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: newTicket.queueId },
      operationId: saved.operationId ?? saved.queueId,
      operationRevision: saved.revision ?? 1,
      attemptGeneration: saved.attemptGeneration ?? 1,
      effectId: childEffect.effectId,
      expectedEffectState: "failed",
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_effect" },
    });

    assert.strictEqual(childCreateCalls, callsBeforeRetry, "Remote mutation = 0 (再試行されない)");
    assert.strictEqual(retryOutcome.kind, "failed_before_commit", "non_retriable のため拒絶");

    const queueAfterRetry = getOfflineSyncQueue(SCOPE);
    const effectAfter = queueAfterRetry.newTickets.find((t) => t.queueId === newTicket.queueId)!.effects?.find((e) => e.effectId === childEffect.effectId)!;
    assert.strictEqual(effectAfter.state, "failed", "Effect は failed のまま維持される");
  });

  // R13: Secondary unknown resume (image upload commit_unknown -> assume/link -> normal sync -> Primary write=1, completed)
  test("R13: image upload が commit_unknown となった後、assume/link で解決すると normal sync で Primary write が行われ completed になる", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "r13-test-"));
    const imgPath = path.join(tmpDir, "image.png");
    fs.writeFileSync(imgPath, "image data bytes");

    const commentFile = path.join(tmpDir, "comment.md");
    const rawBody = `Body with image: ![img](${imgPath})`;
    fs.writeFileSync(commentFile, rawBody);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(commentFile));

    addOfflineCommentUpdate({
      ticketId: 401,
      body: rawBody,
      baseDir: tmpDir,
      documentUri: doc.uri.toString(),
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let uploadCalls = 0;
    let addCommentCalls = 0;
    let timeoutUpload = true;

    const engine = createSyncEngine({
      comments: {
        getCurrentUserId: async () => 1,
        uploadFile: async () => {
          uploadCalls++;
          if (timeoutUpload) {
            timeoutUpload = false;
            const err: any = new Error("ETIMEDOUT");
            err.code = "ETIMEDOUT";
            throw err;
          }
          return { token: "token-image-401", filename: "image.png", contentType: "image/png" };
        },
        addComment: async (_ticketId, _notes, _uploads) => {
          addCommentCalls++;
        },
        getIssueDetail: async (ticketId) => ({
          ticket: { id: ticketId, projectId: 1, updatedAt: "2026-08-16T00:00:00Z" } as any,
          comments: [
            { id: 901, ticketId, body: "Body with image: ![img](image.png)", authorId: 1, user: { id: 1, name: "Me" } } as any,
          ],
        }),
      },
    });

    // 1回目: upload が ETIMEDOUT (commit_unknown)
    const firstOutcome = await engine.syncOne(
      { kind: "comment", ticketId: 401, documentUri: doc.uri.toString() },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(uploadCalls, 1, "upload が 1回試行される");
    assert.strictEqual(addCommentCalls, 0, "Primary write (addComment) は呼ばれない");

    const queue = getOfflineSyncQueue(SCOPE);
    const commentOp = queue.comments.find((c) => c.ticketId === 401)!;
    // Operation phase は commit_unknown ではなく preparing または queued (Secondary uncertainty は Operation commit_unknown にしない)
    assert.notStrictEqual(commentOp.phase, "commit_unknown", "Secondary unknown で Operation 全体が commit_unknown にならない (RC-1)");
    const uploadEffect = commentOp.effects?.find((e) => e.kind === "attachment_upload" || e.kind === "image_upload")!;
    assert.ok(uploadEffect, "upload effect が存在する");
    assert.strictEqual(uploadEffect.state, "commit_unknown", "upload effect は commit_unknown");

    // 2回目: resolveEffect で assume_committed (token を link)
    await engine.resolveEffect({
      key: { kind: "comment", ticketId: 401, documentUri: doc.uri.toString() },
      operationId: commentOp.operationId ?? `comment:401:${doc.uri.toString()}`,
      operationRevision: commentOp.revision ?? 1,
      attemptGeneration: commentOp.attemptGeneration ?? 1,
      effectId: uploadEffect.effectId,
      expectedEffectState: "commit_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "assume_committed", token: "assumed-token-401" },
    });

    // 3回目: 通常 sync を再開
    const resumeOutcome = await engine.syncOne(
      { kind: "comment", ticketId: 401, documentUri: doc.uri.toString() },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(uploadCalls, 1, "image reupload は 0 回 (再アップロードしない)");
    assert.strictEqual(addCommentCalls, 1, "Primary write (addComment) が 1回呼ばれる");
    assert.strictEqual(resumeOutcome.kind, "completed", "completed に到達する");
  });

  // R14: Child unknown blind retry rejection (createIssue = 0, Effect remains unresolved)
  test("R14: child_create が commit_unknown の場合、absence が証明されていない blind retry は拒絶され createIssue=0 となる", async () => {
    const content = buildTicketEditorContent({
      subject: "Parent Ticket",
      description: "Description",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: ["Child Unknown"] },
    });
    const newTicket = await addOfflineNewTicketAsync({
      content,
      projectId: 1,
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let childCreateCalls = 0;
    let timeoutChild = true;

    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        createIssue: async (input: any) => {
          if (input.parentId) {
            childCreateCalls++;
            if (timeoutChild) {
              timeoutChild = false;
              const err: any = new Error("ETIMEDOUT");
              err.code = "ETIMEDOUT";
              throw err;
            }
            return 8002;
          }
          return 7003;
        },
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Parent Ticket", updatedAt: "2026-08-16T00:00:00Z" },
        }),
      },
    });

    // 初回同期で child が ETIMEDOUT
    await engine.syncOne(
      { kind: "newTicket", queueId: newTicket.queueId },
      { connectionScope: SCOPE },
    );

    const queue = getOfflineSyncQueue(SCOPE);
    const saved = queue.newTickets.find((t) => t.queueId === newTicket.queueId)!;
    const childEffect = saved.effects?.find((e) => e.effectId === "child-create:0" || e.kind === "child_create")!;
    assert.strictEqual(childEffect.state, "commit_unknown");

    const callsBeforeBlindRetry = childCreateCalls;

    // blind retry 試行 (retry_effect を absence verification なしで呼ぶ)
    const retryOutcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: newTicket.queueId },
      operationId: saved.operationId ?? saved.queueId,
      operationRevision: saved.revision ?? 1,
      attemptGeneration: saved.attemptGeneration ?? 1,
      effectId: childEffect.effectId,
      expectedEffectState: "commit_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_effect" },
    });

    assert.strictEqual(childCreateCalls, callsBeforeBlindRetry, "blind retry による createIssue は 0 回 (禁止)");
    assert.strictEqual(retryOutcome.kind, "failed_before_commit", "blind retry は拒絶される");

    const queueAfter = getOfflineSyncQueue(SCOPE);
    const effectAfter = queueAfter.newTickets.find((t) => t.queueId === newTicket.queueId)!.effects?.find((e) => e.effectId === childEffect.effectId)!;
    assert.strictEqual(effectAfter.state, "commit_unknown", "Effect は commit_unknown のまま維持される");
  });

  // R15: Child verified link (Effect = committed, Child CREATE additional = 0, Operation completed)
  test("R15: child_create commit_unknown から remoteId を指定して検証に成功した場合、Effect が committed になり Operation が completed になる", async () => {
    const content = buildTicketEditorContent({
      subject: "Parent Ticket",
      description: "Description",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: ["Child Task To Link"] },
    });
    const newTicket = await addOfflineNewTicketAsync({
      content,
      projectId: 1,
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let childCreateCalls = 0;

    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        createIssue: async (input: any) => {
          if (input.parentId) {
            childCreateCalls++;
            const err: any = new Error("ECONNRESET");
            err.code = "ECONNRESET";
            throw err;
          }
          return 7004;
        },
        getIssueDetail: async (id: number) => {
          if (id === 8888) {
            return {
              ticket: {
                id: 8888,
                parentId: 7004,
                projectId: 1,
                subject: "Child Task To Link",
                updatedAt: "2026-08-16T00:00:00Z",
              },
            };
          }
          return {
            ticket: { id, projectId: 1, subject: "Parent Ticket", updatedAt: "2026-08-16T00:00:00Z" },
          };
        },
      },
    });

    await engine.syncOne(
      { kind: "newTicket", queueId: newTicket.queueId },
      { connectionScope: SCOPE },
    );

    const queue = getOfflineSyncQueue(SCOPE);
    const saved = queue.newTickets.find((t) => t.queueId === newTicket.queueId)!;
    const childEffect = saved.effects?.find((e) => e.effectId === "child-create:0" || e.kind === "child_create")!;
    assert.strictEqual(childEffect.state, "commit_unknown");

    const callsBeforeLink = childCreateCalls;

    // link_remote_child で 8888 を検証して link
    const linkOutcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: newTicket.queueId },
      operationId: saved.operationId ?? saved.queueId,
      operationRevision: saved.revision ?? 1,
      attemptGeneration: saved.attemptGeneration ?? 1,
      effectId: childEffect.effectId,
      expectedEffectState: "commit_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "link_remote_child", remoteId: 8888 },
    });

    assert.strictEqual(childCreateCalls, callsBeforeLink, "Child CREATE additional call = 0");
    assert.strictEqual(linkOutcome.kind, "completed", "Operation completed");
  });

  // R16: Wrong child identity (wrong parent / project / subject -> commit_unknown preserved, Remote mutation=0)
  test("R16: child link で parentId や projectId、subject が不一致の場合、link は拒絶され Effect は commit_unknown を維持する", async () => {
    const content = buildTicketEditorContent({
      subject: "Parent Ticket",
      description: "Description",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: ["Expected Subject"] },
    });
    const newTicket = await addOfflineNewTicketAsync({
      content,
      projectId: 1,
      phase: "queued",
      revision: 1,
    }, SCOPE);

    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        createIssue: async (input: any) => {
          if (input.parentId) {
            const err: any = new Error("ETIMEDOUT");
            err.code = "ETIMEDOUT";
            throw err;
          }
          return 7005;
        },
        getIssueDetail: async (id: number) => {
          if (id === 9999) {
            // wrong parentId: 9999 has parentId 1234 instead of 7005
            return {
              ticket: {
                id: 9999,
                parentId: 1234,
                projectId: 1,
                subject: "Expected Subject",
                updatedAt: "2026-08-16T00:00:00Z",
              },
            };
          }
          return {
            ticket: { id, projectId: 1, subject: "Parent Ticket", updatedAt: "2026-08-16T00:00:00Z" },
          };
        },
      },
    });

    await engine.syncOne(
      { kind: "newTicket", queueId: newTicket.queueId },
      { connectionScope: SCOPE },
    );

    const queue = getOfflineSyncQueue(SCOPE);
    const saved = queue.newTickets.find((t) => t.queueId === newTicket.queueId)!;
    const childEffect = saved.effects?.find((e) => e.effectId === "child-create:0" || e.kind === "child_create")!;

    // 誤ったチケット ID (9999) を link しようとする
    const linkOutcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: newTicket.queueId },
      operationId: saved.operationId ?? saved.queueId,
      operationRevision: saved.revision ?? 1,
      attemptGeneration: saved.attemptGeneration ?? 1,
      effectId: childEffect.effectId,
      expectedEffectState: "commit_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "link_remote_child", remoteId: 9999 },
    });

    assert.strictEqual(linkOutcome.kind, "failed_before_commit", "parent mismatch により拒絶");

    const queueAfter = getOfflineSyncQueue(SCOPE);
    const effectAfter = queueAfter.newTickets.find((t) => t.queueId === newTicket.queueId)!.effects?.find((e) => e.effectId === childEffect.effectId)!;
    assert.strictEqual(effectAfter.state, "commit_unknown", "Effect は commit_unknown を維持");
  });

  // R17: Stale revision Recovery (persistent mutation=0, Remote mutation=0)
  test("R17: Stale revision (古い revision) による Recovery は persistent mutation=0, Remote mutation=0 で拒絶される", async () => {
    const content = buildTicketEditorContent({
      subject: "Parent",
      description: "Desc",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: ["Child 1"] },
    });
    const newTicket = await addOfflineNewTicketAsync({
      content,
      projectId: 1,
      phase: "queued",
      revision: 2, // Current revision is 2
    }, SCOPE);

    let childCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        deleteIssue: undefined,
        createIssue: async (input: any) => {
          if (input.parentId) {
            childCalls++;
            throw new Error("503");
          }
          return 7006;
        },
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Parent", updatedAt: "2026-08-16T00:00:00Z" },
        }),
      },
    });

    await engine.syncOne(
      { kind: "newTicket", queueId: newTicket.queueId },
      { connectionScope: SCOPE },
    );

    const saved = getOfflineSyncQueue(SCOPE).newTickets.find((t) => t.queueId === newTicket.queueId)!;
    const childEffect = saved.effects?.find((e) => e.kind === "child_create")!;
    const callsBefore = childCalls;

    // Stale revision = 1 (現在の revision は 2)
    const outcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: newTicket.queueId },
      operationId: saved.operationId ?? saved.queueId,
      operationRevision: 1, // Stale!
      attemptGeneration: saved.attemptGeneration ?? 1,
      effectId: childEffect.effectId,
      expectedEffectState: childEffect.state,
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_effect" },
    });

    assert.strictEqual(childCalls, callsBefore, "Remote mutation = 0");
    assert.strictEqual(outcome.kind, "failed_before_commit", "Revision mismatch で拒絶");
  });

  // R18: Wrong connection scope (state mutation=0, Remote mutation=0)
  test("R18: 異なる connectionScope からの Recovery は state mutation=0, Remote mutation=0 で拒絶される", async () => {
    const content = buildTicketEditorContent({
      subject: "Parent",
      description: "Desc",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: ["Child 1"] },
    });
    const newTicket = await addOfflineNewTicketAsync({
      content,
      projectId: 1,
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let childCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        deleteIssue: undefined,
        createIssue: async (input: any) => {
          if (input.parentId) {
            childCalls++;
            throw new Error("503");
          }
          return 7007;
        },
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Parent", updatedAt: "2026-08-16T00:00:00Z" },
        }),
      },
    });

    await engine.syncOne(
      { kind: "newTicket", queueId: newTicket.queueId },
      { connectionScope: SCOPE },
    );

    const saved = getOfflineSyncQueue(SCOPE).newTickets.find((t) => t.queueId === newTicket.queueId)!;
    const childEffect = saved.effects?.find((e) => e.kind === "child_create")!;
    const callsBefore = childCalls;

    // 異なる scope
    const wrongScope = "https://redmine.other-scope.example.org";
    const outcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: newTicket.queueId },
      operationId: saved.operationId ?? saved.queueId,
      operationRevision: saved.revision ?? 1,
      attemptGeneration: saved.attemptGeneration ?? 1,
      effectId: childEffect.effectId,
      expectedEffectState: childEffect.state,
      context: { connectionScope: wrongScope },
      resolution: { kind: "retry_effect" },
    });

    assert.strictEqual(childCalls, callsBefore, "Remote mutation = 0");
    assert.strictEqual(outcome.kind, "failed_before_commit", "Scope mismatch で拒絶");
  });

  // R19: Upload content changed (snapshot hash=A, file now hash=B -> upload call=0)
  test("R19: Upload の retry 前にファイル内容が変更されていた場合 (hash不一致)、upload は呼ばれず拒絶される", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "r19-test-"));
    const imgPath = path.join(tmpDir, "upload_test.png");
    fs.writeFileSync(imgPath, "original content A");

    const commentFile = path.join(tmpDir, "comment_r19.md");
    const rawBody = `Notes: ![img](${imgPath})`;
    fs.writeFileSync(commentFile, rawBody);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(commentFile));

    addOfflineCommentUpdate({
      ticketId: 501,
      body: rawBody,
      baseDir: tmpDir,
      documentUri: doc.uri.toString(),
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let uploadCalls = 0;
    const engine = createSyncEngine({
      comments: {
        getCurrentUserId: async () => 1,
        uploadFile: async () => {
          uploadCalls++;
          throw new Error("ETIMEDOUT");
        },
      },
    });

    await engine.syncOne(
      { kind: "comment", ticketId: 501, documentUri: doc.uri.toString() },
      { connectionScope: SCOPE },
    );

    const saved = getOfflineSyncQueue(SCOPE).comments.find((c) => c.ticketId === 501)!;
    const uploadEffect = saved.effects?.find((e) => e.kind === "attachment_upload" || e.kind === "image_upload")!;
    assert.ok(uploadEffect.state === "failed" || uploadEffect.state === "commit_unknown");

    // ファイル内容を変更 (hash B)
    fs.writeFileSync(imgPath, "modified content B (different hash)");

    const callsBefore = uploadCalls;

    const retryOutcome = await engine.resolveEffect({
      key: { kind: "comment", ticketId: 501, documentUri: doc.uri.toString() },
      operationId: saved.operationId ?? `comment:501:${doc.uri.toString()}`,
      operationRevision: saved.revision ?? 1,
      attemptGeneration: saved.attemptGeneration ?? 1,
      effectId: uploadEffect.effectId,
      expectedEffectState: uploadEffect.state,
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_effect" },
    });

    assert.strictEqual(uploadCalls, callsBefore, "Upload call = 0 (hash不一致のためアップロードを実行しない)");
    assert.strictEqual(retryOutcome.kind, "failed_before_commit", "hash mismatch により拒絶");
  });

  // R20: Upload content unchanged (snapshot hash=A, file hash=A -> allowed explicit retry, upload call=1)
  test("R20: Upload の retry 前にファイル内容が不変である場合 (hash一致)、explicit retry が許可され upload される", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "r20-test-"));
    const imgPath = path.join(tmpDir, "upload_test2.png");
    fs.writeFileSync(imgPath, "stable content A");

    const commentFile = path.join(tmpDir, "comment_r20.md");
    const rawBody = `Notes: ![img](${imgPath})`;
    fs.writeFileSync(commentFile, rawBody);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(commentFile));

    addOfflineCommentUpdate({
      ticketId: 502,
      body: rawBody,
      baseDir: tmpDir,
      documentUri: doc.uri.toString(),
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let uploadCalls = 0;
    let failUploadOnce = true;

    const engine = createSyncEngine({
      comments: {
        getCurrentUserId: async () => 1,
        uploadFile: async () => {
          uploadCalls++;
          if (failUploadOnce) {
            failUploadOnce = false;
            throw new Error("ETIMEDOUT");
          }
          return { token: "token-stable-502", filename: "upload_test2.png", contentType: "image/png" };
        },
        addComment: async () => {},
        getIssueDetail: async (ticketId) => ({
          ticket: { id: ticketId, projectId: 1, updatedAt: "2026-08-16T00:00:00Z" } as any,
          comments: [
            { id: 902, ticketId, body: "Notes: ![img](upload_test2.png)", authorId: 1, user: { id: 1, name: "Me" } } as any,
          ],
        }),
      },
    });

    await engine.syncOne(
      { kind: "comment", ticketId: 502, documentUri: doc.uri.toString() },
      { connectionScope: SCOPE },
    );

    const saved = getOfflineSyncQueue(SCOPE).comments.find((c) => c.ticketId === 502)!;
    const uploadEffect = saved.effects?.find((e) => e.kind === "attachment_upload" || e.kind === "image_upload")!;
    assert.ok(uploadEffect.state === "failed" || uploadEffect.state === "commit_unknown");

    const callsBefore = uploadCalls;

    // ファイル内容はそのまま (hash一致)
    const retryOutcome = await engine.resolveEffect({
      key: { kind: "comment", ticketId: 502, documentUri: doc.uri.toString() },
      operationId: saved.operationId ?? `comment:502:${doc.uri.toString()}`,
      operationRevision: saved.revision ?? 1,
      attemptGeneration: saved.attemptGeneration ?? 1,
      effectId: uploadEffect.effectId,
      expectedEffectState: uploadEffect.state,
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_effect" },
    });

    assert.strictEqual(uploadCalls, callsBefore + 1, "Upload call = 1 (hash一致のため再試行が実行される)");
  });

  // R21: Request Snapshot immutability (Revision N snapshot used during recovery, not contaminated by new Intent)
  test("R21: Revision N 作成後に local Intent が変更されても、Recovery では Revision N Snapshot の値が使用される", async () => {
    const content = buildTicketEditorContent({
      subject: "Parent",
      description: "Original Desc",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: ["Original Child Title"] },
    });
    const newTicket = await addOfflineNewTicketAsync({
      content,
      projectId: 1,
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let submittedChildSubject = "";
    let failChildOnce = true;

    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        deleteIssue: undefined,
        createIssue: async (input: any) => {
          if (input.parentId) {
            submittedChildSubject = input.subject;
            if (failChildOnce) {
              failChildOnce = false;
              throw new Error("503");
            }
            return 8005;
          }
          return 7008;
        },
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Parent", updatedAt: "2026-08-16T00:00:00Z" },
        }),
      },
    });

    // 初回同期
    await engine.syncOne(
      { kind: "newTicket", queueId: newTicket.queueId },
      { connectionScope: SCOPE },
    );

    const saved = getOfflineSyncQueue(SCOPE).newTickets.find((t) => t.queueId === newTicket.queueId)!;
    const childEffect = saved.effects?.find((e) => e.kind === "child_create")!;
    assert.ok(childEffect.state === "failed" || childEffect.state === "commit_unknown");

    // local Intent を勝手に書き換える（例: nextIntent や別編集）
    saved.content = buildTicketEditorContent({
      subject: "Mutated Parent",
      description: "Mutated Desc",
      metadata: { tracker: "Feature", status: "In Progress", priority: "High", due_date: "", children: ["NEW Mutated Child Title"] },
    });

    // explicit retry
    await engine.resolveEffect({
      key: { kind: "newTicket", queueId: newTicket.queueId },
      operationId: saved.operationId ?? saved.queueId,
      operationRevision: saved.revision ?? 1,
      attemptGeneration: saved.attemptGeneration ?? 1,
      effectId: childEffect.effectId,
      expectedEffectState: childEffect.state,
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_effect" },
    });

    assert.strictEqual(
      submittedChildSubject,
      "Original Child Title",
      "Recovery では new Intent の値ではなく、Revision N Snapshot の元の subject が使用される (R21)",
    );
  });

  // R22: Primary generic recovery rejection (Primary Effect unchanged, Operation unchanged, Remote call=0)
  test("R22: Primary Effect (ticket-create / comment-create など) に対する generic resolveEffect は拒絶され、Remote call=0 となる", async () => {
    const content = buildTicketEditorContent({
      subject: "New Ticket",
      description: "Body",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "" },
    });
    const newTicket = await addOfflineNewTicketAsync({
      content,
      projectId: 1,
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let createIssueCalls = 0;
    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        deleteIssue: undefined,
        createIssue: async () => {
          createIssueCalls++;
          throw new Error("ETIMEDOUT");
        },
      },
    });

    await engine.syncOne(
      { kind: "newTicket", queueId: newTicket.queueId },
      { connectionScope: SCOPE },
    );

    const saved = getOfflineSyncQueue(SCOPE).newTickets.find((t) => t.queueId === newTicket.queueId)!;
    const primaryEffect = saved.effects?.find((e) => e.effectId === "ticket-create" || e.kind === "ticket_create")!;

    const callsBefore = createIssueCalls;

    // generic resolveEffect で Primary effect を retry しようとする
    const outcome = await engine.resolveEffect({
      key: { kind: "newTicket", queueId: newTicket.queueId },
      operationId: saved.operationId ?? saved.queueId,
      operationRevision: saved.revision ?? 1,
      attemptGeneration: saved.attemptGeneration ?? 1,
      effectId: primaryEffect.effectId,
      expectedEffectState: primaryEffect.state,
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_effect" },
    });

    assert.strictEqual(createIssueCalls, callsBefore, "Remote call = 0 (Primary generic recovery は禁止)");
    assert.strictEqual(outcome.kind, "failed_before_commit", "generic resolveEffect は拒絶される (R22)");
  });

  // R23: Concurrent Recovery (同一 Effect へ同時 Recovery x 2 -> Remote mutation <= 1)
  test("R23: 同一 Effect へ同時に resolveEffect を 2回呼び出した場合、single-flight により Remote mutation <= 1 となる", async () => {
    const content = buildTicketEditorContent({
      subject: "Parent",
      description: "Desc",
      metadata: { tracker: "Bug", status: "New", priority: "Normal", due_date: "", children: ["Concurrent Child"] },
    });
    const newTicket = await addOfflineNewTicketAsync({
      content,
      projectId: 1,
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let childCreateCalls = 0;
    let failOnce = true;

    const engine = createSyncEngine({
      tickets: {
        ...metadataDeps,
        deleteIssue: undefined,
        createIssue: async (input: any) => {
          if (input.parentId) {
            childCreateCalls++;
            if (failOnce) {
              failOnce = false;
              throw new Error("503");
            }
            // 少し待機して並行性をテスト
            await new Promise((resolve) => setTimeout(resolve, 50));
            return 8010;
          }
          return 7010;
        },
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Parent", updatedAt: "2026-08-16T00:00:00Z" },
        }),
      },
    });

    await engine.syncOne(
      { kind: "newTicket", queueId: newTicket.queueId },
      { connectionScope: SCOPE },
    );

    const saved = getOfflineSyncQueue(SCOPE).newTickets.find((t) => t.queueId === newTicket.queueId)!;
    const childEffect = saved.effects?.find((e) => e.kind === "child_create")!;
    assert.ok(childEffect.state === "failed" || childEffect.state === "commit_unknown");

    const callsBefore = childCreateCalls;

    // 2回同時に resolveEffect を呼び出す
    const [res1, res2] = await Promise.all([
      engine.resolveEffect({
        key: { kind: "newTicket", queueId: newTicket.queueId },
        operationId: saved.operationId ?? saved.queueId,
        operationRevision: saved.revision ?? 1,
        attemptGeneration: saved.attemptGeneration ?? 1,
        effectId: childEffect.effectId,
        expectedEffectState: childEffect.state,
        context: { connectionScope: SCOPE },
        resolution: { kind: "retry_effect" },
      }),
      engine.resolveEffect({
        key: { kind: "newTicket", queueId: newTicket.queueId },
        operationId: saved.operationId ?? saved.queueId,
        operationRevision: saved.revision ?? 1,
        attemptGeneration: saved.attemptGeneration ?? 1,
        effectId: childEffect.effectId,
        expectedEffectState: childEffect.state,
        context: { connectionScope: SCOPE },
        resolution: { kind: "retry_effect" },
      }),
    ]);

    assert.strictEqual(childCreateCalls - callsBefore, 1, "Concurrent recovery による Remote mutation <= 1");
    assert.ok(res1.kind === "completed" || res2.kind === "completed", "少なくとも一方は completed");
  });
});
