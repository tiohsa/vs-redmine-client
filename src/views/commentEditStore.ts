import { getCurrentConnectionScope } from "../config/connectionScope";

export interface CommentEditState {
  connectionScope: string;
  commentId: number;
  ticketId: number;
  baseBody: string;
  draftBody?: string;
  lastSavedAt?: number;
  lastKnownRemoteUpdatedAt?: string;
}

const edits = new Map<string, CommentEditState>();
const editKey = (connectionScope: string, commentId: number): string =>
  `${connectionScope}\u0000${commentId}`;

export const getCommentEdit = (
  commentId: number,
  connectionScope = getCurrentConnectionScope(),
): CommentEditState | undefined => edits.get(editKey(connectionScope, commentId));

export const initializeCommentEdit = (
  commentId: number,
  ticketId: number,
  body: string,
  remoteUpdatedAt?: string,
  connectionScope = getCurrentConnectionScope(),
): CommentEditState => {
  const state: CommentEditState = {
    connectionScope,
    commentId,
    ticketId,
    baseBody: body,
    lastSavedAt: Date.now(),
    lastKnownRemoteUpdatedAt: remoteUpdatedAt,
  };
  edits.set(editKey(connectionScope, commentId), state);
  return state;
};

export const ensureCommentEdit = (
  commentId: number,
  ticketId: number,
  body: string,
  remoteUpdatedAt?: string,
  connectionScope = getCurrentConnectionScope(),
): CommentEditState => {
  const state = getCommentEdit(commentId, connectionScope);
  if (!state) {
    return initializeCommentEdit(commentId, ticketId, body, remoteUpdatedAt, connectionScope);
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
  connectionScope = getCurrentConnectionScope(),
): void => {
  const state = getCommentEdit(commentId, connectionScope);
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

export const setCommentDraftBody = (
  commentId: number,
  body: string,
  connectionScope = getCurrentConnectionScope(),
): void => {
  const state = getCommentEdit(commentId, connectionScope);
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
  connectionScope = getCurrentConnectionScope(),
): { body: string; source: "draft" | "saved" } => {
  const state = getCommentEdit(commentId, connectionScope);
  if (state?.draftBody) {
    return { body: state.draftBody, source: "draft" };
  }

  return { body: savedBody, source: "saved" };
};

export const clearCommentEdit = (
  commentId: number,
  connectionScope = getCurrentConnectionScope(),
): void => {
  edits.delete(editKey(connectionScope, commentId));
};

export const clearCommentEdits = (): void => {
  edits.clear();
};
