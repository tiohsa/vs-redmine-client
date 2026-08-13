import * as assert from "assert";
import * as vscode from "vscode";
import { addCommentForIssue } from "../commands/addComment";
import { validateComment, getCommentLimitGuidance } from "../utils/commentValidation";
import { createTempImage } from "./helpers/markdownImageTestUtils";
import { initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";

suite("Add comment command", () => {
  setup(() => initializeOfflineSyncStore(createTestMemento()));
  test("uploads images and passes upload tokens", async () => {
    const temp = createTempImage();
    const editor = {
      document: {
        uri: temp.documentUri,
        getText: () => "![img](./image.png)",
      },
    } as unknown as vscode.TextEditor;

    let addedBody: string | undefined;
    let addedUploads: Array<{ token: string; filename: string; content_type: string }> | undefined;

    await addCommentForIssue(
      { issueId: 10 },
      {
        getActiveEditor: () => editor,
        addComment: async (_issueId, body, uploads) => {
          addedBody = body;
          addedUploads = uploads;
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
          updateComment: async () => undefined,
          updateIssue: async () => undefined,
          getCurrentUserId: async () => 1,
          getIssueDetail: async () => ({
            ticket: { id: 10, subject: "T", projectId: 1 },
            comments: [{
              id: 50,
              ticketId: 10,
              authorId: 1,
              authorName: "User",
              body: "![img](image.png)",
              editableByCurrentUser: true,
            }],
          }),
        },
      },
    );

    assert.strictEqual(addedBody, "![img](image.png)");
    assert.deepStrictEqual(addedUploads, [
      { token: "token", filename: "image.png", content_type: "image/png" },
    ]);
  });
});
