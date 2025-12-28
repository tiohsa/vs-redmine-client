import type { Memento } from "vscode";

const MAX_TREE_STATE_NODES = 5000;
const STORAGE_KEY = "todoex.treeExpansionState";

const expansionState = new Map<string, Set<string>>();
let expansionStorage: Memento | undefined;

const persistExpansionState = (): void => {
  if (!expansionStorage) {
    return;
  }
  const payload: Record<string, string[]> = {};
  expansionState.forEach((set, key) => {
    if (set.size > 0) {
      payload[key] = Array.from(set).slice(0, MAX_TREE_STATE_NODES);
    }
  });
  void expansionStorage.update(STORAGE_KEY, payload);
};

const getExpansionSet = (viewKey: string): Set<string> => {
  const current = expansionState.get(viewKey);
  if (current) {
    return current;
  }
  const created = new Set<string>();
  expansionState.set(viewKey, created);
  return created;
};

export const initializeTreeExpansionState = (storage: Memento): void => {
  expansionStorage = storage;
  expansionState.clear();
  const stored = storage.get<Record<string, unknown>>(STORAGE_KEY, {});
  Object.entries(stored).forEach(([viewKey, ids]) => {
    if (!Array.isArray(ids)) {
      return;
    }
    const filtered = ids.filter((id): id is string => typeof id === "string");
    if (filtered.length === 0) {
      return;
    }
    expansionState.set(viewKey, new Set(filtered.slice(0, MAX_TREE_STATE_NODES)));
  });
};

export const isTreeExpanded = (viewKey: string, nodeId: string): boolean =>
  getExpansionSet(viewKey).has(nodeId);

export const setTreeExpanded = (viewKey: string, nodeId: string, expanded: boolean): void => {
  const state = getExpansionSet(viewKey);
  if (expanded) {
    if (state.size >= MAX_TREE_STATE_NODES && !state.has(nodeId)) {
      return;
    }
    state.add(nodeId);
    persistExpansionState();
    return;
  }
  state.delete(nodeId);
  persistExpansionState();
};

export const setTreeExpandedBulk = (
  viewKey: string,
  nodeIds: string[],
  expanded: boolean,
): void => {
  const state = getExpansionSet(viewKey);
  if (expanded) {
    for (const nodeId of nodeIds) {
      if (state.size >= MAX_TREE_STATE_NODES && !state.has(nodeId)) {
        break;
      }
      state.add(nodeId);
    }
    persistExpansionState();
    return;
  }
  nodeIds.forEach((nodeId) => state.delete(nodeId));
  persistExpansionState();
};

export const clearTreeExpansionState = (viewKey: string): void => {
  expansionState.delete(viewKey);
  persistExpansionState();
};
