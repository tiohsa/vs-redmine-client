import * as assert from "assert";
import {
  clearCommentViewContext,
  getCommentAddContext,
} from "../views/commentViewContext";
import {
  evaluateAddCommentPermission,
  refreshAddCommentContext,
} from "../views/commentsView";

suite("Comments view permissions", () => {
  teardown(() => {
    clearCommentViewContext();
  });

  test("evaluates add comment permission based on settings and ticket", () => {
    assert.strictEqual(
      evaluateAddCommentPermission(12, "https://example", "key"),
      true,
    );
    assert.strictEqual(evaluateAddCommentPermission(undefined, "https://example", "key"), false);
    assert.strictEqual(evaluateAddCommentPermission(12, "", "key"), false);
    assert.strictEqual(evaluateAddCommentPermission(12, "https://example", ""), false);
  });

  test("refreshes add comment context", () => {
    refreshAddCommentContext(12, "https://example", "key");

    assert.strictEqual(getCommentAddContext(), true);
  });
});
