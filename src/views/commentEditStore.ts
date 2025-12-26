export interface CommentEditState {
  commentId: number;
  ticketId: number;
  baseBody: string;
  lastSavedAt?: number;
}

const edits = new Map<number, CommentEditState>();

export const getCommentEdit = (commentId: number): CommentEditState | undefined =>
  edits.get(commentId);

export const initializeCommentEdit = (
  commentId: number,
  ticketId: number,
  body: string,
): CommentEditState => {
  const state: CommentEditState = {
    commentId,
    ticketId,
    baseBody: body,
    lastSavedAt: Date.now(),
  };
  edits.set(commentId, state);
  return state;
};

export const updateCommentEdit = (commentId: number, body: string): void => {
  const state = edits.get(commentId);
  if (!state) {
    return;
  }

  state.baseBody = body;
  state.lastSavedAt = Date.now();
};

export const clearCommentEdit = (commentId: number): void => {
  edits.delete(commentId);
};

export const clearCommentEdits = (): void => {
  edits.clear();
};
