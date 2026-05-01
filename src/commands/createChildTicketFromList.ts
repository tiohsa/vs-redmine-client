import {
  buildNewChildTicketDraftContent,
  buildNewTicketDraftContent,
} from "../views/ticketDraftStore";
import { Ticket } from "../redmine/types";
import { showError } from "../utils/notifications";
import { openNewTicketDraft } from "./createTicketFromList";

export const createChildTicketFromList = async (
  ticket?: Ticket,
): Promise<void> => {
  if (!ticket) {
    showError("Parent ticket is not available.");
    return;
  }

  const parentId = ticket.id;
  const projectId = ticket.projectId;
  if (!parentId || !projectId) {
    showError("Parent ticket is missing required information.");
    return;
  }

  await openNewTicketDraft({
    content: buildNewChildTicketDraftContent(
      ticket,
      buildNewTicketDraftContent({ projectId }),
    ),
    projectId,
  });
};
