import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { syncNewCommentDraft, applyQueuedCommentUpdate } from "../views/commentSaveSync";
import {
  addOfflineCommentUpdate,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { createSyncEngine } from "../app/syncEngine";
import { computeNotesHash } from "../utils/notesHash";
import { parseCommentUpdateFile } from "../views/commentUpdateFile";
import { createTestMemento } from "./helpers/vscodeMemento";

const SCOPE = "https://comments.example/";

suite("Comment created_unresolved", () => {
  // ── syncNewCommentDraft ───────────────────────────────────────────────────

  test("コメント投稿後に getIssueDetail が失敗すると created_unresolved になる", async () => {
    const result = await syncNewCommentDraft({
      ticketId: 10,
      content: "New comment body",
      deps: {
        addComment: async () => undefined,
        updateComment: async () => {
          throw new Error("should not update");
        },
        updateIssue: async () => undefined,
        getIssueDetail: async () => {
          throw new Error("Redmine request failed (500): Internal Server Error");
        },
        getCurrentUserId: async () => 1,
        uploadFile: async () => ({ token: "t", filename: "f", contentType: "image/png" }),
      },
    });
    assert.strictEqual(result.status, "created_unresolved");
  });

  test("コメント投稿後にコメント ID が見つからない場合 created_unresolved になる", async () => {
    const result = await syncNewCommentDraft({
      ticketId: 10,
      content: "New comment body",
      deps: {
        addComment: async () => undefined,
        updateComment: async () => {
          throw new Error("should not update");
        },
        updateIssue: async () => undefined,
        // コメントが空リスト → ID 解決不可
        getIssueDetail: async () => ({
          ticket: { id: 10, subject: "T", projectId: 1 },
          comments: [],
        }),
        getCurrentUserId: async () => 1,
        uploadFile: async () => ({ token: "t", filename: "f", contentType: "image/png" }),
      },
    });
    assert.strictEqual(result.status, "created_unresolved");
  });

  test("コメント投稿後に自分以外のコメントしかない場合 created_unresolved になる", async () => {
    const result = await syncNewCommentDraft({
      ticketId: 10,
      content: "New comment body",
      deps: {
        addComment: async () => undefined,
        updateComment: async () => {
          throw new Error("should not update");
        },
        updateIssue: async () => undefined,
        getIssueDetail: async () => ({
          ticket: { id: 10, subject: "T", projectId: 1 },
          // authorId が一致しない
          comments: [{ id: 100, body: "New comment body", authorId: 99, ticketId: 10, authorName: "Other", editableByCurrentUser: false }],
        }),
        getCurrentUserId: async () => 1,
        uploadFile: async () => ({ token: "t", filename: "f", contentType: "image/png" }),
      },
    });
    assert.strictEqual(result.status, "created_unresolved");
  });

  test("コメント投稿後に正常に ID が解決されると created を返す", async () => {
    const result = await syncNewCommentDraft({
      ticketId: 10,
      content: "New comment body",
      deps: {
        addComment: async () => undefined,
        updateComment: async () => {
          throw new Error("should not update");
        },
        updateIssue: async () => undefined,
        getIssueDetail: async () => ({
          ticket: { id: 10, subject: "T", projectId: 1 },
          comments: [{ id: 100, body: "New comment body", authorId: 1, ticketId: 10, authorName: "User", editableByCurrentUser: true }],
        }),
        getCurrentUserId: async () => 1,
        uploadFile: async () => ({ token: "t", filename: "f", contentType: "image/png" }),
      },
    });
    assert.strictEqual(result.status, "created");
    assert.strictEqual(result.commentId, 100);
  });

  // ── applyQueuedCommentUpdate (新規コメント) ────────────────────────────────

  test("キュー内の新規コメントで getIssueDetail が失敗すると created_unresolved になる", async () => {
    const result = await applyQueuedCommentUpdate({
      // commentId なし → 新規コメント
      update: { ticketId: 10, body: "Queued new comment" },
      deps: {
        addComment: async () => undefined,
        updateComment: async () => {
          throw new Error("should not update");
        },
        getIssueDetail: async () => {
          throw new Error("Redmine request failed (500): Internal Server Error");
        },
        getCurrentUserId: async () => 1,
        updateIssue: async () => undefined,
      },
    });
    assert.strictEqual(result.status, "created_unresolved");
  });

  test("キュー内の新規コメントで ID が解決されると created を返す", async () => {
    const result = await applyQueuedCommentUpdate({
      update: { ticketId: 10, body: "Queued new comment" },
      deps: {
        addComment: async () => undefined,
        updateComment: async () => {
          throw new Error("should not update");
        },
        getIssueDetail: async () => ({
          ticket: { id: 10, subject: "T", projectId: 1 },
          comments: [
            { id: 200, body: "Queued new comment", authorId: 1, ticketId: 10, authorName: "User", editableByCurrentUser: true },
          ],
        }),
        getCurrentUserId: async () => 1,
        updateIssue: async () => undefined,
      },
    });
    assert.strictEqual(result.status, "created");
    assert.strictEqual(result.commentId, 200);
  });

  test("I-11 POST成功後の created_unresolved は queue を保持し retry は reconciliation のみ行う", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const documentUri = "file:///tmp/comment-unresolved.md";
    addOfflineCommentUpdate({ ticketId: 10, body: "Queued new comment", documentUri }, SCOPE);
    let addCalls = 0;
    let getCalls = 0;
    const engine = createSyncEngine({
      comments: {
        addComment: async () => { addCalls++; },
        updateComment: async () => { throw new Error("should not update"); },
        getIssueDetail: async () => {
          getCalls++;
          if (getCalls === 1) { throw new Error("read-back failed"); }
          return {
            ticket: { id: 10, subject: "T", projectId: 1 },
            comments: [{
              id: 200,
              body: "Queued new comment",
              authorId: 1,
              ticketId: 10,
              authorName: "User",
              editableByCurrentUser: true,
            }],
          };
        },
        getCurrentUserId: async () => 1,
        updateIssue: async () => undefined,
      },
    });
    const key = { kind: "comment" as const, ticketId: 10, documentUri };

    const first = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.strictEqual(first.kind, "remote_committed");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).comments.length, 1);

    const second = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.strictEqual(second.kind, "completed");
    assert.strictEqual(addCalls, 1);
    assert.strictEqual(getCalls, 2);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).comments.length, 0);
  });

  test("comment POST timeout は commit_unknown となり通常 retry で再POSTしない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const documentUri = "file:///tmp/comment-timeout.md";
    addOfflineCommentUpdate({ ticketId: 11, body: "Maybe committed", documentUri }, SCOPE);
    let addCalls = 0;
    const engine = createSyncEngine({
      comments: {
        addComment: async () => {
          addCalls++;
          throw new Error("transport timeout");
        },
        updateComment: async () => { throw new Error("should not update"); },
        getIssueDetail: async () => { throw new Error("should not reconcile"); },
        getCurrentUserId: async () => 1,
        updateIssue: async () => undefined,
      },
    });
    const key = { kind: "comment" as const, ticketId: 11, documentUri };

    const first = await engine.syncOne(key, { connectionScope: SCOPE });
    const second = await engine.syncOne(key, { connectionScope: SCOPE });

    assert.strictEqual(first.kind, "commit_unknown");
    assert.strictEqual(second.kind, "commit_unknown");
    assert.strictEqual(addCalls, 1);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).comments[0].phase, "commit_unknown");
  });

  test("comment POST timeout は明示的GET reconciliationで一意な自分のjournalだけをlinkする", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const documentUri = "file:///tmp/comment-timeout-reconcile.md";
    addOfflineCommentUpdate({ ticketId: 13, body: "Maybe committed", documentUri }, SCOPE);
    let addCalls = 0;
    const engine = createSyncEngine({
      comments: {
        addComment: async () => {
          addCalls++;
          throw new Error("transport timeout");
        },
        updateComment: async () => { throw new Error("should not update"); },
        getIssueDetail: async () => ({
          ticket: { id: 13, subject: "T", projectId: 3 },
          comments: [{
            id: 301,
            body: "Maybe committed",
            authorId: 7,
            ticketId: 13,
            authorName: "User",
            editableByCurrentUser: true,
          }],
        }),
        getCurrentUserId: async () => 7,
        updateIssue: async () => undefined,
      },
    });
    const key = { kind: "comment" as const, ticketId: 13, documentUri };

    assert.strictEqual((await engine.syncOne(key, { connectionScope: SCOPE })).kind, "commit_unknown");
    const reconciled = await engine.resolveCommentCommitUnknown({
      key,
      context: { connectionScope: SCOPE },
    });

    assert.strictEqual(reconciled.kind, "completed");
    assert.strictEqual(
      reconciled.kind === "completed" && "commentId" in reconciled
        ? reconciled.commentId
        : undefined,
      301,
    );
    assert.strictEqual(addCalls, 1);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).comments.length, 0);
  });

  test("comment commit_unknown reconciliation は同一body候補が複数なら自動linkしない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const documentUri = "file:///tmp/comment-timeout-ambiguous.md";
    addOfflineCommentUpdate({ ticketId: 14, body: "Duplicate", documentUri }, SCOPE);
    const engine = createSyncEngine({
      comments: {
        addComment: async () => { throw new Error("transport timeout"); },
        updateComment: async () => { throw new Error("should not update"); },
        getIssueDetail: async () => ({
          ticket: { id: 14, subject: "T", projectId: 3 },
          comments: [401, 402].map((id) => ({
            id,
            body: "Duplicate",
            authorId: 7,
            ticketId: 14,
            authorName: "User",
            editableByCurrentUser: true,
          })),
        }),
        getCurrentUserId: async () => 7,
        updateIssue: async () => undefined,
      },
    });
    const key = { kind: "comment" as const, ticketId: 14, documentUri };

    await engine.syncOne(key, { connectionScope: SCOPE });
    const reconciled = await engine.resolveCommentCommitUnknown({
      key,
      context: { connectionScope: SCOPE },
    });

    assert.strictEqual(reconciled.kind, "commit_unknown");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).comments[0].phase, "commit_unknown");
  });

  test("ambiguous comment commit_unknown は指定journal IDをbody/author照合してlinkできる", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const documentUri = "file:///tmp/comment-timeout-manual-link.md";
    addOfflineCommentUpdate({ ticketId: 19, body: "Duplicate", documentUri }, SCOPE);
    const engine = createSyncEngine({
      comments: {
        addComment: async () => { throw new Error("transport timeout"); },
        updateComment: async () => { throw new Error("should not update"); },
        getIssueDetail: async () => ({
          ticket: { id: 19, subject: "T", projectId: 3 },
          comments: [901, 902].map((id) => ({
            id,
            body: "Duplicate",
            authorId: 7,
            ticketId: 19,
            authorName: "User",
            editableByCurrentUser: true,
          })),
        }),
        getCurrentUserId: async () => 7,
        updateIssue: async () => undefined,
      },
    });
    const key = { kind: "comment" as const, ticketId: 19, documentUri };

    await engine.syncOne(key, { connectionScope: SCOPE });
    const linked = await engine.resolveCommentCommitUnknown({
      key,
      context: { connectionScope: SCOPE },
      resolution: { kind: "link_remote_comment", commentId: 902 },
    });

    assert.strictEqual(linked.kind, "completed");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).comments.length, 0);
  });

  test("comment PUT timeout は明示的GET reconciliationでjournal IDとbodyを照合する", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    addOfflineCommentUpdate({
      ticketId: 15,
      commentId: 501,
      baseBody: "Before",
      body: "After",
    }, SCOPE);
    let updateCalls = 0;
    const engine = createSyncEngine({
      comments: {
        addComment: async () => { throw new Error("should not add"); },
        updateComment: async () => {
          updateCalls++;
          throw new Error("transport timeout");
        },
        getIssueDetail: async () => ({
          ticket: { id: 15, subject: "T", projectId: 4 },
          comments: [{
            id: 501,
            body: "After",
            authorId: 7,
            ticketId: 15,
            authorName: "User",
            editableByCurrentUser: true,
          }],
        }),
        getCurrentUserId: async () => 7,
        updateIssue: async () => undefined,
      },
    });
    const key = { kind: "comment" as const, ticketId: 15, commentId: 501 };

    assert.strictEqual((await engine.syncOne(key, { connectionScope: SCOPE })).kind, "commit_unknown");
    const reconciled = await engine.resolveCommentCommitUnknown({
      key,
      context: { connectionScope: SCOPE },
    });

    assert.strictEqual(reconciled.kind, "completed");
    assert.strictEqual(updateCalls, 1);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).comments.length, 0);
  });

  test("I-20 comment PUT後にrequired local finalize不可ならqueueをcompletedにしない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const documentUri = "file:///tmp/closed-comment-update.md";
    addOfflineCommentUpdate({
      ticketId: 16,
      commentId: 601,
      body: "After",
      sourceNotesHash: computeNotesHash("Before"),
      documentUri,
    }, SCOPE);
    const engine = createSyncEngine({
      comments: {
        addComment: async () => { throw new Error("should not add"); },
        updateComment: async () => undefined,
        getIssueDetail: async () => ({
          ticket: { id: 16, subject: "T", projectId: 4 },
          comments: [{
            id: 601,
            body: "Before",
            authorId: 7,
            ticketId: 16,
            authorName: "User",
            editableByCurrentUser: true,
          }],
        }),
        getCurrentUserId: async () => 7,
        updateIssue: async () => undefined,
      },
    });

    const outcome = await engine.syncOne(
      { kind: "comment", ticketId: 16, commentId: 601, documentUri },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(outcome.kind, "remote_committed");
    assert.strictEqual(outcome.kind === "remote_committed" && outcome.pending, "local_finalize");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).comments[0].phase, "local_finalize_pending");
  });

  test("I-20 new comment draft はidentity frontmatter未保存ならqueueをcompletedにしない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const documentUri = "file:///tmp/closed-new-comment-draft.md";
    addOfflineCommentUpdate({
      ticketId: 17,
      body: "Created body",
      documentUri,
      finalizeDraft: true,
    }, SCOPE);
    const engine = createSyncEngine({
      comments: {
        addComment: async () => undefined,
        updateComment: async () => { throw new Error("should not update"); },
        getIssueDetail: async () => ({
          ticket: { id: 17, subject: "T", projectId: 5 },
          comments: [{
            id: 701,
            body: "Created body",
            authorId: 7,
            ticketId: 17,
            authorName: "User",
            editableByCurrentUser: true,
          }],
        }),
        getCurrentUserId: async () => 7,
        updateIssue: async () => undefined,
      },
    });

    const outcome = await engine.syncOne(
      { kind: "comment", ticketId: 17, documentUri },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(outcome.kind, "remote_committed");
    assert.strictEqual(outcome.kind === "remote_committed" && outcome.pending, "local_finalize");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).comments[0].phase, "local_finalize_pending");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).comments[0].commentId, 701);
  });

  test("I-06/I-07/I-08 new comment finalize は後続編集を保持してnext updateへ昇格する", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-create-race-"));
    const file = path.join(dir, "redmine-client-new-comment-18.md");
    fs.writeFileSync(file, "Active body");
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const documentUri = document.uri.toString();
    addOfflineCommentUpdate({
      ticketId: 18,
      body: "Active body",
      documentUri,
      finalizeDraft: true,
    }, SCOPE);
    let releaseGet!: () => void;
    let markGetStarted!: () => void;
    const getStarted = new Promise<void>((resolve) => { markGetStarted = resolve; });
    const getBlocked = new Promise<void>((resolve) => { releaseGet = resolve; });
    const engine = createSyncEngine({
      comments: {
        addComment: async () => undefined,
        updateComment: async () => { throw new Error("should not update active create"); },
        getIssueDetail: async () => {
          markGetStarted();
          await getBlocked;
          return {
            ticket: { id: 18, subject: "T", projectId: 6 },
            comments: [{
              id: 801,
              body: "Active body",
              authorId: 7,
              ticketId: 18,
              authorName: "User",
              editableByCurrentUser: true,
            }],
          };
        },
        getCurrentUserId: async () => 7,
        updateIssue: async () => undefined,
      },
    });

    const flight = engine.syncOne(
      { kind: "comment", ticketId: 18, documentUri },
      { connectionScope: SCOPE },
    );
    await getStarted;
    await editor.edit((builder) => builder.replace(
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      "Later body",
    ));
    addOfflineCommentUpdate({
      ticketId: 18,
      body: "Later body",
      documentUri,
      finalizeDraft: true,
    }, SCOPE);
    releaseGet();

    const outcome = await flight;
    assert.strictEqual(outcome.kind, "completed");
    const parsed = parseCommentUpdateFile(document.getText());
    assert.strictEqual(parsed?.body, "Later body");
    assert.strictEqual(parsed?.fields.sourceNotesHash, computeNotesHash("Active body"));
    const promoted = getOfflineSyncQueue(SCOPE).comments[0];
    assert.strictEqual(promoted.phase, "queued");
    assert.strictEqual(promoted.body, "Later body");
    assert.strictEqual(promoted.sourceNotesHash, computeNotesHash("Active body"));
    assert.strictEqual(promoted.finalizeDraft, false);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  test("同一 comment operation の並行同期は single-flight で POST を1回にする", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const documentUri = "file:///tmp/comment-single-flight.md";
    addOfflineCommentUpdate({ ticketId: 12, body: "Once", documentUri }, SCOPE);
    let releasePost!: () => void;
    const postBlocked = new Promise<void>((resolve) => { releasePost = resolve; });
    let addCalls = 0;
    const engine = createSyncEngine({
      comments: {
        addComment: async () => { addCalls++; await postBlocked; },
        updateComment: async () => { throw new Error("should not update"); },
        getIssueDetail: async () => ({
          ticket: { id: 12, subject: "T", projectId: 1 },
          comments: [{
            id: 201,
            body: "Once",
            authorId: 1,
            ticketId: 12,
            authorName: "User",
            editableByCurrentUser: true,
          }],
        }),
        getCurrentUserId: async () => 1,
        updateIssue: async () => undefined,
      },
    });
    const key = { kind: "comment" as const, ticketId: 12, documentUri };

    const first = engine.syncOne(key, { connectionScope: SCOPE });
    const second = engine.syncOne(key, { connectionScope: SCOPE });
    releasePost();
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    assert.strictEqual(firstOutcome.kind, "completed");
    assert.strictEqual(secondOutcome.kind, "completed");
    assert.strictEqual(addCalls, 1);
  });
});
