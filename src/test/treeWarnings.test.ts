import * as assert from "assert";
import { createCycleWarningItem } from "../views/treeWarnings";

suite("Tree warnings", () => {
  test("creates cycle warning items", () => {
    const item = createCycleWarningItem("Sample");
    assert.strictEqual(String(item.label), "Cycle detected: Sample");
    assert.strictEqual(item.contextValue, "treeCycleWarning");
  });
});
