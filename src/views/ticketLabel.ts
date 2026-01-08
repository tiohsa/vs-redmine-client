import { getTicketDraft } from "./ticketDraftStore";
import { NEW_TICKET_DRAFT_ID } from "./ticketEditorRegistry";
import { getTicketSummary } from "./ticketSummaryStore";

export const resolveTicketSubject = (ticketId: number): string | undefined => {
  if (ticketId === NEW_TICKET_DRAFT_ID) {
    return undefined;
  }

  const draft = getTicketDraft(ticketId);
  if (draft?.draftSubject) {
    return draft.draftSubject;
  }
  if (draft?.baseSubject) {
    return draft.baseSubject;
  }

  return getTicketSummary(ticketId);
};

export const formatTicketLabel = (ticketId: number): string => {
  if (ticketId === NEW_TICKET_DRAFT_ID) {
    return "New ticket (draft)";
  }

  const subject = resolveTicketSubject(ticketId);
  if (subject) {
    return `#${ticketId} ${subject}`;
  }
  return `#${ticketId}`;
};
