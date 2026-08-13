import * as assert from "assert";
import { promptForComment } from "../commands/commentPrompt";
import { validateComment, getCommentLimitGuidance } from "../utils/commentValidation";
import { createTempImage } from "./helpers/markdownImageTestUtils";
import { initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { createTestMemento } from "./helpers/vscodeMemento";
import { getCurrentConnectionScope } from "../config/connectionScope";

suite("Comment prompt command", () => {
  setup(() => initializeOfflineSyncStore(createTestMemento(), getCurrentConnectionScope()));
  test("uploads images and passes upload tokens", async () => {
    const temp = createTempImage();
    let calls = 0;
    let addedBody: string | undefined;
    let addedUploads: Array<{ token: string; filename: string; content_type: string }> | undefined;
    const errors: string[] = [];

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
        showError: (message) => { errors.push(message); },
        showInfo: () => undefined,
        getCommentDraft: () => "",
        setCommentDraft: () => undefined,
        clearCommentDraft: () => undefined,
        resolveBaseDir: () => temp.dir,
        commentSyncDeps: {
          updateComment: async () => undefined,
          updateIssue: async () => undefined,
          getCurrentUserId: async () => 1,
          getIssueDetail: async () => ({
            ticket: { id: 10, subject: "T", projectId: 1 },
            comments: [{
              id: 51,
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

    assert.strictEqual(addedBody, "![img](image.png)", errors.join(" | "));
    assert.deepStrictEqual(addedUploads, [
      { token: "token", filename: "image.png", content_type: "image/png" },
    ]);
  });
});
