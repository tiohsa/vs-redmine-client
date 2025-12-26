import * as assert from "assert";
import { buildProjectTreeItems } from "../views/projectsView";

suite("Projects view", () => {
  test("builds tree items from projects", () => {
    const items = buildProjectTreeItems(
      [
        { id: 1, name: "Alpha", identifier: "alpha" },
        { id: 2, name: "Beta", identifier: "beta" },
      ],
      undefined,
    );

    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].label, "Alpha");
    assert.strictEqual(items[1].label, "Beta");
  });
});
