import * as path from "path";
import * as vscode from "vscode";
import {
  getCommentIdForDocument,
  getCommentIdForDraftUri,
  getCommentIdForUri,
  getEditorContentTypeForDocument,
  getEditorContentTypeForUri,
  getProjectIdForDocument,
  getProjectIdForUri,
  getTicketIdForDocument,
  getTicketIdForDraftUri,
  getTicketIdForUri,
  NEW_TICKET_DRAFT_ID,
} from "../views/ticketEditorRegistry";
import {
  isNewTicketDraftFilename,
  parseEditorFilename,
  parseNewCommentDraftFilename,
} from "../views/editorFilename";
import {
  isCommentUpdateFilename,
  parseCommentUpdateFile,
} from "../views/commentUpdateFile";

export type SaveSyncClassification =
  | { kind: "commentUpdateFile"; parsed: NonNullable<ReturnType<typeof parseCommentUpdateFile>> }
  | { kind: "localComment"; ticketId: number; commentId: number }
  | { kind: "newTicketDraftContent"; projectId?: number }
  | { kind: "existingTicket"; ticketId: number }
  | { kind: "existingDraftTicket"; ticketId: number }
  | { kind: "newTicketDraftEditor" }
  | { kind: "newTicketDraftContentFromFilename" }
  | { kind: "draftCommentExisting"; ticketId: number; commentId: number }
  | { kind: "draftCommentNew"; ticketId: number }
  | { kind: "parsedTicket"; ticketId: number }
  | { kind: "parsedComment"; ticketId: number; commentId: number }
  | { kind: "none" };

export const classifyDocumentSave = (
  document: vscode.TextDocument,
  editor: vscode.TextEditor | undefined,
): SaveSyncClassification => {
  const filename = path.basename(document.uri.path);

  if (isCommentUpdateFilename(filename)) {
    const parsed = parseCommentUpdateFile(document.getText());
    return parsed ? { kind: "commentUpdateFile", parsed } : { kind: "none" };
  }

  const commentIdForDocument =
    getCommentIdForDocument(document) ?? getCommentIdForUri(document.uri);
  if (commentIdForDocument) {
    const ticketIdForDocument =
      getTicketIdForDocument(document) ?? getTicketIdForUri(document.uri);
    if (!ticketIdForDocument) {
      return { kind: "none" };
    }
    return {
      kind: "localComment",
      ticketId: ticketIdForDocument,
      commentId: commentIdForDocument,
    };
  }

  const ticketIdForDocument =
    getTicketIdForDocument(document) ?? getTicketIdForUri(document.uri);
  const contentTypeForDocument =
    getEditorContentTypeForDocument(document) ??
    getEditorContentTypeForUri(document.uri);

  if (ticketIdForDocument && contentTypeForDocument === "ticket") {
    if (ticketIdForDocument === NEW_TICKET_DRAFT_ID) {
      const projectId =
        getProjectIdForDocument(document) ?? getProjectIdForUri(document.uri);
      return { kind: "newTicketDraftContent", projectId };
    }
    return { kind: "existingTicket", ticketId: ticketIdForDocument };
  }

  const parsed = parseEditorFilename(filename);
  if (parsed) {
    if (parsed.type === "ticket") {
      return { kind: "parsedTicket", ticketId: parsed.ticketId };
    }
    return {
      kind: "parsedComment",
      ticketId: parsed.ticketId,
      commentId: parsed.commentId,
    };
  }

  const draftTicketId = parseNewCommentDraftFilename(filename);
  if (draftTicketId) {
    const existingCommentId =
      getCommentIdForDocument(document) ??
      getCommentIdForUri(document.uri) ??
      getCommentIdForDraftUri(draftTicketId, document.uri.toString());

    if (existingCommentId) {
      return {
        kind: "draftCommentExisting",
        ticketId: draftTicketId,
        commentId: existingCommentId,
      };
    }

    return { kind: "draftCommentNew", ticketId: draftTicketId };
  }

  if (!isNewTicketDraftFilename(filename)) {
    return { kind: "none" };
  }

  const existingTicketId = getTicketIdForDraftUri(document.uri.toString());
  if (existingTicketId && existingTicketId !== NEW_TICKET_DRAFT_ID) {
    return { kind: "existingDraftTicket", ticketId: existingTicketId };
  }

  if (editor) {
    return { kind: "newTicketDraftEditor" };
  }

  return { kind: "newTicketDraftContentFromFilename" };
};
