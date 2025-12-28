import * as assert from "assert";
import {
  clearTreeExpansionState,
  initializeTreeExpansionState,
  isTreeExpanded,
  setTreeExpanded,
  setTreeExpandedBulk,
} from "../views/treeState";
import { createTestMemento } from "./helpers/vscodeMemento";

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

  test("updates expansion state in bulk", () => {
    const viewKey = "tickets";
    clearTreeExpansionState(viewKey);

    setTreeExpandedBulk(viewKey, ["1", "2"], true);
    assert.strictEqual(isTreeExpanded(viewKey, "1"), true);
    assert.strictEqual(isTreeExpanded(viewKey, "2"), true);

    setTreeExpandedBulk(viewKey, ["1"], false);
    assert.strictEqual(isTreeExpanded(viewKey, "1"), false);
    assert.strictEqual(isTreeExpanded(viewKey, "2"), true);
  });

  test("persists and caps expansion state at 5000 nodes", () => {
    const memento = createTestMemento();
    initializeTreeExpansionState(memento);

    const nodeIds = Array.from({ length: 6000 }, (_, index) => String(index));
    setTreeExpandedBulk("projects", nodeIds, true);

    const stored = memento.get<Record<string, string[]>>("todoex.treeExpansionState", {});
    assert.ok(stored.projects, "projects state must be stored");
    assert.strictEqual(stored.projects.length, 5000);
  });
});
