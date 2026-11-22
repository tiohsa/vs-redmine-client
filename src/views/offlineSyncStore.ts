import { addOfflineCommentUpdateAsync, removeOfflineCommentEntryAsync } from "./offlineSyncComments";
import { addOfflineNewTicketAsync, discardOfflineNewTicketAsync } from "./offlineSyncNewTickets";
import { isAbandoned } from "./offlineSyncPolicy";
import { operationsFromQueue } from "./offlineSyncQueueCodec";
import { getActiveScope, getQueue } from "./offlineSyncQueueStorage";
import { addOfflineTicketUpdateAsync, discardOfflineTicketUpdateAsync } from "./offlineSyncTicketUpdates";
import type { OfflineCommentUpdate, OfflineDiscardResult, OfflineNewTicket, OfflineTicketUpdate, SyncOperation } from "./offlineSyncTypes";

export {
  addOfflineCommentUpdateAsync,
  discardOfflineCommentUpdateAsync,
  getOfflineCommentUpdate,
  rebaseOfflineCommentUpdateAfterConflictAsync,
  removeOfflineCommentEntryAsync,
  removeOfflineCommentEntryIfMatchesAsync,
  type OfflineCommentConflictExpectation,
} from "./offlineSyncComments";
export { planOfflineSyncEffectAsync, transitionOfflineSyncEffectAsync } from "./offlineSyncEffectLedger";
export {
  addOfflineNewTicketAsync,
  discardOfflineNewTicketAsync,
  getOfflineNewTicket,
  removeOfflineNewTicketAsync,
  updateOfflineNewTicketAsync,
} from "./offlineSyncNewTickets";
export {
  addOfflineTicketUpdateAsync,
  beginFreshTicketEdit,
  cancelQueuedTicketUpdateIfMatchesAsync,
  discardOfflineTicketUpdateAsync,
  getTicketEditAuthorization,
  mergeOfflineTicketUpdate,
  rebaseOfflineTicketUpdateAfterConflictAsync,
  removeOfflineTicketUpdateAsync,
  removeOfflineTicketUpdateIfMatchesAsync,
  updateOfflineTicketUpdateAsync,
  updateQueuedTicketIntentAsync,
  type OfflineTicketConflictExpectation,
} from "./offlineSyncTicketUpdates";

export { beginActiveSync } from "./offlineSyncActiveOperations";
export {
  commitOfflineAbandonAsync,
  commitOfflineDiscardAsync,
  commitOfflineForgetAbandonedAsync,
  commitOfflineForgetAllAbandonedAsync,
  prepareOfflineAbandon,
  prepareOfflineDiscard,
  prepareOfflineForgetAbandoned,
  prepareOfflineForgetAllAbandoned,
} from "./offlineSyncDiscard";
export {
  abortOfflineNewTicketBeforeRemoteWriteAsync,
  abortOfflineTicketUpdateBeforeRemoteWriteAsync,
  completeOfflineCommentAsync,
  completeOfflineNewTicketAsync,
  completeOfflineTicketUpdateAsync,
  transitionOfflineCommentLifecycleAsync,
  transitionOfflineNewTicketLifecycleAsync,
  transitionOfflineTicketUpdateLifecycleAsync,
} from "./offlineSyncLifecycle";
export { evaluateOfflineSyncPolicy, getOfflineSyncLifecycle, isAbandoned } from "./offlineSyncPolicy";
export { resolveStoredOfflineOperation, sameDocumentIdentity } from "./offlineSyncQueueEntries";
export {
  clearOfflineSyncQueueAsync,
  getActiveScope,
  getOfflineSyncQueue,
  getPersistedUploadSpoolReferences,
  initializeOfflineSyncStore,
  mutateOfflineSyncQueueAsync,
  onOfflineSyncQueueChanged,
  persistAsync,
  replaceOfflineSyncQueueAsync,
  switchOfflineSyncStore,
} from "./offlineSyncQueueStorage";
export type {
  CommentIntentSnapshot,
  CommentLifecycleAction,
  LifecycleTransitionExpectation,
  NewTicketIntentSnapshot,
  NewTicketLifecycleAction,
  NewTicketSyncPhase,
  OfflineAbandonPlan,
  OfflineAbandonResult,
  OfflineCommentUpdate,
  OfflineDiscardKey,
  OfflineDiscardMode,
  OfflineDiscardPlan,
  OfflineDiscardResult,
  OfflineForgetAbandonedPlan,
  OfflineForgetAbandonedResult,
  OfflineForgetAllAbandonedPlan,
  OfflineNewTicket,
  OfflineSyncLifecycle,
  OfflineSyncPolicy,
  OfflineSyncQueue,
  OfflineTicketUpdate,
  QueuedTicketCancellationExpectation,
  QueuedTicketCancelResult,
  ResolvedStoredOperation,
  SyncDisposition,
  SyncOperation,
  SyncOperationKind,
  TicketEditAuthorization,
  TicketUpdateIntentSnapshot,
  TicketUpdateLifecycleAction,
  TicketUpdateSyncPhase,
} from "./offlineSyncTypes";

/** Returns the canonical, persisted representation of pending work. */
export const listSyncOperations = (scope = getActiveScope()): SyncOperation[] =>
  structuredClone(operationsFromQueue(getQueue(scope), scope).filter((operation) => !isAbandoned(operation)));

export const getSyncOperation = (
  operationId: string,
  scope = getActiveScope(),
): SyncOperation | undefined => listSyncOperations(scope).find(
  (operation) => operation.operationId === operationId,
);

/** Canonical write API for all pending synchronization operations. */
export const upsertSyncOperationAsync = async (
  operation: SyncOperation,
  scope = operation.connectionScope || getActiveScope(),
): Promise<void> => {
  switch (operation.kind) {
    case "ticketCreate": {
      const ticket = operation.payload as OfflineNewTicket;
      const { queueId: _queueId, ...update } = ticket;
      await addOfflineNewTicketAsync(update, scope);
      return;
    }
    case "ticketUpdate": {
      const update = operation.payload as OfflineTicketUpdate;
      await addOfflineTicketUpdateAsync(update.ticketId, update, scope);
      return;
    }
    case "commentCreate":
    case "commentUpdate":
      await addOfflineCommentUpdateAsync(operation.payload as OfflineCommentUpdate, scope);
      return;
  }
};

/** Canonical deletion API. Recovery-pending ticket operations remain protected. */
export const discardSyncOperation = async (
  operationId: string,
  scope = getActiveScope(),
): Promise<OfflineDiscardResult> => {
  const operation = getSyncOperation(operationId, scope);
  if (!operation) {
    return "not_found";
  }
  switch (operation.kind) {
    case "ticketCreate":
      return discardOfflineNewTicketAsync(
        { queueId: (operation.payload as OfflineNewTicket).queueId },
        scope,
      );
    case "ticketUpdate":
      return discardOfflineTicketUpdateAsync(
        (operation.payload as OfflineTicketUpdate).ticketId,
        scope,
      );
    case "commentCreate":
    case "commentUpdate": {
      const comment = operation.payload as OfflineCommentUpdate;
      await removeOfflineCommentEntryAsync(
        { ticketId: comment.ticketId, operationId: comment.operationId, commentId: comment.commentId, documentUri: comment.documentUri },
        scope,
      );
      return "discarded";
    }
  }
};
