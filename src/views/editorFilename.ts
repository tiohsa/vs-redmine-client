import { TicketEditorKind } from "./ticketEditorTypes";

const sanitizeId = (value: number): string => String(value);

export const buildTicketEditorFilename = (
  projectId: number,
  ticketId: number,
  kind: TicketEditorKind = "primary",
): string => {
  const suffix = kind === "extra" ? "_extra" : "";
  return `project-${sanitizeId(projectId)}_ticket-${sanitizeId(ticketId)}${suffix}.md`;
};

export const buildCommentEditorFilename = (
  projectId: number,
  ticketId: number,
  commentId: number,
): string =>
  `project-${sanitizeId(projectId)}_ticket-${sanitizeId(ticketId)}_comment-${sanitizeId(commentId)}.md`;
