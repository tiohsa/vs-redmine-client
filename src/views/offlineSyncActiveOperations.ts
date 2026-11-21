import type { StoredOfflineOperation } from "./offlineSyncTypes";

const activeSyncs = new Map<string, number>();
const activeSyncKey = (scope: string, operationId: string): string => `${scope}\0${operationId}`;
export const beginActiveSync = (scope: string, operationId: string): (() => void) => {
  const key = activeSyncKey(scope, operationId);
  activeSyncs.set(key, (activeSyncs.get(key) ?? 0) + 1);
  return () => {
    const remaining = (activeSyncs.get(key) ?? 1) - 1;
    if (remaining) { activeSyncs.set(key, remaining); }
    else { activeSyncs.delete(key); }
  };
};

export const isOfflineSyncActive = (scope: string, operation: StoredOfflineOperation): boolean =>
  activeSyncs.has(activeSyncKey(scope, operation.operationId ??
    ("queueId" in operation ? operation.queueId : `ticket:${operation.ticketId}`)));
