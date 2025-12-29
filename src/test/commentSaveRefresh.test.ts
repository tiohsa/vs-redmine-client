import * as assert from "assert";
import { shouldRefreshComments } from "../views/commentSaveSync";

suite("Comment save refresh", () => {
  test("refreshes on created/success", () => {
    assert.strictEqual(shouldRefreshComments("created"), true);
    assert.strictEqual(shouldRefreshComments("created_unresolved"), true);
    assert.strictEqual(shouldRefreshComments("success"), true);
  });

  test("does not refresh on no_change or errors", () => {
    assert.strictEqual(shouldRefreshComments("no_change"), false);
    assert.strictEqual(shouldRefreshComments("conflict"), false);
    assert.strictEqual(shouldRefreshComments("failed"), false);
    assert.strictEqual(shouldRefreshComments("forbidden"), false);
    assert.strictEqual(shouldRefreshComments("not_found"), false);
    assert.strictEqual(shouldRefreshComments("unreachable"), false);
  });
});
