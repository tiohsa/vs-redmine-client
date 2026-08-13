import * as assert from "assert";
import * as vscode from "vscode";
import { editComment } from "../commands/editComment";
import { validateComment, getCommentLimitGuidance } from "../utils/commentValidation";
import { createTempImage } from "./helpers/markdownImageTestUtils";
import { initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";

suite("Edit comment command", () => {
  setup(() => initializeOfflineSyncStore(createTestMemento()));
  test("uploads images and passes upload tokens", async () => {
    const temp = createTempImage();
    const editor = {
      document: {
        uri: temp.documentUri,
        getText: () => "![img](./image.png)",
      },
    } as unknown as vscode.TextEditor;

    let updatedBody: string | undefined;
    let updatedUploads: Array<{ token: string; filename: string; content_type: string }> | undefined;

    await editComment(
      {
        id: 5,
        ticketId: 10,
        authorId: 1,
        authorName: "User",
        body: "Old",
        createdAt: "t1",
        updatedAt: "t2",
        editableByCurrentUser: true,
      },
      {
        getActiveEditor: () => editor,
        updateComment: async (_commentId, body, uploads) => {
          updatedBody = body;
          updatedUploads = uploads;
        },
        uploadFile: async () => ({
          token: "token",
          filename: "image.png",
          contentType: "image/png",
        }),
        showError: () => undefined,
        showInfo: () => undefined,
        validateComment,
        getCommentLimitGuidance,
        setCommentDraft: () => undefined,
        clearCommentDraft: () => undefined,
        getTicketIdForEditor: () => 10,
        getEditorContentType: () => "comment",
        commentSyncDeps: {
          addComment: async () => undefined,
          updateIssue: async () => undefined,
          getCurrentUserId: async () => 1,
          getIssueDetail: async () => ({
            ticket: { id: 10, subject: "T", projectId: 1 },
            comments: [{
              id: 5,
              ticketId: 10,
              authorId: 1,
              authorName: "User",
              body: "Old",
              updatedAt: "t2",
              editableByCurrentUser: true,
            }],
          }),
        },
      },
    );

    assert.strictEqual(updatedBody, "![img](image.png)");
    assert.deepStrictEqual(updatedUploads, [
      { token: "token", filename: "image.png", content_type: "image/png" },
    ]);
  });
});
