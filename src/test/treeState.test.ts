import * as assert from "assert";
import { clearTreeExpansionState, isTreeExpanded, setTreeExpanded } from "../views/treeState";

suite("Tree state", () => {
  test("tracks expansion state per view", () => {
    const viewKey = "projects";

    assert.strictEqual(isTreeExpanded(viewKey, "1"), false);

    setTreeExpanded(viewKey, "1", true);
    assert.strictEqual(isTreeExpanded(viewKey, "1"), true);

    setTreeExpanded(viewKey, "1", false);
    assert.strictEqual(isTreeExpanded(viewKey, "1"), false);

    clearTreeExpansionState(viewKey);
    assert.strictEqual(isTreeExpanded(viewKey, "1"), false);
  });
});
