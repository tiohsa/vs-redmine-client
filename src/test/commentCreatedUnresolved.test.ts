import * as assert from "assert";
import { syncNewCommentDraft, applyQueuedCommentUpdate } from "../views/commentSaveSync";

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
});
