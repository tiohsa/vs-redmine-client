import * as assert from "assert";
import { buildProjectTreeItems } from "../views/projectsView";

suite("Project selection", () => {
  test("marks the selected project", () => {
    const items = buildProjectTreeItems(
      [
        { id: 1, name: "Alpha", identifier: "alpha" },
        { id: 2, name: "Beta", identifier: "beta" },
      ],
      2,
    );

    const selected = items.find((item) => item.contextValue === "redmineProjectSelected");
    assert.ok(selected);
    assert.strictEqual(selected?.label, "Beta");
  });
});
