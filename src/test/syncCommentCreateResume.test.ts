import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { createSyncEngine } from "../app/syncEngine";
import { toUnifiedOperationFromComment } from "../app/ticketSync/syncRepository";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { computeNotesHash } from "../utils/notesHash";
import { parseCommentUpdateFile } from "../views/commentUpdateFile";
import {
  addOfflineCommentUpdateAsync,
  completeOfflineCommentAsync,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  switchOfflineSyncStore,
  type OfflineCommentUpdate,
} from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";

const SCOPE = "https://redmine.example.org/comment-create-resume/";

suite("Comment create local finalization resume", () => {
  teardown(() => {
    switchOfflineSyncStore(getCurrentConnectionScope());
  });

  test("確定した journal ID があっても現行の create Primary を維持する", () => {
    const operation = toUnifiedOperationFromComment({
      ticketId: 41,
      commentId: 701,
      body: "Created body",
      phase: "local_finalize_pending",
      revision: 2,
      attemptGeneration: 3,
      effects: [{
        effectId: "comment-create",
        kind: "comment_create",
        operationRevision: 2,
        attemptGeneration: 3,
        state: "committed",
        remoteId: 701,
        target: { ticketId: 41 },
      }],
    }, SCOPE);

    assert.strictEqual(operation.kind, "comment_create");
    assert.strictEqual(operation.createdRemoteId, 701);
    assert.ok(operation.intent && !("commentId" in operation.intent));
  });

  test("次の update は過去 revision と attempt の create Primary を引き継がない", () => {
    const comment: OfflineCommentUpdate = {
      ticketId: 41,
      commentId: 701,
      body: "Later body",
      revision: 3,
      attemptGeneration: 4,
      effects: [{
        effectId: "comment-create",
        kind: "comment_create",
        operationRevision: 2,
        attemptGeneration: 3,
        state: "committed",
        remoteId: 701,
        target: { ticketId: 41 },
      }],
    };

    const operation = toUnifiedOperationFromComment(comment, SCOPE);
    assert.strictEqual(operation.kind, "comment_update");
    assert.strictEqual(operation.createdRemoteId, undefined);
    assert.ok(operation.intent && "commentId" in operation.intent);

    const legacyCreate = toUnifiedOperationFromComment({ ticketId: 41, body: "New body" }, SCOPE);
    const legacyUpdate = toUnifiedOperationFromComment({ ticketId: 41, commentId: 701, body: "Existing body" }, SCOPE);
    assert.strictEqual(legacyCreate.kind, "comment_create");
    assert.strictEqual(legacyUpdate.kind, "comment_update");
  });

  test("作成中の後続編集は送信済み本文を基準に update へ昇格する", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const submittedBody = "![image](uploaded.png)";
    const nextBody = "![image](local.png)\nLater edit";
    await addOfflineCommentUpdateAsync({
      ticketId: 41,
      commentId: 701,
      body: "![image](local.png)",
      phase: "local_finalize_pending",
      revision: 1,
      finalizeDraft: true,
      effects: [{
        effectId: "comment-create",
        kind: "comment_create",
        operationRevision: 1,
        state: "committed",
        remoteId: 701,
        target: { ticketId: 41 },
        requestSnapshot: {
          kind: "comment_create",
          request: { ticketId: 41, notes: submittedBody },
        },
      }],
      nextIntent: { revision: 2, body: nextBody },
    }, SCOPE);

    assert.strictEqual(await completeOfflineCommentAsync({ ticketId: 41, commentId: 701 }, SCOPE, 1), true);
    const promoted = getOfflineSyncQueue(SCOPE).comments[0];
    assert.strictEqual(promoted.body, nextBody);
    assert.strictEqual(promoted.baseBody, submittedBody);
    assert.strictEqual(promoted.sourceNotesHash, computeNotesHash(submittedBody));
    assert.strictEqual(promoted.finalizeDraft, false);
    assert.strictEqual(toUnifiedOperationFromComment(promoted, SCOPE).kind, "comment_update");
  });

  test("初回と再起動後は pending を維持し、文書復帰後に再 POST せず完了する", async () => {
    const storage = createTestMemento();
    initializeOfflineSyncStore(storage, SCOPE);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-create-resume-"));
    const file = path.join(dir, "redmine-client-new-comment-41.md");
    const body = "Created body";
    fs.writeFileSync(file, body);
    const documentUri = vscode.Uri.file(file).toString();
    const key = { kind: "comment" as const, ticketId: 41, documentUri };
    let postCalls = 0;
    let updateCalls = 0;
    const comments = {
      addComment: async () => { postCalls++; },
      updateComment: async () => { updateCalls++; },
      getIssueDetail: async () => ({
        ticket: { id: 41, subject: "Ticket", projectId: 5 },
        comments: [{
          id: 701,
          body,
          authorId: 7,
          ticketId: 41,
          authorName: "User",
          editableByCurrentUser: true,
        }],
      }),
      getCurrentUserId: async () => 7,
      updateIssue: async () => undefined,
    };
    await addOfflineCommentUpdateAsync({
      ticketId: 41,
      body,
      documentUri,
      finalizeDraft: true,
    }, SCOPE);

    try {
      const first = await createSyncEngine({ comments }).syncOne(key, { connectionScope: SCOPE });
      assert.strictEqual(first.kind, "remote_committed");
      assert.strictEqual(first.kind === "remote_committed" && first.pending, "local_finalize");
      assert.strictEqual(first.ticketId, 41);
      assert.ok("commentId" in first);
      assert.strictEqual(first.commentId, 701);
      assert.strictEqual(getOfflineSyncQueue(SCOPE).comments[0].commentId, 701);

      initializeOfflineSyncStore(storage, SCOPE);
      const resumedEngine = createSyncEngine({ comments });
      const resumed = resumedEngine.getRepository().getOperation(key, SCOPE);
      assert.strictEqual(resumed?.kind, "comment_create");
      assert.strictEqual(resumed?.createdRemoteId, 701);
      assert.strictEqual(resumed?.projectId, 5);

      const second = await resumedEngine.syncOne(key, { connectionScope: SCOPE });
      assert.strictEqual(second.kind, "remote_committed");
      assert.strictEqual(second.kind === "remote_committed" && second.pending, "local_finalize");
      assert.strictEqual(second.ticketId, 41);
      assert.ok("commentId" in second);
      assert.strictEqual(second.commentId, 701);
      assert.strictEqual(getOfflineSyncQueue(SCOPE).comments[0].phase, "local_finalize_pending");
      assert.strictEqual(postCalls, 1);
      assert.strictEqual(updateCalls, 0);
      assert.strictEqual(fs.readFileSync(file, "utf8"), body);

      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await vscode.window.showTextDocument(document, { preview: false });
      const third = await resumedEngine.syncOne(key, { connectionScope: SCOPE });
      assert.strictEqual(third.kind, "completed");
      assert.strictEqual(third.ticketId, 41);
      assert.ok("commentId" in third);
      assert.strictEqual(third.commentId, 701);
      assert.strictEqual(postCalls, 1);
      assert.strictEqual(updateCalls, 0);
      assert.strictEqual(getOfflineSyncQueue(SCOPE).comments.length, 0);
      const finalized = parseCommentUpdateFile(fs.readFileSync(file, "utf8"));
      assert.strictEqual(finalized?.fields.journalId, 701);
      assert.strictEqual(finalized?.fields.projectId, 5);
      assert.strictEqual(finalized?.fields.sourceNotesHash, computeNotesHash(body));
      assert.strictEqual(finalized?.body, body);
    } finally {
      const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === documentUri);
      if (editor) {
        await vscode.window.showTextDocument(editor.document, { preview: false });
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
