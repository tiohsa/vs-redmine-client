import { TreeBuildResult, TreeNode, TreeSource } from "./treeTypes";

const buildCycleIds = <T>(
  items: TreeSource<T>[],
  itemById: Map<number, TreeSource<T>>,
): Set<number> => {
  const cycleIds = new Set<number>();

  items.forEach((item) => {
    const chain = new Set<number>();
    let current: TreeSource<T> | undefined = item;

    while (current) {
      if (chain.has(current.id)) {
        chain.forEach((id) => cycleIds.add(id));
        break;
      }

      chain.add(current.id);
      if (current.parentId === undefined) {
        break;
      }

      const parent = itemById.get(current.parentId);
      if (!parent) {
        break;
      }

      current = parent;
    }
  });

  return cycleIds;
};

const isRootNode = <T>(
  item: TreeSource<T>,
  itemById: Map<number, TreeSource<T>>,
  cycleIds: Set<number>,
): boolean => {
  if (cycleIds.has(item.id)) {
    return true;
  }

  if (item.parentId === undefined) {
    return true;
  }

  const parent = itemById.get(item.parentId);
  if (!parent) {
    return true;
  }

  return cycleIds.has(parent.id);
};

const buildChildMap = <T>(
  items: TreeSource<T>[],
  itemById: Map<number, TreeSource<T>>,
  cycleIds: Set<number>,
): Map<number, number[]> => {
  const childMap = new Map<number, number[]>();

  items.forEach((item) => {
    if (item.parentId === undefined) {
      return;
    }

    if (cycleIds.has(item.id) || cycleIds.has(item.parentId)) {
      return;
    }

    if (!itemById.has(item.parentId)) {
      return;
    }

    const children = childMap.get(item.parentId) ?? [];
    children.push(item.id);
    childMap.set(item.parentId, children);
  });

  return childMap;
};

const buildNode = <T>(
  nodeId: number,
  level: number,
  itemById: Map<number, TreeSource<T>>,
  childMap: Map<number, number[]>,
): TreeNode<T> => {
  const source = itemById.get(nodeId);
  if (!source) {
    throw new Error(`Missing tree item ${nodeId}`);
  }

  const children = (childMap.get(nodeId) ?? []).map((childId) =>
    buildNode(childId, level + 1, itemById, childMap),
  );

  return {
    id: source.id,
    parentId: source.parentId,
    label: source.label,
    data: source.data,
    level,
    children,
  };
};

export const buildTree = <T>(items: TreeSource<T>[]): TreeBuildResult<T> => {
  const itemById = new Map<number, TreeSource<T>>();
  items.forEach((item) => itemById.set(item.id, item));

  const cycleIds = buildCycleIds(items, itemById);
  const childMap = buildChildMap(items, itemById, cycleIds);

  const roots: TreeNode<T>[] = [];
  items.forEach((item) => {
    if (isRootNode(item, itemById, cycleIds)) {
      roots.push(buildNode(item.id, 0, itemById, childMap));
    }
  });

  return { roots, cycleIds };
};
