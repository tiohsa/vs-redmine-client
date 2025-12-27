export interface CommentEditState {
  commentId: number;
  ticketId: number;
  baseBody: string;
  draftBody?: string;
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

export const ensureCommentEdit = (
  commentId: number,
  ticketId: number,
  body: string,
): CommentEditState => {
  const state = edits.get(commentId);
  if (!state) {
    return initializeCommentEdit(commentId, ticketId, body);
  }

  state.baseBody = body;
  state.ticketId = ticketId;
  return state;
};

export const updateCommentEdit = (commentId: number, body: string): void => {
  const state = edits.get(commentId);
  if (!state) {
    return;
  }

  state.baseBody = body;
  state.lastSavedAt = Date.now();
  state.draftBody = undefined;
};

export const setCommentDraftBody = (commentId: number, body: string): void => {
  const state = edits.get(commentId);
  if (!state) {
    return;
  }

  if (body.trim() === state.baseBody.trim()) {
    state.draftBody = undefined;
    return;
  }

  state.draftBody = body;
};

export const resolveCommentEditorBody = (
  commentId: number,
  savedBody: string,
): { body: string; source: "draft" | "saved" } => {
  const state = edits.get(commentId);
  if (state?.draftBody) {
    return { body: state.draftBody, source: "draft" };
  }

  return { body: savedBody, source: "saved" };
};

export const clearCommentEdit = (commentId: number): void => {
  edits.delete(commentId);
};

export const clearCommentEdits = (): void => {
  edits.clear();
};
