import * as vscode from "vscode";
import { Ticket } from "../redmine/types";
import { showError } from "../utils/notifications";
import { CommentsTreeProvider } from "../views/commentsView";
import { showTicketPreview } from "../views/ticketPreview";
import { TicketsTreeProvider } from "../views/ticketsView";

type TicketQuickPickItem = vscode.QuickPickItem & { ticket: Ticket };

const buildTicketDescription = (ticket: Ticket): string | undefined => {
  const parts = [ticket.statusName, ticket.trackerName].filter(
    (value): value is string => Boolean(value),
  );
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join(" - ");
};

const buildTicketDetail = (ticket: Ticket): string | undefined =>
  ticket.assigneeName ? `Assignee: ${ticket.assigneeName}` : undefined;

export const searchTickets = async (
  ticketsProvider: TicketsTreeProvider,
  commentsProvider: CommentsTreeProvider,
): Promise<void> => {
  await ticketsProvider.loadTickets();
  if (!ticketsProvider.getSelectedProjectId()) {
    showError("Select a project to search tickets.");
    return;
  }

  const tickets = ticketsProvider.getTickets();
  if (tickets.length === 0) {
    void vscode.window.showInformationMessage("No tickets available.");
    return;
  }

  const items: TicketQuickPickItem[] = tickets.map((ticket) => ({
    label: `#${ticket.id} ${ticket.subject}`,
    description: buildTicketDescription(ticket),
    detail: buildTicketDetail(ticket),
    ticket,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: "Search tickets",
    placeHolder: "Type an ID or title",
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) {
    return;
  }

  commentsProvider.setTicketId(picked.ticket.id);
  await showTicketPreview(picked.ticket);
};
