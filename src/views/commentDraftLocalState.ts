import * as vscode from "vscode";
import { resolveEditorBaseDir } from "../utils/editorBaseDir";
import {
  getCommentIdForEditor,
  getEditorContentType,
  getTicketIdForEditor,
  isTicketEditor,
  registerCommentDocument,
  setEditorCommentId,
  setEditorContentType,
  setEditorProjectId,
} from "./ticketEditorRegistry";
import { ensureCommentEdit, getCommentEdit } from "./commentEditStore";
import { CommentSaveResult } from "./commentSaveTypes";
import { addOfflineCommentUpdateAsync, getActiveScope, getOfflineSyncQueue, isAbandoned } from "./offlineSyncStore";
import { setCommentDraft } from "./commentDraftStore";
import {
  extractCommentBody,
  invalidCommentUpdateMetadataMessage,
  hasInvalidCommentUpdateMetadata,
  parseCommentUpdateFile,
} from "./commentUpdateFile";

import { type CommentSaveDependencies } from "./commentSyncDependencies";
import { buildResult } from "./commentSyncResult";

export const hasAbandonedComment = (ticketId: number, commentId: number | undefined, documentUri: string | undefined, scope?: string): boolean =>
  getOfflineSyncQueue(scope ?? getActiveScope()).comments.some((entry) =>
    isAbandoned(entry) && entry.ticketId === ticketId && (
      (commentId !== undefined && entry.commentId === commentId) ||
      (documentUri !== undefined && entry.documentUri === documentUri)));

export const abandonedCommentResult = (): CommentSaveResult =>
  buildResult("failed", vscode.l10n.t("Sync was abandoned for this comment draft. Review the retained record before sending it again."));

export const finalizeNewCommentDraftState = (input: {
  operationScope?: string;
  editor: vscode.TextEditor;
  ticketId: number;
  projectId: number;
  commentId: number;
}): void => {
  setEditorContentType(input.editor, "comment");
  setEditorProjectId(input.editor, input.projectId);
  setEditorCommentId(input.editor, input.commentId);
  ensureCommentEdit(
    input.commentId,
    input.ticketId,
    extractCommentBody(input.editor.document.getText()),
    undefined,
    input.operationScope,
  );
};

export const finalizeNewCommentDraftDocument = (input: {
  operationScope?: string;
  document: vscode.TextDocument;
  ticketId: number;
  projectId: number;
  commentId: number;
  body?: string;
}): void => {
  registerCommentDocument(
    input.ticketId,
    input.commentId,
    input.document,
    input.projectId,
    input.operationScope,
  );
  ensureCommentEdit(
    input.commentId,
    input.ticketId,
    input.body ?? extractCommentBody(input.document.getText()),
    undefined,
    input.operationScope,
  );
};

export const saveCommentDraftLocally = async (
  editor: vscode.TextEditor,
  operationScope?: string,
): Promise<CommentSaveResult | undefined> => {
  if (!isTicketEditor(editor)) { return undefined; }
  const contentType = getEditorContentType(editor);
  if (contentType !== "comment" && contentType !== "commentDraft") { return undefined; }
  const ticketId = getTicketIdForEditor(editor);
  if (!ticketId) { return undefined; }
  const documentContent = editor.document.getText();
  const parsedCommentUpdate = parseCommentUpdateFile(documentContent);
  const commentId = getCommentIdForEditor(editor);
  if (hasAbandonedComment(ticketId, commentId, editor.document.uri.toString(), operationScope)) {
    return abandonedCommentResult();
  }
  if (hasInvalidCommentUpdateMetadata(parsedCommentUpdate, documentContent, editor.document.uri.path, {
    issueId: ticketId,
    journalId: commentId,
  })) {
    return buildResult("failed", invalidCommentUpdateMetadataMessage());
  }
  const body = extractCommentBody(documentContent);
  setCommentDraft(ticketId, body, operationScope);
  const edit = commentId === undefined
    ? undefined
    : getCommentEdit(commentId, operationScope);
  await addOfflineCommentUpdateAsync({
    ticketId,
    commentId,
    baseBody: edit?.baseBody,
    lastKnownRemoteUpdatedAt: edit?.lastKnownRemoteUpdatedAt,
    body,
    sourceNotesHash: parsedCommentUpdate?.fields.sourceNotesHash,
    baseDir: resolveEditorBaseDir({ editor }),
    documentUri: editor.document.uri.toString(),
    finalizeDraft: contentType === "commentDraft",
  }, operationScope);
  return buildResult("queued", vscode.l10n.t("Saved locally. Run a sync command to apply changes to Redmine."));
};

export const saveCommentDocumentLocally = async (input: {
  operationScope?: string;
  ticketId: number;
  commentId?: number;
  content: string;
  documentUri: vscode.Uri;
}): Promise<CommentSaveResult> => {
  if (hasAbandonedComment(input.ticketId, input.commentId, input.documentUri.toString(), input.operationScope)) {
    return abandonedCommentResult();
  }
  const parsedCommentUpdate = parseCommentUpdateFile(input.content);
  if (hasInvalidCommentUpdateMetadata(parsedCommentUpdate, input.content, input.documentUri.path, {
    issueId: input.ticketId,
    journalId: input.commentId,
  })) {
    return buildResult("failed", invalidCommentUpdateMetadataMessage());
  }
  const body = extractCommentBody(input.content);
  await addOfflineCommentUpdateAsync({
    ticketId: input.ticketId,
    commentId: input.commentId,
    body,
    sourceNotesHash: parsedCommentUpdate?.fields.sourceNotesHash,
    baseDir: resolveEditorBaseDir({ documentUri: input.documentUri }),
    documentUri: input.documentUri.toString(),
  }, input.operationScope);
  return buildResult("queued", vscode.l10n.t("Saved locally. Run a sync command to apply changes to Redmine."));
};

export const handleCommentEditorSave = async (
  editor: vscode.TextEditor,
  _deps?: Partial<CommentSaveDependencies>,
  operationScope?: string,
): Promise<CommentSaveResult | undefined> => {
  return saveCommentDraftLocally(editor, operationScope);
};
