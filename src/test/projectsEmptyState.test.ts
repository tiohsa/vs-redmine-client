import * as assert from "assert";
import { buildProjectsViewItems } from "../views/projectsView";

suite("Projects empty state", () => {
  test("returns empty state item when no projects", () => {
    const items = buildProjectsViewItems([], undefined);

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].contextValue, "viewStateEmpty");
  });
});
