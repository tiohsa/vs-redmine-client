import { buildNewChildTicketDraftContent } from "../views/ticketDraftStore";
import { TicketTreeItem } from "../views/ticketsView";
import { showError } from "../utils/notifications";
import { openNewTicketDraft } from "./createTicketFromList";

export const createChildTicketFromList = async (
  item?: TicketTreeItem,
): Promise<void> => {
  if (!item || !(item instanceof TicketTreeItem)) {
    showError("Parent ticket is not available.");
    return;
  }

  const parentId = item.ticket.id;
  const projectId = item.ticket.projectId;
  if (!parentId || !projectId) {
    showError("Parent ticket is missing required information.");
    return;
  }

  await openNewTicketDraft({
    content: buildNewChildTicketDraftContent(item.ticket),
    projectId,
  });
};
