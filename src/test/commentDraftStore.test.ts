import * as assert from "assert";
import {
  clearCommentDrafts,
  getCommentDraft,
  setCommentDraft,
} from "../views/commentDraftStore";

suite("Comment draft store", () => {
  teardown(() => {
    clearCommentDrafts();
  });

  test("stores drafts per ticket", () => {
    setCommentDraft(100, "Draft A");
    setCommentDraft(200, "Draft B");

    assert.strictEqual(getCommentDraft(100), "Draft A");
    assert.strictEqual(getCommentDraft(200), "Draft B");
  });
});
