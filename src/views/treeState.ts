const expansionState = new Map<string, Set<string>>();

const getExpansionSet = (viewKey: string): Set<string> => {
  const current = expansionState.get(viewKey);
  if (current) {
    return current;
  }
  const created = new Set<string>();
  expansionState.set(viewKey, created);
  return created;
};

export const isTreeExpanded = (viewKey: string, nodeId: string): boolean =>
  getExpansionSet(viewKey).has(nodeId);

export const setTreeExpanded = (viewKey: string, nodeId: string, expanded: boolean): void => {
  const state = getExpansionSet(viewKey);
  if (expanded) {
    state.add(nodeId);
    return;
  }
  state.delete(nodeId);
};

export const clearTreeExpansionState = (viewKey: string): void => {
  expansionState.delete(viewKey);
};
