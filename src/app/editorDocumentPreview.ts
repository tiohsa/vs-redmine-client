import * as vscode from "vscode";
import { getCommentEdit, isCommentEditing, setCommentEditingState } from "../views/commentEditStore";
import { getTicketDraft, getTicketDraftContent, markDraftStatus, setTicketDraftContent } from "../views/ticketDraftStore";
import { isSaveSyncSuppressed } from "../views/saveSyncSuppression";
import {
  detectTicketChanges,
  detectTicketIntentChanges,
  isSafeQueuedTicketUpdate,
  parseQueuedTicketIntent,
} from "../views/ticketSync/ticketChangeDetector";
import { getOfflineSyncQueue, isAbandoned } from "../views/offlineSyncStore";
import {
  getCommentIdForDocument,
  getConnectionScopeForDocument,
  getEditorContentTypeForDocument,
  getTicketIdForDocument,
  NEW_TICKET_DRAFT_ID,
} from "../views/ticketEditorRegistry";
import { extractCommentBody, parseCommentUpdateFile } from "../views/commentUpdateFile";
import { computeNotesHash } from "../utils/notesHash";
import { parseTicketEditorContent } from "../views/ticketEditorContent";

export const updateTicketDraftStatusFromDocument = (
  document: vscode.TextDocument,
): boolean => {
  if (isSaveSyncSuppressed(document.uri.toString())) {
    return false;
  }

  const ticketId = getTicketIdForDocument(document);
  if (
    ticketId === undefined ||
    getEditorContentTypeForDocument(document) !== "ticket"
  ) {
    return false;
  }

  if (ticketId === NEW_TICKET_DRAFT_ID) {
    return true;
  }

  const connectionScope = getConnectionScopeForDocument(document);
  const draft = getTicketDraft(ticketId, connectionScope);
  if (!draft) {
    return false;
  }
  if (draft.status !== "Synced" && draft.status !== "Dirty" && draft.status !== "Queued") {
    return false;
  }

  const prevDisplay = getTicketDraftContent(ticketId, connectionScope);
  const prevSubject = prevDisplay?.subject ?? draft.baseSubject;
  const prevMeta = prevDisplay?.metadata ?? draft.baseMetadata;

  let nextStatus: "Synced" | "Dirty" | "Queued" = "Dirty";
  let displayChanged = false;
  try {
    const content = parseTicketEditorContent(document.getText(), {
      allowMissingMetadata: true,
      fallbackMetadata: draft.baseMetadata,
    });
    const queued = getOfflineSyncQueue(connectionScope).tickets.get(ticketId);
    if (queued && isSafeQueuedTicketUpdate(queued)) {
      const queuedContent = parseQueuedTicketIntent(queued);
      nextStatus = queuedContent && !detectTicketIntentChanges({
        subject: queuedContent.subject,
        description: queuedContent.description,
        metadata: queuedContent.metadata,
      }, content).hasChanges
        ? "Queued"
        : "Dirty";
    } else {
      nextStatus = detectTicketChanges(draft, content).hasChanges ? "Dirty" : "Synced";
    }
    setTicketDraftContent(ticketId, content, connectionScope);
    const nextDisplay = getTicketDraftContent(ticketId, connectionScope);
    const nextSubject = nextDisplay?.subject ?? draft.baseSubject;
    const prevDescription = prevDisplay?.description ?? draft.baseDescription;
    const nextDescription = nextDisplay?.description ?? draft.baseDescription;
    const nextMeta = nextDisplay?.metadata ?? draft.baseMetadata;
    displayChanged =
      prevSubject !== nextSubject ||
      prevDescription !== nextDescription ||
      prevMeta.tracker !== nextMeta.tracker ||
      prevMeta.status !== nextMeta.status ||
      prevMeta.priority !== nextMeta.priority ||
      (prevMeta.assignee ?? "") !== (nextMeta.assignee ?? "") ||
      (prevMeta.start_date ?? "") !== (nextMeta.start_date ?? "") ||
      (prevMeta.due_date ?? "") !== (nextMeta.due_date ?? "") ||
      (prevMeta.done_ratio ?? 0) !== (nextMeta.done_ratio ?? 0);
  } catch {
    // Parse errors are still unsynced editor changes.
  }

  const statusChanged = draft.status !== nextStatus;
  if (statusChanged) {
    markDraftStatus(ticketId, nextStatus, connectionScope);
  }
  return statusChanged || displayChanged;
};

export const updateCommentEditingStatusFromDocument = (
  document: vscode.TextDocument,
): boolean => {
  if (isSaveSyncSuppressed(document.uri.toString())) {
    return false;
  }

  const contentType = getEditorContentTypeForDocument(document);
  if (contentType !== "comment") {
    return false;
  }

  const ticketId = getTicketIdForDocument(document);
  const commentId = getCommentIdForDocument(document);
  if (ticketId === undefined || commentId === undefined) {
    return false;
  }

  const connectionScope = getConnectionScopeForDocument(document);
  const text = document.getText();
  const parsed = parseCommentUpdateFile(text);
  const currentBody = parsed ? parsed.body : extractCommentBody(text);
  const activeQueuedEntry = getOfflineSyncQueue(connectionScope).comments.find(
    (entry) =>
      entry.ticketId === ticketId &&
      entry.commentId === commentId &&
      !isAbandoned(entry),
  );

  let isEditing = false;
  if (activeQueuedEntry) {
    isEditing = currentBody !== activeQueuedEntry.body;
  } else if (parsed?.fields.sourceNotesHash) {
    isEditing = computeNotesHash(currentBody) !== parsed.fields.sourceNotesHash;
  } else {
    const editState = getCommentEdit(commentId, connectionScope);
    if (editState) {
      isEditing = currentBody !== editState.baseBody;
    }
  }

  const wasEditing = isCommentEditing(
    ticketId,
    commentId,
    connectionScope,
    activeQueuedEntry?.body,
  );
  setCommentEditingState(ticketId, commentId, isEditing, currentBody, connectionScope);
  return wasEditing !== isEditing;
};

export const clearCommentEditingFromDocument = (
  document: vscode.TextDocument,
): boolean => {
  if (getEditorContentTypeForDocument(document) !== "comment") {
    return false;
  }
  const ticketId = getTicketIdForDocument(document);
  const commentId = getCommentIdForDocument(document);
  if (ticketId === undefined || commentId === undefined) {
    return false;
  }
  const connectionScope = getConnectionScopeForDocument(document);
  return setCommentEditingState(ticketId, commentId, false, "", connectionScope);
};
