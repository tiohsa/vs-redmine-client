import {
  evaluateOfflineSyncPolicy,
  getOfflineSyncQueue,
} from "../../views/offlineSyncStore";
import { getTicketSummary } from "../../views/ticketSummaryStore";
import { formatTicketLabel } from "../../views/ticketLabel";
import type { DashboardUnsyncedItem } from "../dashboardProtocol";
import { getCurrentConnectionScope } from "../../config/connectionScope";
import { createSyncEngine } from "../../app/syncEngine";

export const buildUnsyncedDashboardItems = (): DashboardUnsyncedItem[] => {
  const connectionScope = getCurrentConnectionScope();
  const queue = getOfflineSyncQueue(connectionScope);
  const engine = createSyncEngine();
  const requiresReview = (key: Parameters<typeof engine.getRecoveryItems>[0]): boolean =>
    engine.getRecoveryItems(key, { connectionScope }).some((item) => item.allowedActions.length > 0);
  const items: DashboardUnsyncedItem[] = [];

  queue.tickets.forEach((update, ticketId) => {
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
      ...(requiresReview({ kind: "ticket", ticketId }) ? { requiresReview: true } : {}),
    });
  });

  for (const comment of queue.comments) {
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
      ...(requiresReview({
        kind: "comment",
        ticketId: comment.ticketId,
        commentId: comment.commentId,
        documentUri: comment.documentUri,
      }) ? { requiresReview: true } : {}),
    });
  }

  for (const newTicket of queue.newTickets) {
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
      ...(requiresReview({ kind: "newTicket", queueId: newTicket.queueId, documentUri: newTicket.documentUri })
        ? { requiresReview: true }
        : {}),
    });
  }

  return items;
};
