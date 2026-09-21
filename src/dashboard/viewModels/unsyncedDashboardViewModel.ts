import {
  evaluateOfflineSyncPolicy,
  getOfflineSyncQueue,
} from "../../views/offlineSyncStore";
import { getTicketSummary } from "../../views/ticketSummaryStore";
import { formatTicketLabel } from "../../views/ticketLabel";
import type { DashboardUnsyncedItem } from "../dashboardProtocol";
import { getCurrentConnectionScope } from "../../config/connectionScope";

export const buildUnsyncedDashboardItems = (): DashboardUnsyncedItem[] => {
  const queue = getOfflineSyncQueue(getCurrentConnectionScope());
  const items: DashboardUnsyncedItem[] = [];

  queue.tickets.forEach((update, ticketId) => {
    const subject = getTicketSummary(ticketId);
    const { lifecycle, canDiscard } = evaluateOfflineSyncPolicy(update);
    items.push({
      key: { kind: "ticket", ticketId },
      label: `${formatTicketLabel(ticketId)} Ticket update`,
      detail: subject,
      documentUri: undefined,
      lifecycle,
      canDiscard,
      canSync: true,
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
    });
  }

  for (const newTicket of queue.newTickets) {
    const { lifecycle, canDiscard } = evaluateOfflineSyncPolicy(newTicket);
    const details = [
      newTicket.projectId ? `Project ID: ${newTicket.projectId}` : undefined,
      lifecycle === "recovery_pending" ? "Remote commit recovery pending" : undefined,
      lifecycle === "commit_unknown" ? "Remote commit status unknown" : undefined,
    ].filter((value): value is string => value !== undefined);
    items.push({
      key: { kind: "newTicket", queueId: newTicket.queueId, documentUri: newTicket.documentUri },
      label: "New ticket",
      detail: details.length > 0 ? details.join(" · ") : undefined,
      documentUri: newTicket.documentUri,
      lifecycle,
      canDiscard,
      canSync: true,
    });
  }

  return items;
};
