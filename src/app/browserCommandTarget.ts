import * as path from "node:path";
import type * as vscode from "vscode";
import type { DashboardState } from "../dashboard/dashboardProtocol";
import { parseCommentUpdateFilename } from "../views/commentUpdateFile";
import {
  isNewTicketDraftFilename,
  parseDirectTicketFilename,
  parseEditorFilename,
  parseNewCommentDraftFilename,
} from "../views/editorFilename";
import {
  getCommentIdForEditor,
  getCommentIdForUri,
  getConnectionScopeForEditor,
  getConnectionScopeForUri,
  getTicketIdForEditor,
  getTicketIdForUri,
  NEW_TICKET_DRAFT_ID,
  resolveEditorConnectionScope,
} from "../views/ticketEditorRegistry";

export interface EditorBrowserTarget {
  ticketId: number;
  commentId?: number;
  connectionScope: string;
}

export function browserTargetForUri(uri: vscode.Uri, scope: string): EditorBrowserTarget | undefined {
  const connectionScope = getConnectionScopeForUri(uri) ?? resolveEditorConnectionScope(uri, scope, { requireStoredScope: true });
  const registeredId = getTicketIdForUri(uri);
  if (registeredId !== undefined) {
    return { ticketId: registeredId, commentId: getCommentIdForUri(uri), connectionScope };
  }
  if (uri.scheme !== "file" && uri.scheme !== "untitled") {
    return undefined;
  }
  const filename = path.basename(uri.path);
  if (isNewTicketDraftFilename(filename)) {
    return { ticketId: NEW_TICKET_DRAFT_ID, connectionScope };
  }
  const parsed = parseEditorFilename(filename);
  if (parsed) {
    return { ticketId: parsed.ticketId, commentId: parsed.type === "comment" ? parsed.commentId : undefined, connectionScope };
  }
  const comment = parseCommentUpdateFilename(filename.replace(/^redmine-client-[a-f0-9]{16}-/i, "redmine-client-"));
  if (comment) {
    return { ticketId: comment.issueId, commentId: comment.journalId, connectionScope };
  }
  const ticketId = parseDirectTicketFilename(filename) ?? parseNewCommentDraftFilename(filename);
  return ticketId === undefined ? undefined : { ticketId, connectionScope };
}

export function browserTargetForEditor(editor: vscode.TextEditor | undefined, scope: string): EditorBrowserTarget | undefined {
  if (!editor) {
    return undefined;
  }
  const ticketId = getTicketIdForEditor(editor);
  if (ticketId === undefined) {
    return browserTargetForUri(editor.document.uri, scope);
  }
  return {
    ticketId,
    commentId: getCommentIdForEditor(editor),
    connectionScope: getConnectionScopeForEditor(editor) ?? resolveEditorConnectionScope(editor.document.uri, scope),
  };
}

export function browserTargetForDashboard(state: DashboardState): { ticketId: number; commentId?: number } | undefined {
  const ticketId = state.selectedTicketId;
  if (!ticketId) {
    return undefined;
  }
  return {
    ticketId,
    commentId: state.comments.ticketId === ticketId ? state.comments.selectedCommentId : undefined,
  };
}
