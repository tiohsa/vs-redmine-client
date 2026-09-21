import * as assert from "assert";
import {
  clearCommentEdits,
  getCommentEdit,
  initializeCommentEdit,
  setCommentDraftBody,
} from "../views/commentEditStore";
import {
  reloadCommentEditor,
  saveCommentDocumentLocally,
  saveCommentDraftLocally,
  syncCommentDraft,
  syncNewCommentDraft,
} from "../views/commentSaveSync";
import { createEditorStub } from "./helpers/editorStubs";
import * as vscode from "vscode";
import { getOfflineSyncQueue, initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";
import { clearRegistry, registerTicketDocument } from "../views/ticketEditorRegistry";

suite("Comment save sync", () => {
  const scope = "https://comment-save.example.org/";

  setup(() => {
    initializeOfflineSyncStore(createTestMemento(), scope);
  });

  teardown(() => {
    clearCommentEdits();
    clearRegistry();
  });

  test("ローカルコメント保存時に画像解決用のbaseDirをキューへ保持する", async () => {
    const documentUri = vscode.Uri.file("/workspace/comments/comment.md");
    const editor = createEditorStub(documentUri, "![image](image-1.png)");
    registerTicketDocument(10, editor.document, "commentDraft", undefined, scope);

    const result = await saveCommentDraftLocally(editor, scope);

    assert.strictEqual(result?.status, "queued");
    assert.strictEqual(getOfflineSyncQueue(scope).comments[0]?.baseDir, "/workspace/comments");
  });

  test("ドキュメント経由のローカルコメント保存でもbaseDirを保持する", async () => {
    const documentUri = vscode.Uri.file("/workspace/comments/comment.md");

    await saveCommentDocumentLocally({
      operationScope: scope,
      ticketId: 11,
      content: "![image](image-1.png)",
      documentUri,
    });

    assert.strictEqual(getOfflineSyncQueue(scope).comments[0]?.baseDir, "/workspace/comments");
  });

  test("returns no_change when content matches base", async () => {
    initializeCommentEdit(1, 10, "Body");

    const result = await syncCommentDraft({
      commentId: 1,
      content: "Body",
      deps: {
        addComment: async () => {
          throw new Error("should not add");
        },
        updateComment: async () => {
          throw new Error("should not update");
        },
      },
    });

    assert.strictEqual(result.status, "no_change");
  });

  test("returns failed when comment is invalid", async () => {
    initializeCommentEdit(2, 10, "Body");

    const result = await syncCommentDraft({
      commentId: 2,
      content: "   ",
      deps: {
        addComment: async () => {
          throw new Error("should not add");
        },
        updateComment: async () => {
          throw new Error("should not update");
        },
      },
    });

    assert.strictEqual(result.status, "failed");
  });

  test("updates comment when changed", async () => {
    initializeCommentEdit(3, 10, "Body");

    let updated = false;
    const result = await syncCommentDraft({
      commentId: 3,
      content: "Next",
      deps: {
        addComment: async () => {
          throw new Error("should not add");
        },
        updateComment: async () => {
          updated = true;
        },
      },
    });

    assert.strictEqual(updated, true);
    assert.strictEqual(result.status, "success");
  });

  test("maps not found errors", async () => {
    initializeCommentEdit(4, 10, "Body");

    const result = await syncCommentDraft({
      commentId: 4,
      content: "Next",
      deps: {
        addComment: async () => {
          throw new Error("should not add");
        },
        updateComment: async () => {
          throw new Error("Redmine request failed (404): Not Found");
        },
      },
    });

    assert.strictEqual(result.status, "not_found");
  });

  test("creates comment when draft is valid", async () => {
    let added = false;
    const result = await syncNewCommentDraft({
      ticketId: 11,
      content: "New comment",
      deps: {
        addComment: async () => {
          added = true;
        },
        updateComment: async () => {
          throw new Error("should not update");
        },
        getCurrentUserId: async () => 9,
        getIssueDetail: async () => ({
          ticket: { id: 11, subject: "T", projectId: 4 },
          comments: [
            {
              id: 77,
              ticketId: 11,
              authorId: 9,
              authorName: "Tester",
              body: "New comment",
              createdAt: "t1",
              updatedAt: "t2",
              editableByCurrentUser: true,
            },
          ],
        }),
      },
    });

    assert.strictEqual(added, true);
    assert.strictEqual(result.status, "created");
    assert.strictEqual(result.commentId, 77);
    assert.strictEqual(result.projectId, 4);
  });

  test("reload replaces comment body with saved content", async () => {
    initializeCommentEdit(12, 20, "Saved");
    setCommentDraftBody(12, "Draft");
    const editor = createEditorStub(vscode.Uri.parse("untitled:comment-12.md"), "Draft");

    const result = await reloadCommentEditor({
      ticketId: 20,
      commentId: 12,
      editor,
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 20, subject: "T", projectId: 1 },
          comments: [
            {
              id: 12,
              ticketId: 20,
              authorId: 1,
              authorName: "Tester",
              body: "Reloaded",
              createdAt: "t1",
              updatedAt: "t2",
              editableByCurrentUser: true,
            },
          ],
        }),
        applyEditorContent: async () => undefined,
      },
    });

    assert.strictEqual(result.status, "success");
    const edit = getCommentEdit(12);
    assert.strictEqual(edit?.baseBody, "Reloaded");
    assert.strictEqual(edit?.draftBody, undefined);
  });

  test("reload keeps draft when comment is missing", async () => {
    initializeCommentEdit(13, 21, "Saved");
    setCommentDraftBody(13, "Draft");
    const editor = createEditorStub(vscode.Uri.parse("untitled:comment-13.md"), "Draft");

    const result = await reloadCommentEditor({
      ticketId: 21,
      commentId: 13,
      editor,
      deps: {
        getIssueDetail: async () => ({
          ticket: { id: 21, subject: "T", projectId: 1 },
          comments: [],
        }),
        applyEditorContent: async () => undefined,
      },
    });

    assert.strictEqual(result.status, "not_found");
    const edit = getCommentEdit(13);
    assert.strictEqual(edit?.draftBody, "Draft");
  });
});
