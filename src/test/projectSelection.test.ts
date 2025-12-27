import * as assert from "assert";
import { buildProjectsViewItems, ProjectTreeItem } from "../views/projectsView";

suite("Project selection", () => {
  test("marks the selected project", () => {
    const items = buildProjectsViewItems(
      [
        { id: 1, name: "Alpha", identifier: "alpha" },
        { id: 2, name: "Beta", identifier: "beta" },
      ],
      2,
    );

    const selected = items.find(
      (item): item is ProjectTreeItem =>
        item instanceof ProjectTreeItem &&
        item.contextValue === "redmineProjectSelected",
    );
    assert.ok(selected);
    assert.strictEqual(selected?.label, "Beta");
  });
});
