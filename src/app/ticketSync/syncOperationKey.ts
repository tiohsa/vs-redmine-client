import type { SyncOperationKey, UnifiedSyncOperation } from "./syncOperationTypes";

export const getOperationKey = (operation: UnifiedSyncOperation): SyncOperationKey => operation.key ?? (
  operation.kind === "ticket_create"
    ? { kind: "newTicket", queueId: operation.operationId, documentUri: operation.documentUri }
    : operation.kind === "comment_create" || operation.kind === "comment_update"
      ? { kind: "comment", ticketId: operation.ticketId ?? 0, commentId: operation.commentId, documentUri: operation.documentUri, operationId: operation.operationId }
      : { kind: "ticket", ticketId: operation.ticketId ?? 0 }
);

export const getOpKeyString = (key: SyncOperationKey): string => {
  if (key.kind === "ticket") {
    return `ticket:${key.ticketId}`;
  }
  if (key.kind === "newTicket") {
    return `newTicket:${key.queueId ?? key.documentUri ?? "0"}`;
  }
  return `comment:${key.ticketId}:${key.operationId ?? key.commentId ?? key.documentUri ?? "new"}`;
};
