import * as assert from "assert";
import { buildTree, collectTreeNodeIds } from "../views/treeBuilder";
import { TreeSource } from "../views/treeTypes";
import { buildProjectFixture } from "./helpers/treeFixtures";

suite("Tree builder", () => {
  test("builds hierarchy and preserves roots", () => {
    const parent = buildProjectFixture({ id: 1, name: "Parent" });
    const child = buildProjectFixture({ id: 2, name: "Child", parentId: 1 });
    const orphan = buildProjectFixture({ id: 3, name: "Orphan", parentId: 999 });

    const items: Array<TreeSource<typeof parent>> = [
      { id: parent.id, parentId: parent.parentId, label: parent.name, data: parent },
      { id: child.id, parentId: child.parentId, label: child.name, data: child },
      { id: orphan.id, parentId: orphan.parentId, label: orphan.name, data: orphan },
    ];

    const result = buildTree(items);

    assert.strictEqual(result.roots.length, 2);
    const parentNode = result.roots.find((node) => node.id === 1);
    assert.ok(parentNode);
    assert.strictEqual(parentNode?.children.length, 1);
    assert.strictEqual(parentNode?.children[0].id, 2);

    const orphanNode = result.roots.find((node) => node.id === 3);
    assert.ok(orphanNode);
    assert.strictEqual(orphanNode?.children.length, 0);
  });

  test("detects cycles and avoids infinite children", () => {
    const itemA = buildProjectFixture({ id: 10, name: "Cycle A", parentId: 11 });
    const itemB = buildProjectFixture({ id: 11, name: "Cycle B", parentId: 10 });

    const items: Array<TreeSource<typeof itemA>> = [
      { id: itemA.id, parentId: itemA.parentId, label: itemA.name, data: itemA },
      { id: itemB.id, parentId: itemB.parentId, label: itemB.name, data: itemB },
    ];

    const result = buildTree(items);

    assert.strictEqual(result.cycleIds.has(10), true);
    assert.strictEqual(result.cycleIds.has(11), true);
    assert.strictEqual(result.roots.length, 2);
    result.roots.forEach((node) => {
      assert.strictEqual(node.children.length, 0);
    });
  });

  test("collects node ids from tree roots", () => {
    const parent = buildProjectFixture({ id: 1, name: "Parent" });
    const child = buildProjectFixture({ id: 2, name: "Child", parentId: 1 });
    const grandchild = buildProjectFixture({ id: 3, name: "Grandchild", parentId: 2 });

    const items: Array<TreeSource<typeof parent>> = [
      { id: parent.id, parentId: parent.parentId, label: parent.name, data: parent },
      { id: child.id, parentId: child.parentId, label: child.name, data: child },
      { id: grandchild.id, parentId: grandchild.parentId, label: grandchild.name, data: grandchild },
    ];

    const result = buildTree(items);
    const ids = collectTreeNodeIds(result.roots).sort((a, b) => a - b);

    assert.deepStrictEqual(ids, [1, 2, 3]);
  });
});
