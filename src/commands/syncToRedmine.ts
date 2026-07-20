import * as vscode from "vscode";
import {
  getCommentIdForEditor,
  getEditorContentType,
  getConnectionScopeForEditor,
  getTicketIdForEditor,
  isTicketEditor,
  NEW_TICKET_DRAFT_ID,
} from "../views/ticketEditorRegistry";
import {
  removeOfflineTicketUpdate,
  removeOfflineNewTicket,
  removeOfflineCommentEntry,
} from "../views/offlineSyncStore";
import { markDraftStatus } from "../views/ticketDraftStore";
import {
  syncNewTicketDraft,
  syncTicketDraft,
  TicketSaveDependencies,
} from "../views/ticketSaveSync";
import {
  finalizeNewCommentDraftDocument,
  shouldRefreshComments,
  syncCommentDraft,
  syncNewCommentDraft,
} from "../views/commentSaveSync";
import { TicketSaveResult } from "../views/ticketSaveTypes";
import { CommentSaveResult } from "../views/commentSaveTypes";
import {
  CONNECTION_SCOPE_MISMATCH_MESSAGE,
  getCurrentConnectionScope,
} from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";
import { showError } from "../utils/notifications";

export { CONNECTION_SCOPE_MISMATCH_MESSAGE } from "../config/connectionScope";

export type SyncToRedmineResult =
  | { kind: "ticket"; result: TicketSaveResult }
  | { kind: "comment"; result: CommentSaveResult; ticketId: number }
  | undefined;

export interface SyncToRedmineOptions {
  onSubjectUpdated?: (ticketId: number, subject: string) => void;
  onTicketCreated?: () => void;
  onCommentsRefresh?: (ticketId: number) => void;
  deps?: Partial<TicketSaveDependencies>;
}

export const syncEditorToRedmine = async (
  editor: vscode.TextEditor,
  options: SyncToRedmineOptions = {},
): Promise<SyncToRedmineResult> => {
  const operationScope = getConnectionScopeForEditor(editor);
  if (operationScope === undefined) {
    return undefined;
  }
  if (operationScope !== getCurrentConnectionScope()) {
    showError(CONNECTION_SCOPE_MISMATCH_MESSAGE);
    return undefined;
  }
  return runWithConnectionScope(
    operationScope,
    () => syncEditorToRedmineAtScope(editor, options, operationScope),
  );
};

const syncEditorToRedmineAtScope = async (
  editor: vscode.TextEditor,
  options: SyncToRedmineOptions,
  operationScope: string,
): Promise<SyncToRedmineResult> => {
  if (!isTicketEditor(editor)) {
    return undefined;
  }

  const contentType = getEditorContentType(editor);
  const ticketId = getTicketIdForEditor(editor);
  if (!ticketId) {
    return undefined;
  }

  if (ticketId === NEW_TICKET_DRAFT_ID) {
    const result = await syncNewTicketDraft({
      editor,
      deps: options.deps,
      operationScope,
    });
    if (result.status === "created") {
      options.onTicketCreated?.();
      removeOfflineNewTicket({ documentUri: editor.document.uri.toString() }, operationScope);
    }
    return { kind: "ticket", result };
  }

  if (contentType === "ticket") {
    markDraftStatus(ticketId, "Syncing", operationScope);
    let result: TicketSaveResult;
    try {
      result = await syncTicketDraft({
        ticketId,
        content: editor.document.getText(),
        editor,
        deps: options.deps,
        onSubjectUpdated: options.onSubjectUpdated,
        operationScope,
      });
    } catch (error) {
      markDraftStatus(ticketId, "Failed", operationScope);
      throw error;
    }
    if (result.status === "no_change" || result.status === "success") {
      markDraftStatus(ticketId, "Synced", operationScope);
      removeOfflineTicketUpdate(ticketId, operationScope);
    } else if (result.status !== "conflict" && result.status !== "queued") {
      markDraftStatus(ticketId, "Failed", operationScope);
    }
    return { kind: "ticket", result };
  }

  if (contentType === "commentDraft") {
    const result = await syncNewCommentDraft({
      ticketId,
      content: editor.document.getText(),
      editor,
      documentUri: editor.document.uri,
      onCreated: async ({ commentId, projectId }) => {
        finalizeNewCommentDraftDocument({
          document: editor.document,
          ticketId,
          projectId,
          commentId,
          operationScope,
        });
      },
      operationScope,
    });
    if (shouldRefreshComments(result.status)) {
      options.onCommentsRefresh?.(ticketId);
    }
    if (result.status === "created" || result.status === "no_change") {
      removeOfflineCommentEntry({ documentUri: editor.document.uri.toString() }, operationScope);
    }
    return { kind: "comment", result, ticketId };
  }

  if (contentType === "comment") {
    const commentId = getCommentIdForEditor(editor);
    if (!commentId) {
      return undefined;
    }
    const result = await syncCommentDraft({
      commentId,
      content: editor.document.getText(),
      editor,
      documentUri: editor.document.uri,
      operationScope,
    });
    if (shouldRefreshComments(result.status)) {
      options.onCommentsRefresh?.(ticketId);
    }
    if (result.status === "success" || result.status === "no_change") {
      removeOfflineCommentEntry(
        { commentId, documentUri: editor.document.uri.toString() },
        operationScope,
      );
    }
    return { kind: "comment", result, ticketId };
  }

  return undefined;
};
