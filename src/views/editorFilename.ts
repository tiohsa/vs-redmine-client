import { COMMENT_TYPE_LABEL } from "./commentSaveTypes";
import { TicketEditorKind } from "./ticketEditorTypes";

const sanitizeId = (value: number): string => String(value);
const ticketPattern = /^project-(\d+)_ticket-(\d+)(?:_extra)?(?:-\d+)?\.md$/;
const commentPattern = new RegExp(
  `^project-(\\d+)_ticket-(\\d+)_${COMMENT_TYPE_LABEL}-(\\d+)(?:-\\d+)?\\.md$`,
);
const newCommentDraftPattern = /^todoex-new-comment-(\d+)(?:-\d+)?\.md$/;
const newTicketDraftPattern = /^todoex-new-ticket(?:-\d+)?\.md$/;

export type ParsedEditorFilename =
  | {
      type: "ticket";
      projectId: number;
      ticketId: number;
    }
  | {
      type: "comment";
      projectId: number;
      ticketId: number;
      commentId: number;
    };

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
  `project-${sanitizeId(projectId)}_ticket-${sanitizeId(ticketId)}_${COMMENT_TYPE_LABEL}-${sanitizeId(commentId)}.md`;

export const parseEditorFilename = (
  filename: string,
): ParsedEditorFilename | undefined => {
  const commentMatch = filename.match(commentPattern);
  if (commentMatch) {
    return {
      type: "comment",
      projectId: Number(commentMatch[1]),
      ticketId: Number(commentMatch[2]),
      commentId: Number(commentMatch[3]),
    };
  }

  const ticketMatch = filename.match(ticketPattern);
  if (ticketMatch) {
    return {
      type: "ticket",
      projectId: Number(ticketMatch[1]),
      ticketId: Number(ticketMatch[2]),
    };
  }

  return undefined;
};

export const parseNewCommentDraftFilename = (filename: string): number | undefined => {
  const match = filename.match(newCommentDraftPattern);
  if (!match) {
    return undefined;
  }

  return Number(match[1]);
};

export const isNewTicketDraftFilename = (filename: string): boolean =>
  newTicketDraftPattern.test(filename);
