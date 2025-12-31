import * as assert from "assert";
import { syncCommentDraft, syncNewCommentDraft } from "../views/commentSaveSync";
import { initializeCommentEdit } from "../views/commentEditStore";
import { createTempImage } from "./helpers/markdownImageTestUtils";

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

  test("fails new comment save when image upload fails", async () => {
    const temp = createTempImage();
    let addCalled = false;

    const result = await syncNewCommentDraft({
      ticketId: 10,
      content: "![img](./image.png)",
      documentUri: temp.documentUri,
      deps: {
        addComment: async () => {
          addCalled = true;
        },
        updateComment: async () => {
          throw new Error("should not update");
        },
        getCurrentUserId: async () => 9,
        getIssueDetail: async () => ({
          ticket: { id: 10, subject: "T", projectId: 4 },
          comments: [],
        }),
        uploadFile: async () => {
          throw new Error("Upload failed.");
        },
      },
    });

    assert.strictEqual(result.status, "failed");
    assert.strictEqual(addCalled, false);
  });

  test("uploads images for comment edits", async () => {
    const temp = createTempImage();
    initializeCommentEdit(101, 10, "Old", "2024-01-01T00:00:00Z");
    let updatedUploads:
      | Array<{ token: string; filename: string; content_type: string }>
      | undefined;

    const result = await syncCommentDraft({
      commentId: 101,
      content: "![img](./image.png)",
      documentUri: temp.documentUri,
      deps: {
        addComment: async () => {
          throw new Error("should not add");
        },
        updateComment: async (_commentId, _body) => {
          // updateComment doesn't handle uploads in this flow
        },
        updateIssue: async (params) => {
          if (params.fields?.uploads) {
            updatedUploads = params.fields.uploads;
          }
        },
        getCurrentUserId: async () => 9,
        getIssueDetail: async () => ({
          ticket: { id: 10, subject: "T", projectId: 4 },
          comments: [],
        }),
        uploadFile: async () => ({
          token: "token",
          filename: "image.png",
          contentType: "image/png",
        }),
      },
    });

    if (result.status !== "success") {
      console.error("Test failed: " + result.message);
      if (result.conflictContext) {
        console.error("Conflict context: ", result.conflictContext);
      }
    }
    assert.strictEqual(result.status, "success", result.message);
    assert.deepStrictEqual(updatedUploads, [
      { token: "token", filename: "image.png", content_type: "image/png" },
    ]);
  });

  test("skips uploads when no image links are present", async () => {
    const temp = createTempImage();
    let uploadCalled = false;
    let addUploads:
      | Array<{ token: string; filename: string; content_type: string }>
      | undefined;

    const result = await syncNewCommentDraft({
      ticketId: 10,
      content: "No images here.",
      documentUri: temp.documentUri,
      deps: {
        addComment: async (_ticketId, _body, uploads) => {
          addUploads = uploads;
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
              body: "No images here.",
              createdAt: "t1",
              updatedAt: "t2",
              editableByCurrentUser: true,
            },
          ],
        }),
        uploadFile: async () => {
          uploadCalled = true;
          return { token: "token", filename: "image.png", contentType: "image/png" };
        },
      },
    });

    assert.strictEqual(result.status, "created");
    assert.strictEqual(uploadCalled, false);
    assert.strictEqual(addUploads, undefined);
  });
});
