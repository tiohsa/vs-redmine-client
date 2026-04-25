import * as vscode from "vscode";
import {
  getCommentIdForEditor,
  getEditorContentType,
  getTicketIdForEditor,
  isTicketEditor,
  NEW_TICKET_DRAFT_ID,
} from "../views/ticketEditorRegistry";
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
  if (!isTicketEditor(editor)) {
    return undefined;
  }

  const contentType = getEditorContentType(editor);
  const ticketId = getTicketIdForEditor(editor);
  if (!ticketId) {
    return undefined;
  }

  if (ticketId === NEW_TICKET_DRAFT_ID) {
    const result = await syncNewTicketDraft({ editor, deps: options.deps });
    if (result.status === "created") {
      options.onTicketCreated?.();
    }
    return { kind: "ticket", result };
  }

  if (contentType === "ticket") {
    markDraftStatus(ticketId, "Syncing");
    const result = await syncTicketDraft({
      ticketId,
      content: editor.document.getText(),
      editor,
      deps: options.deps,
      onSubjectUpdated: options.onSubjectUpdated,
    });
    if (result.status !== "success" && result.status !== "no_change" && result.status !== "conflict") {
      markDraftStatus(ticketId, "Failed");
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
        });
      },
    });
    if (shouldRefreshComments(result.status)) {
      options.onCommentsRefresh?.(ticketId);
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
    });
    if (shouldRefreshComments(result.status)) {
      options.onCommentsRefresh?.(ticketId);
    }
    return { kind: "comment", result, ticketId };
  }

  return undefined;
};
