import {
  evaluateOfflineSyncPolicy,
  getOfflineSyncQueue,
  isAbandoned,
} from "../../views/offlineSyncStore";
import { getTicketSummary } from "../../views/ticketSummaryStore";
import { formatTicketLabel } from "../../views/ticketLabel";
import type { DashboardUnsyncedItem } from "../dashboardProtocol";
import { getCurrentConnectionScope } from "../../config/connectionScope";
import { createSyncEngine } from "../../app/syncEngine";

const processingRecord = (operation: {
  operationId?: string; phase?: string; revision?: number; attemptGeneration?: number;
  effects?: Array<{ effectId: string; state: string }>;
  nextIntent?: unknown;
  disposition?: { abandonedAt: number };
  createdIssueId?: number;
  remoteUpdatedAt?: string;
  createdChildIds?: number[];
}): string => JSON.stringify({
  operationId: operation.operationId,
  abandonedAt: operation.disposition?.abandonedAt,
  phase: operation.phase,
  revision: operation.revision,
  attemptGeneration: operation.attemptGeneration,
  effects: operation.effects?.map((effect) => ({ id: effect.effectId, state: effect.state })),
  createdIssueId: operation.createdIssueId,
  remoteUpdatedAt: operation.remoteUpdatedAt,
  createdChildIds: operation.createdChildIds,
  hasLaterChanges: operation.nextIntent !== undefined,
}, null, 2);

export const buildUnsyncedDashboardItems = (abandoned = false): DashboardUnsyncedItem[] => {
  const connectionScope = getCurrentConnectionScope();
  const queue = getOfflineSyncQueue(connectionScope);
  const engine = createSyncEngine();
  const requiresReview = (key: Parameters<typeof engine.getRecoveryItems>[0]): boolean =>
    engine.getRecoveryItems(key, { connectionScope }).some((item) => item.allowedActions.length > 0);
  const items: DashboardUnsyncedItem[] = [];

  queue.tickets.forEach((update, ticketId) => {
    if (isAbandoned(update) !== abandoned) { return; }
    const subject = getTicketSummary(ticketId);
    const policy = evaluateOfflineSyncPolicy(update);
    items.push({
      key: { kind: "ticket", ticketId },
      label: `${formatTicketLabel(ticketId)} Ticket update`,
      detail: subject,
      documentUri: undefined,
      lifecycle: policy.lifecycle,
      canDiscard: policy.canDiscard,
      discardMode: policy.discardMode,
      canSync: true,
      abandonedAt: update.disposition?.abandonedAt,
      hasLaterChanges: update.nextIntent !== undefined,
      processingRecord: abandoned ? processingRecord(update) : undefined,
      ...(requiresReview({ kind: "ticket", ticketId }) ? { requiresReview: true } : {}),
    });
  });

  for (const comment of queue.comments) {
    if (isAbandoned(comment) !== abandoned) { continue; }
    const base = formatTicketLabel(comment.ticketId);
    const label =
      comment.commentId !== undefined
        ? `${base} Comment #${comment.commentId} update`
        : `${base} New comment`;
    items.push({
      key: {
        kind: "comment",
        ticketId: comment.ticketId,
        commentId: comment.commentId,
        documentUri: comment.documentUri,
      },
      label,
      documentUri: comment.documentUri,
      ...evaluateOfflineSyncPolicy(comment),
      canSync: true,
      abandonedAt: comment.disposition?.abandonedAt,
      hasLaterChanges: comment.nextIntent !== undefined,
      processingRecord: abandoned ? processingRecord(comment) : undefined,
      ...(requiresReview({
        kind: "comment",
        ticketId: comment.ticketId,
        commentId: comment.commentId,
        documentUri: comment.documentUri,
      }) ? { requiresReview: true } : {}),
    });
  }

  for (const newTicket of queue.newTickets) {
    if (isAbandoned(newTicket) !== abandoned) { continue; }
    const policy = evaluateOfflineSyncPolicy(newTicket);
    const details = [
      newTicket.projectId ? `Project ID: ${newTicket.projectId}` : undefined,
      policy.lifecycle === "recovery_pending" ? "Remote commit recovery pending" : undefined,
      policy.lifecycle === "commit_unknown" ? "Remote commit status unknown" : undefined,
    ].filter((value): value is string => value !== undefined);
    items.push({
      key: { kind: "newTicket", queueId: newTicket.queueId, documentUri: newTicket.documentUri },
      label: "New ticket",
      detail: details.length > 0 ? details.join(" · ") : undefined,
      documentUri: newTicket.documentUri,
      lifecycle: policy.lifecycle,
      canDiscard: policy.canDiscard,
      discardMode: policy.discardMode,
      canSync: true,
      abandonedAt: newTicket.disposition?.abandonedAt,
      hasLaterChanges: newTicket.nextIntent !== undefined,
      processingRecord: abandoned ? processingRecord(newTicket) : undefined,
      ...(requiresReview({ kind: "newTicket", queueId: newTicket.queueId, documentUri: newTicket.documentUri })
        ? { requiresReview: true }
        : {}),
    });
  }

  return items;
};
