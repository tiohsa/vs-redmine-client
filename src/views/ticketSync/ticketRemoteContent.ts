import type { Ticket } from "../../redmine/types";
import type { TicketEditorContent } from "../ticketEditorContent";
import type { IssueMetadata } from "../ticketMetadataTypes";

export const metadataFromTicket = (ticket: Ticket): IssueMetadata => ({
  tracker: ticket.trackerName ?? "",
  priority: ticket.priorityName ?? "",
  status: ticket.statusName ?? "",
  due_date: ticket.dueDate ?? "",
  start_date: ticket.startDate ?? "",
  parent: ticket.parentId,
  done_ratio: ticket.doneRatio,
  estimated_hours: ticket.estimatedHours,
  assignee: ticket.assigneeName,
  assignee_id: ticket.assigneeId,
});

export const editorContentFromTicket = (
  ticket: Ticket,
  base: Pick<TicketEditorContent, "layout" | "metadataBlock" | "controlFields"> = {},
): TicketEditorContent => ({
  subject: ticket.subject,
  description: ticket.description ?? "",
  metadata: metadataFromTicket(ticket),
  layout: base.layout,
  metadataBlock: base.metadataBlock,
  controlFields: base.controlFields,
});
