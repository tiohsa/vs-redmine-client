export type CommentDraftStatus = "Draft" | "Syncing" | "Synced" | "Failed";

export interface CommentDraftState {
  body: string;
  status: CommentDraftStatus;
  postedCommentId?: number;
}

const drafts = new Map<number, CommentDraftState>();

export const getCommentDraftState = (ticketId: number): CommentDraftState | undefined =>
  drafts.get(ticketId);

export const getCommentDraft = (ticketId: number): string =>
  drafts.get(ticketId)?.body ?? "";

export const setCommentDraft = (ticketId: number, draft: string): void => {
  const existing = drafts.get(ticketId);
  drafts.set(ticketId, {
    body: draft,
    status: existing?.status ?? "Draft",
    postedCommentId: existing?.postedCommentId,
  });
};

export const setCommentDraftStatus = (ticketId: number, status: CommentDraftStatus): void => {
  const existing = drafts.get(ticketId);
  if (!existing) { return; }
  drafts.set(ticketId, { ...existing, status });
};

export const markCommentDraftPosted = (ticketId: number, commentId: number): void => {
  const existing = drafts.get(ticketId);
  if (!existing) { return; }
  drafts.set(ticketId, { ...existing, status: "Synced", postedCommentId: commentId });
};

export const clearCommentDraft = (ticketId: number): void => {
  drafts.delete(ticketId);
};

export const clearCommentDrafts = (): void => {
  drafts.clear();
};
