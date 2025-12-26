import * as assert from "assert";
import { clearCommentEdits, initializeCommentEdit } from "../views/commentEditStore";
import { syncCommentDraft } from "../views/commentSaveSync";

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
        updateComment: async () => {
          throw new Error("Redmine request failed (404): Not Found");
        },
      },
    });

    assert.strictEqual(result.status, "not_found");
  });
});
