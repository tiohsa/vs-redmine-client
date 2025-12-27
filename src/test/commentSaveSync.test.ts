import * as assert from "assert";
import { clearCommentEdits, initializeCommentEdit } from "../views/commentEditStore";
import { syncCommentDraft, syncNewCommentDraft } from "../views/commentSaveSync";

suite("Comment save sync", () => {
  teardown(() => {
    clearCommentEdits();
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
      },
    });

    assert.strictEqual(added, true);
    assert.strictEqual(result.status, "created");
  });
});
