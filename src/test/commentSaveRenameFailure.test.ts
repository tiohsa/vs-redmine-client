import * as assert from "assert";
import { syncNewCommentDraft } from "../views/commentSaveSync";

suite("Comment save rename failure", () => {
  test("returns created_unresolved when comment id cannot be resolved", async () => {
    const result = await syncNewCommentDraft({
      ticketId: 12,
      content: "New comment",
      deps: {
        addComment: async () => undefined,
        updateComment: async () => {
          throw new Error("should not update");
        },
        getCurrentUserId: async () => 1,
        getIssueDetail: async () => ({
          ticket: { id: 12, subject: "T", projectId: 9 },
          comments: [
            {
              id: 1,
              ticketId: 12,
              authorId: 1,
              authorName: "Tester",
              body: "Different",
              createdAt: "t1",
              updatedAt: "t2",
              editableByCurrentUser: true,
            },
          ],
        }),
      },
    });

    assert.strictEqual(result.status, "created_unresolved");
    assert.ok(result.message.includes("comment ID"));
  });
});
