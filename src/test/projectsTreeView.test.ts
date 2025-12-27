import * as assert from "assert";
import { buildProjectsViewItems, ProjectTreeItem } from "../views/projectsView";

suite("Projects tree view", () => {
  test("builds hierarchical project items", () => {
    const items = buildProjectsViewItems([
      { id: 1, name: "Parent", identifier: "parent" },
      { id: 2, name: "Child", identifier: "child", parentId: 1 },
    ]);

    const root = items[0] as ProjectTreeItem;
    assert.strictEqual(root.project.name, "Parent");
    assert.strictEqual(root.childNodes.length, 1);
    assert.strictEqual(root.childNodes[0].data.name, "Child");
  });

  test("adds warnings for project cycles", () => {
    const items = buildProjectsViewItems([
      { id: 1, name: "Cycle A", identifier: "a", parentId: 2 },
      { id: 2, name: "Cycle B", identifier: "b", parentId: 1 },
    ]);

    assert.ok(String(items[0].label).includes("Cycle detected"));
  });
});
