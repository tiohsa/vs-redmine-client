import * as assert from "assert";
import { promptForComment } from "../commands/commentPrompt";
import { validateComment, getCommentLimitGuidance } from "../utils/commentValidation";
import { createTempImage } from "./helpers/markdownImageTestUtils";

suite("Comment prompt command", () => {
  test("uploads images and passes upload tokens", async () => {
    const temp = createTempImage();
    let calls = 0;
    let addedBody: string | undefined;
    let addedUploads: Array<{ token: string; filename: string; content_type: string }> | undefined;

    await promptForComment(
      { issueId: 10 },
      {
        showInputBox: async () => {
          calls += 1;
          return calls === 1 ? "![img](./image.png)" : undefined;
        },
        addComment: async (_issueId, body, uploads) => {
          addedBody = body;
          addedUploads = uploads;
        },
        uploadFile: async () => ({
          token: "token",
          filename: "image.png",
          contentType: "image/png",
        }),
        validateComment,
        getCommentLimitGuidance,
        showError: () => undefined,
        showInfo: () => undefined,
        getCommentDraft: () => "",
        setCommentDraft: () => undefined,
        clearCommentDraft: () => undefined,
        resolveBaseDir: () => temp.dir,
      },
    );

    assert.strictEqual(addedBody, "![img](image.png)");
    assert.deepStrictEqual(addedUploads, [
      { token: "token", filename: "image.png", content_type: "image/png" },
    ]);
  });
});
