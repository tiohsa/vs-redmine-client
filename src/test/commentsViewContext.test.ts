import * as assert from "assert";
import {
  clearCommentViewContext,
  getCommentAddContext,
  setCommentAddContext,
} from "../views/commentViewContext";

suite("Comments view context", () => {
  teardown(() => {
    clearCommentViewContext();
  });

  test("stores and retrieves add comment context", async () => {
    await setCommentAddContext(true);

    assert.strictEqual(getCommentAddContext(), true);
  });

  test("clears stored values", async () => {
    await setCommentAddContext(false);

    clearCommentViewContext();

    assert.strictEqual(getCommentAddContext(), undefined);
  });
});
