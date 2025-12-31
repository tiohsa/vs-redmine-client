export interface CommentEditState {
  commentId: number;
  ticketId: number;
  baseBody: string;
  draftBody?: string;
  lastSavedAt?: number;
  lastKnownRemoteUpdatedAt?: string;
}

const edits = new Map<number, CommentEditState>();

export const getCommentEdit = (commentId: number): CommentEditState | undefined =>
  edits.get(commentId);

export const initializeCommentEdit = (
  commentId: number,
  ticketId: number,
  body: string,
  remoteUpdatedAt?: string,
): CommentEditState => {
  const state: CommentEditState = {
    commentId,
    ticketId,
    baseBody: body,
    lastSavedAt: Date.now(),
    lastKnownRemoteUpdatedAt: remoteUpdatedAt,
  };
  edits.set(commentId, state);
  return state;
};

export const ensureCommentEdit = (
  commentId: number,
  ticketId: number,
  body: string,
  remoteUpdatedAt?: string,
): CommentEditState => {
  const state = edits.get(commentId);
  if (!state) {
    return initializeCommentEdit(commentId, ticketId, body, remoteUpdatedAt);
  }

  state.baseBody = body;
  state.ticketId = ticketId;
  if (remoteUpdatedAt) {
    state.lastKnownRemoteUpdatedAt = remoteUpdatedAt;
  }
  return state;
};

export const updateCommentEdit = (
  commentId: number,
  body: string,
  remoteUpdatedAt?: string,
): void => {
  const state = edits.get(commentId);
  if (!state) {
    return;
  }

  state.baseBody = body;
  state.lastSavedAt = Date.now();
  state.draftBody = undefined;
  if (remoteUpdatedAt) {
    state.lastKnownRemoteUpdatedAt = remoteUpdatedAt;
  }
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

