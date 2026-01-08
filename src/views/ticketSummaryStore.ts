import { Ticket } from "../redmine/types";

const summaries = new Map<number, string>();

export const rememberTicketSummary = (ticket: Ticket): void => {
  if (!ticket.subject) {
    return;
  }
  summaries.set(ticket.id, ticket.subject);
};

export const rememberTicketSummaries = (tickets: Ticket[]): void => {
  tickets.forEach((ticket) => {
    rememberTicketSummary(ticket);
  });
};

export const setTicketSummary = (ticketId: number, subject: string): void => {
  if (!subject) {
    return;
  }
  summaries.set(ticketId, subject);
};

export const getTicketSummary = (ticketId: number): string | undefined =>
  summaries.get(ticketId);

export const clearTicketSummaries = (): void => {
  summaries.clear();
};
