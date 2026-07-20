export type CommentDraftStatus = "Draft" | "Syncing" | "Synced" | "Failed";

export interface CommentDraftState {
  body: string;
  status: CommentDraftStatus;
  postedCommentId?: number;
}

const drafts = new Map<string, CommentDraftState>();
const draftKey = (scope: string, ticketId: number): string => `${scope}\u0000${ticketId}`;

export const getCommentDraftState = (
  ticketId: number,
  scope = getCurrentConnectionScope(),
): CommentDraftState | undefined => drafts.get(draftKey(scope, ticketId));

export const getCommentDraft = (
  ticketId: number,
  scope = getCurrentConnectionScope(),
): string => drafts.get(draftKey(scope, ticketId))?.body ?? "";

export const setCommentDraft = (
  ticketId: number,
  draft: string,
  scope = getCurrentConnectionScope(),
): void => {
  const key = draftKey(scope, ticketId);
  const existing = drafts.get(key);
  drafts.set(key, {
    body: draft,
    status: existing?.status ?? "Draft",
    postedCommentId: existing?.postedCommentId,
  });
};

export const setCommentDraftStatus = (
  ticketId: number,
  status: CommentDraftStatus,
  scope = getCurrentConnectionScope(),
): void => {
  const key = draftKey(scope, ticketId);
  const existing = drafts.get(key);
  if (!existing) { return; }
  drafts.set(key, { ...existing, status });
};

export const markCommentDraftPosted = (
  ticketId: number,
  commentId: number,
  scope = getCurrentConnectionScope(),
): void => {
  const key = draftKey(scope, ticketId);
  const existing = drafts.get(key);
  if (!existing) { return; }
  drafts.set(key, { ...existing, status: "Synced", postedCommentId: commentId });
};

export const clearCommentDraft = (
  ticketId: number,
  scope = getCurrentConnectionScope(),
): void => {
  drafts.delete(draftKey(scope, ticketId));
};

export const clearCommentDrafts = (): void => {
  drafts.clear();
};
import { getCurrentConnectionScope } from "../config/connectionScope";
