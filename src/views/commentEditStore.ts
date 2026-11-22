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

export interface CommentEditingEntry {
  connectionScope: string;
  ticketId: number;
  commentId: number;
  body: string;
}

const edits = new Map<string, CommentEditState>();
const activeEditingComments = new Map<string, CommentEditingEntry>();
const editKey = (connectionScope: string, commentId: number): string =>
  `${connectionScope}\u0000${commentId}`;
const editingKey = (
  connectionScope: string,
  ticketId: number,
  commentId: number,
): string => `${connectionScope}\u0000${ticketId}\u0000${commentId}`;

export const getCommentEdit = (
  commentId: number,
  connectionScope = getCurrentConnectionScope(),
): CommentEditState | undefined => edits.get(editKey(connectionScope, commentId));

export const getCommentEditDrafts = (connectionScope: string): CommentEditState[] =>
  Array.from(edits.values()).filter(edit => edit.connectionScope === connectionScope && edit.draftBody !== undefined);

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
  activeEditingComments.delete(editingKey(connectionScope, state.ticketId, commentId));
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

export const setCommentEditingState = (
  ticketId: number,
  commentId: number,
  isEditing: boolean,
  body = "",
  connectionScope = getCurrentConnectionScope(),
): boolean => {
  const key = editingKey(connectionScope, ticketId, commentId);
  const existing = activeEditingComments.get(key);
  if (!isEditing) {
    if (!existing) {
      return false;
    }
    activeEditingComments.delete(key);
    return true;
  }
  activeEditingComments.set(key, {
    connectionScope,
    ticketId,
    commentId,
    body,
  });
  return !existing;
};

export const getCommentEditingEntry = (
  ticketId: number,
  commentId: number,
  connectionScope = getCurrentConnectionScope(),
): CommentEditingEntry | undefined =>
  activeEditingComments.get(editingKey(connectionScope, ticketId, commentId));

export const isCommentEditing = (
  ticketId: number,
  commentId: number,
  connectionScope = getCurrentConnectionScope(),
  queuedBody?: string,
): boolean => {
  const entry = getCommentEditingEntry(ticketId, commentId, connectionScope);
  if (!entry) {
    return false;
  }
  if (queuedBody !== undefined && entry.body === queuedBody) {
    return false;
  }
  return true;
};

export const clearCommentEdit = (
  commentId: number,
  connectionScope = getCurrentConnectionScope(),
): void => {
  const state = edits.get(editKey(connectionScope, commentId));
  if (state) {
    activeEditingComments.delete(editingKey(connectionScope, state.ticketId, commentId));
  } else {
    for (const [key, entry] of activeEditingComments.entries()) {
      if (entry.connectionScope === connectionScope && entry.commentId === commentId) {
        activeEditingComments.delete(key);
      }
    }
  }
  edits.delete(editKey(connectionScope, commentId));
};

export const discardCommentEditDraft = (
  commentId: number,
  connectionScope = getCurrentConnectionScope(),
): void => {
  const key = editKey(connectionScope, commentId);
  const state = edits.get(key);
  if (!state) { return; }
  state.draftBody = undefined;
  activeEditingComments.delete(editingKey(connectionScope, state.ticketId, commentId));
};

export const clearCommentEdits = (): void => {
  edits.clear();
  activeEditingComments.clear();
};
