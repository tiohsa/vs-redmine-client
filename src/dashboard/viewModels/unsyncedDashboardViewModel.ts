import { getOfflineSyncQueue } from "../../views/offlineSyncStore";
import { getTicketSummary } from "../../views/ticketSummaryStore";
import { formatTicketLabel } from "../../views/ticketLabel";
import type { DashboardUnsyncedItem } from "../dashboardProtocol";
import { getCurrentConnectionScope } from "../../config/connectionScope";

export const buildUnsyncedDashboardItems = (): DashboardUnsyncedItem[] => {
  const queue = getOfflineSyncQueue(getCurrentConnectionScope());
  const items: DashboardUnsyncedItem[] = [];

  queue.tickets.forEach((_update, ticketId) => {
    const subject = getTicketSummary(ticketId);
    items.push({
      key: { kind: "ticket", ticketId },
      label: `${formatTicketLabel(ticketId)} Ticket update`,
      detail: subject,
      documentUri: undefined,
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
    });
  }

  for (const newTicket of queue.newTickets) {
    items.push({
      key: { kind: "newTicket", documentUri: newTicket.documentUri },
      label: "New ticket",
      detail: newTicket.projectId ? `Project ID: ${newTicket.projectId}` : undefined,
      documentUri: newTicket.documentUri,
    });
  }

  return items;
};
