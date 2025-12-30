import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { syncNewCommentDraft } from "../views/commentSaveSync";

const createTempImage = (): { dir: string; documentUri: vscode.Uri } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "todoex-mdimg-"));
  const filePath = path.join(dir, "image.png");
  fs.writeFileSync(filePath, Buffer.from([1, 2, 3]));
  return { dir, documentUri: vscode.Uri.file(path.join(dir, "comment.md")) };
};

suite("Comment markdown image upload", () => {
  test("uploads images for new comments and replaces links", async () => {
    const temp = createTempImage();
    let addedBody: string | undefined;
    let addedUploads: Array<{ token: string; filename: string; content_type: string }> | undefined;

    const result = await syncNewCommentDraft({
      ticketId: 10,
      content: "![img](./image.png)",
      documentUri: temp.documentUri,
      deps: {
        addComment: async (_ticketId, body, uploads) => {
          addedBody = body;
          addedUploads = uploads;
        },
        updateComment: async () => {
          throw new Error("should not update");
        },
        getCurrentUserId: async () => 9,
        getIssueDetail: async () => ({
          ticket: { id: 10, subject: "T", projectId: 4 },
          comments: [
            {
              id: 77,
              ticketId: 10,
              authorId: 9,
              authorName: "Tester",
              body: "![img](image.png)",
              createdAt: "t1",
              updatedAt: "t2",
              editableByCurrentUser: true,
            },
          ],
        }),
        uploadFile: async () => ({
          token: "token",
          filename: "image.png",
          contentType: "image/png",
        }),
      },
    });

    assert.strictEqual(result.status, "created");
    assert.strictEqual(addedBody, "![img](image.png)");
    assert.deepStrictEqual(addedUploads, [
      { token: "token", filename: "image.png", content_type: "image/png" },
    ]);
  });
});
