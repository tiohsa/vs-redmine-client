import type { UnifiedSyncOperation } from "./syncOperationTypes";

export const getOutcomeTicketId = (operation: UnifiedSyncOperation, remoteId?: number): number =>
  operation.kind === "comment_create" || operation.kind === "comment_update"
    ? operation.ticketId ?? 0
    : remoteId ?? operation.createdRemoteId ?? operation.ticketId ?? 0;
