import * as assert from "assert";
import { buildProjectsViewItems, ProjectTreeItem } from "../views/projectsView";

suite("Projects view", () => {
  test("builds tree items from projects", () => {
    const items = buildProjectsViewItems([
      { id: 1, name: "Alpha", identifier: "alpha" },
      { id: 2, name: "Beta", identifier: "beta", parentId: 1 },
    ]);

    assert.strictEqual(items.length, 1);
    const root = items[0] as ProjectTreeItem;
    assert.strictEqual(root.label, "Alpha");
  });
});
