import * as assert from "assert";
import * as vscode from "vscode";
import { addCommentForIssue } from "../commands/addComment";
import { validateComment, getCommentLimitGuidance } from "../utils/commentValidation";
import { createTempImage } from "./helpers/markdownImageTestUtils";

suite("Add comment command", () => {
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
      },
    );

    assert.strictEqual(addedBody, "![img](image.png)");
    assert.deepStrictEqual(addedUploads, [
      { token: "token", filename: "image.png", content_type: "image/png" },
    ]);
  });
});
