import {
  getOfflineSyncLifecycle,
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
    const lifecycle = getOfflineSyncLifecycle(update);
    items.push({
      key: { kind: "ticket", ticketId },
      label: `${formatTicketLabel(ticketId)} Ticket update`,
      detail: subject,
      documentUri: undefined,
      lifecycle,
      canDiscard: true,
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
    });
  }

  for (const newTicket of queue.newTickets) {
    const lifecycle = getOfflineSyncLifecycle(newTicket);
    const details = [
      newTicket.projectId ? `Project ID: ${newTicket.projectId}` : undefined,
      lifecycle === "recovery_pending" ? "Remote commit recovery pending" : undefined,
      lifecycle === "commit_unknown" ? "Remote commit status unknown" : undefined,
    ].filter((value): value is string => value !== undefined);
    items.push({
      key: { kind: "newTicket", documentUri: newTicket.documentUri },
      label: "New ticket",
      detail: details.length > 0 ? details.join(" · ") : undefined,
      documentUri: newTicket.documentUri,
      lifecycle,
      canDiscard: lifecycle === "queued" || newTicket.nextIntent !== undefined,
      canSync: true,
    });
  }

  return items;
};
