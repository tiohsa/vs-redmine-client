const drafts = new Map<number, string>();

export const getCommentDraft = (ticketId: number): string => drafts.get(ticketId) ?? "";

export const setCommentDraft = (ticketId: number, draft: string): void => {
  drafts.set(ticketId, draft);
};

export const clearCommentDraft = (ticketId: number): void => {
  drafts.delete(ticketId);
};

export const clearCommentDrafts = (): void => {
  drafts.clear();
};
