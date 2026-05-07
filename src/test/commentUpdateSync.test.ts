import * as assert from "assert";
import { applyQueuedCommentUpdate } from "../views/commentSaveSync";
import { computeNotesHash } from "../utils/notesHash";
import { Comment } from "../redmine/types";
import type { CommentSaveDependencies } from "../views/commentSaveSync";

const makeComment = (id: number, body: string): Comment => ({
  id,
  ticketId: 10,
  authorId: 1,
  authorName: "Test",
  body,
  editableByCurrentUser: true,
});

const makeDetailResponse = (comments: Comment[]) => ({
  ticket: {
    id: 10,
    subject: "Test",
    projectId: 1,
    description: "",
    statusName: "",
    priorityName: "",
    trackerName: "",
  },
  comments,
});

suite("commentUpdateSync – hash-based conflict detection", () => {
  test("sourceNotesHash 一致 → 同期成功", async () => {
    const originalBody = "original notes";
    const hash = computeNotesHash(originalBody);
    let updated = false;

    const result = await applyQueuedCommentUpdate({
      update: {
        ticketId: 10,
        commentId: 123,
        body: "updated notes",
        sourceNotesHash: hash,
      },
      deps: {
        getIssueDetail: async () =>
          makeDetailResponse([makeComment(123, originalBody)]) as any,
        updateComment: async () => { updated = true; },
        addComment: async () => { throw new Error("should not add"); },
        updateIssue: async () => { throw new Error("should not update issue"); },
        getCurrentUserId: async () => 1,
        uploadFile: async () => { throw new Error("should not upload"); },
      } as CommentSaveDependencies,
    });

    assert.ok(updated, "updateComment が呼ばれること");
    assert.strictEqual(result.status, "success");
  });

  test("sourceNotesHash 不一致 → conflict", async () => {
    const originalBody = "original notes";
    const hash = computeNotesHash(originalBody);
    const remoteBody = "someone else changed this";

    const result = await applyQueuedCommentUpdate({
      update: {
        ticketId: 10,
        commentId: 123,
        body: "my edit",
        sourceNotesHash: hash,
      },
      deps: {
        getIssueDetail: async () =>
          makeDetailResponse([makeComment(123, remoteBody)]) as any,
        updateComment: async () => { throw new Error("should not update"); },
        addComment: async () => { throw new Error("should not add"); },
        updateIssue: async () => { throw new Error("should not update issue"); },
        getCurrentUserId: async () => 1,
        uploadFile: async () => { throw new Error("should not upload"); },
      } as CommentSaveDependencies,
    });

    assert.strictEqual(result.status, "conflict");
  });

  test("journal が存在しない → not_found", async () => {
    const hash = computeNotesHash("original");

    const result = await applyQueuedCommentUpdate({
      update: {
        ticketId: 10,
        commentId: 999,
        body: "edit",
        sourceNotesHash: hash,
      },
      deps: {
        getIssueDetail: async () => makeDetailResponse([]) as any,
        updateComment: async () => { throw new Error("should not update"); },
        addComment: async () => { throw new Error("should not add"); },
        updateIssue: async () => { throw new Error("should not update issue"); },
        getCurrentUserId: async () => 1,
        uploadFile: async () => { throw new Error("should not upload"); },
      } as CommentSaveDependencies,
    });

    assert.strictEqual(result.status, "not_found");
  });

  test("sourceNotesHash なし → 従来の updatedAt ベース競合検知を使用", async () => {
    let updated = false;

    const result = await applyQueuedCommentUpdate({
      update: {
        ticketId: 10,
        commentId: 123,
        body: "updated",
        lastKnownRemoteUpdatedAt: "2026-01-01T00:00:00Z",
      },
      deps: {
        getIssueDetail: async () =>
          makeDetailResponse([
            { ...makeComment(123, "original"), updatedAt: "2026-01-01T00:00:00Z" },
          ]) as any,
        updateComment: async () => { updated = true; },
        addComment: async () => { throw new Error("should not add"); },
        updateIssue: async () => { throw new Error("should not update issue"); },
        getCurrentUserId: async () => 1,
        uploadFile: async () => { throw new Error("should not upload"); },
      } as CommentSaveDependencies,
    });

    assert.ok(updated, "updateComment が呼ばれること");
    assert.strictEqual(result.status, "success");
  });

  test("PUT 405 → API非対応エラーメッセージを返す", async () => {
    const hash = computeNotesHash("original");

    const result = await applyQueuedCommentUpdate({
      update: {
        ticketId: 10,
        commentId: 123,
        body: "edited",
        sourceNotesHash: hash,
      },
      deps: {
        getIssueDetail: async () =>
          makeDetailResponse([makeComment(123, "original")]) as any,
        updateComment: async () => { throw new Error("Method Not Allowed (405)"); },
        addComment: async () => { throw new Error("should not add"); },
        updateIssue: async () => { throw new Error("should not update issue"); },
        getCurrentUserId: async () => 1,
        uploadFile: async () => { throw new Error("should not upload"); },
      } as CommentSaveDependencies,
    });

    assert.strictEqual(result.status, "failed");
    assert.ok(result.message.includes("Webview") || result.message.includes("web interface"), `メッセージ: ${result.message}`);
  });

  test("PUT 403 → 権限エラーメッセージを返す", async () => {
    const hash = computeNotesHash("original");

    const result = await applyQueuedCommentUpdate({
      update: {
        ticketId: 10,
        commentId: 123,
        body: "edited",
        sourceNotesHash: hash,
      },
      deps: {
        getIssueDetail: async () =>
          makeDetailResponse([makeComment(123, "original")]) as any,
        updateComment: async () => { throw new Error("Forbidden (403)"); },
        addComment: async () => { throw new Error("should not add"); },
        updateIssue: async () => { throw new Error("should not update issue"); },
        getCurrentUserId: async () => 1,
        uploadFile: async () => { throw new Error("should not upload"); },
      } as CommentSaveDependencies,
    });

    assert.strictEqual(result.status, "forbidden");
    assert.ok(result.message.includes("permission"), `メッセージ: ${result.message}`);
  });

  test("PUT 404 → コメント不存在エラーメッセージを返す", async () => {
    const hash = computeNotesHash("original");

    const result = await applyQueuedCommentUpdate({
      update: {
        ticketId: 10,
        commentId: 123,
        body: "edited",
        sourceNotesHash: hash,
      },
      deps: {
        getIssueDetail: async () =>
          makeDetailResponse([makeComment(123, "original")]) as any,
        updateComment: async () => { throw new Error("Not Found (404)"); },
        addComment: async () => { throw new Error("should not add"); },
        updateIssue: async () => { throw new Error("should not update issue"); },
        getCurrentUserId: async () => 1,
        uploadFile: async () => { throw new Error("should not upload"); },
      } as CommentSaveDependencies,
    });

    assert.strictEqual(result.status, "not_found");
    assert.ok(result.message.includes("not found") || result.message.includes("deleted"), `メッセージ: ${result.message}`);
  });

  test("405 は成功扱いにしない", async () => {
    const hash = computeNotesHash("original");

    const result = await applyQueuedCommentUpdate({
      update: {
        ticketId: 10,
        commentId: 123,
        body: "edited",
        sourceNotesHash: hash,
      },
      deps: {
        getIssueDetail: async () =>
          makeDetailResponse([makeComment(123, "original")]) as any,
        updateComment: async () => { throw new Error("Method Not Allowed (405)"); },
        addComment: async () => { throw new Error("should not add"); },
        updateIssue: async () => { throw new Error("should not update issue"); },
        getCurrentUserId: async () => 1,
        uploadFile: async () => { throw new Error("should not upload"); },
      } as CommentSaveDependencies,
    });

    assert.notStrictEqual(result.status, "success", "405 を success 扱いしてはならない");
  });

  test("comment-update 同期で addComment (PUT /issues) を呼ばない", async () => {
    const hash = computeNotesHash("original");
    let addCommentCalled = false;

    await applyQueuedCommentUpdate({
      update: {
        ticketId: 10,
        commentId: 123,
        body: "edited",
        sourceNotesHash: hash,
      },
      deps: {
        getIssueDetail: async () =>
          makeDetailResponse([makeComment(123, "original")]) as any,
        updateComment: async () => { /* success */ },
        addComment: async () => { addCommentCalled = true; },
        updateIssue: async () => { throw new Error("should not update issue"); },
        getCurrentUserId: async () => 1,
        uploadFile: async () => { throw new Error("should not upload"); },
      } as CommentSaveDependencies,
    });

    assert.strictEqual(addCommentCalled, false, "PUT /issues/:id.json の addComment を呼んではならない");
  });
});
