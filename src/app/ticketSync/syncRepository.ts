import {
  GenericLifecycleAction,
  GenericSyncPhase,
  LifecycleExpectation,
  SyncOperationKey,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import {
  getOfflineSyncQueue,
  type OfflineCommentUpdate,
  type OfflineNewTicket,
  type OfflineTicketUpdate,
} from "../../views/offlineSyncStore";

export interface SyncOperationRepository {
  getOperation(key: SyncOperationKey, scope: string): UnifiedSyncOperation | undefined;
  listOperations(scope: string): UnifiedSyncOperation[];
  saveOperation(
    operation: UnifiedSyncOperation,
    scope: string,
    expectedPersistenceVersion?: number,
  ): Promise<UnifiedSyncOperation | undefined>;
  transitionOperation(
    key: SyncOperationKey,
    action: GenericLifecycleAction,
    scope: string,
    expected?: LifecycleExpectation,
  ): Promise<UnifiedSyncOperation | undefined>;
  completeOperation(
    key: SyncOperationKey,
    scope: string,
    expectedRevision?: number,
  ): Promise<boolean>;
  deleteOperation(key: SyncOperationKey, scope: string): Promise<boolean>;
}

export const toUnifiedOperationFromTicket = (
  ticket: OfflineTicketUpdate,
  scope: string,
): UnifiedSyncOperation => ({
  operationId: ticket.operationId ?? `${scope}:ticket:${ticket.ticketId}`,
  kind: "ticket_update",
  connectionScope: scope,
  phase: (ticket.phase ?? "queued") as GenericSyncPhase,
  revision: ticket.revision ?? 1,
  persistenceVersion: 1,
  ticketId: ticket.ticketId,
  documentUri: ticket.documentUri,
  createdChildIds: ticket.createdChildIds,
  effects: ticket.effects,
  payload: ticket,
  nextIntent: ticket.nextIntent,
  remoteUpdatedAt: ticket.lastKnownRemoteUpdatedAt,
  createdAt: ticket.createdAt,
});

export const toUnifiedOperationFromNewTicket = (
  ticket: OfflineNewTicket,
  scope: string,
): UnifiedSyncOperation => ({
  operationId: ticket.operationId ?? `${scope}:newTicket:${ticket.queueId ?? ticket.documentUri}`,
  kind: "ticket_create",
  connectionScope: scope,
  phase: (ticket.phase ?? "queued") as GenericSyncPhase,
  revision: ticket.revision ?? 1,
  persistenceVersion: 1,
  projectId: ticket.projectId,
  documentUri: ticket.documentUri,
  createdRemoteId: ticket.createdIssueId,
  createdChildIds: ticket.createdChildIds,
  effects: ticket.effects,
  payload: ticket,
  nextIntent: ticket.nextIntent,
  createdAt: ticket.createdAt,
});

export const toUnifiedOperationFromComment = (
  comment: OfflineCommentUpdate,
  scope: string,
): UnifiedSyncOperation => ({
  operationId: comment.operationId ?? `${scope}:comment:${comment.ticketId}:${comment.commentId ?? comment.documentUri}`,
  kind: comment.commentId !== undefined ? "comment_update" : "comment_create",
  connectionScope: scope,
  phase: (comment.phase ?? "queued") as GenericSyncPhase,
  revision: comment.revision ?? 1,
  persistenceVersion: 1,
  ticketId: comment.ticketId,
  commentId: comment.commentId,
  documentUri: comment.documentUri,
  createdRemoteId: comment.commentId,
  projectId: comment.remoteProjectId,
  effects: comment.effects,
  payload: comment,
  nextIntent: comment.nextIntent,
  createdAt: comment.createdAt,
});
