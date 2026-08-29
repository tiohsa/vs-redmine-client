import * as vscode from "vscode";
import {
  getCommentIdForEditor,
  getEditorContentType,
  getConnectionScopeForEditor,
  getTicketIdForEditor,
  isTicketEditor,
  NEW_TICKET_DRAFT_ID,
} from "../views/ticketEditorRegistry";
import { getTicketDraft, markDraftStatus } from "../views/ticketDraftStore";
import { TicketSaveDependencies } from "../views/ticketSaveSync";
import {
  saveCommentDraftLocally,
} from "../views/commentSaveSync";
import { TicketSaveResult } from "../views/ticketSaveTypes";
import { CommentSaveResult } from "../views/commentSaveTypes";
import type { CommentSaveDependencies } from "../views/commentSaveSync";
import {
  CONNECTION_SCOPE_MISMATCH_MESSAGE,
  getCurrentConnectionScope,
} from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";
import { showError } from "../utils/notifications";
import { getOfflineSyncMode } from "../config/settings";
import {
  createSyncEngine,
  createTicketSyncService,
  ticketSyncOutcomeToSaveResult,
  type SyncEngine,
  type SyncEngineOutcome,
} from "../app/ticketSync";
import type { RewriteDocumentDeps } from "../views/editorDocumentRewrite";

export { CONNECTION_SCOPE_MISMATCH_MESSAGE } from "../config/connectionScope";

export type SyncToRedmineResult =
  | { kind: "ticket"; result: TicketSaveResult }
  | { kind: "comment"; result: CommentSaveResult; ticketId: number }
  | undefined;

export interface SyncToRedmineOptions {
  onSubjectUpdated?: (ticketId: number, subject: string) => void;
  onTicketCreated?: () => void;
  onCommentsRefresh?: (ticketId: number) => void;
  deps?: Partial<TicketSaveDependencies & CommentSaveDependencies>;
  rewrite?: RewriteDocumentDeps;
  syncEngine?: Pick<SyncEngine, "syncOne"> & Partial<Pick<SyncEngine, "syncTicketEditor">>;
}

const commentSyncOutcomeToSaveResult = (
  outcome: SyncEngineOutcome,
  creating: boolean,
): CommentSaveResult => {
  switch (outcome.kind) {
    case "completed":
      return {
        status: creating ? "created" : "success",
        message: creating ? "Comment added." : "Comment updated.",
        commentId: "commentId" in outcome ? outcome.commentId : undefined,
      };
    case "no_change":
      return { status: "no_change", message: "No changes to save." };
    case "conflict":
      return {
        status: "conflict",
        message: outcome.message ?? "Remote changes detected.",
        commentId: "commentId" in outcome ? outcome.commentId : undefined,
        conflictContext: "commentConflictContext" in outcome
          ? outcome.commentConflictContext
          : undefined,
      };
    case "commit_unknown":
      return { status: "failed", message: outcome.message };
    case "remote_committed":
      return {
        status: "created_unresolved",
        message: outcome.message ?? "Remote commit completed; reconciliation is pending.",
      };
    case "failed_before_commit":
      return { status: "failed", message: outcome.error.message };
    case "queued":
      return { status: "queued", message: "Saved for offline sync." };
  }
};

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
    const input = {
      context: { connectionScope: operationScope },
      editor,
      ticketId,
      newTicket: true,
      manual: getOfflineSyncMode() === "manual",
    };
    const outcome = options.syncEngine?.syncTicketEditor
      ? await options.syncEngine.syncTicketEditor(input)
      : await createTicketSyncService({
          create: options.deps,
          update: options.deps,
          rewrite: options.rewrite,
        }).syncEditor(input);
    const result = ticketSyncOutcomeToSaveResult(outcome, true);
    if (outcome.kind === "completed") {
      options.onTicketCreated?.();
    }
    return { kind: "ticket", result };
  }

  if (contentType === "ticket") {
    markDraftStatus(ticketId, "Syncing", operationScope);
    let result: TicketSaveResult;
    try {
      const input = {
        context: { connectionScope: operationScope },
        editor,
        ticketId,
        newTicket: false,
        manual: getOfflineSyncMode() === "manual",
      };
      const outcome = options.syncEngine?.syncTicketEditor
        ? await options.syncEngine.syncTicketEditor(input)
        : await createTicketSyncService({
            create: options.deps,
            update: options.deps,
            rewrite: options.rewrite,
          }).syncEditor(input);
      result = ticketSyncOutcomeToSaveResult(outcome, false);
      if (outcome.kind === "completed") {
        const canonicalSubject = getTicketDraft(ticketId, operationScope)?.baseSubject;
        if (canonicalSubject) {
          options.onSubjectUpdated?.(ticketId, canonicalSubject);
        }
      }
    } catch (error) {
      markDraftStatus(ticketId, "Failed", operationScope);
      throw error;
    }
    if (result.status === "no_change" || result.status === "success") {
      markDraftStatus(ticketId, "Synced", operationScope);
    } else if (result.status !== "conflict" && result.status !== "queued") {
      markDraftStatus(ticketId, "Failed", operationScope);
    }
    return { kind: "ticket", result };
  }

  if (contentType === "commentDraft") {
    const queued = await saveCommentDraftLocally(editor, operationScope);
    if (!queued || getOfflineSyncMode() === "manual") {
      return queued ? { kind: "comment", result: queued, ticketId } : undefined;
    }
    const outcome = await (options.syncEngine ?? createSyncEngine({ comments: options.deps })).syncOne(
      {
        kind: "comment",
        ticketId,
        documentUri: editor.document.uri.toString(),
      },
      { connectionScope: operationScope },
    );
    const result = commentSyncOutcomeToSaveResult(outcome, true);
    if (result.status === "created" || result.status === "created_unresolved") {
      options.onCommentsRefresh?.(ticketId);
    }
    return { kind: "comment", result, ticketId };
  }

  if (contentType === "comment") {
    const commentId = getCommentIdForEditor(editor);
    if (!commentId) {
      return undefined;
    }
    const queued = await saveCommentDraftLocally(editor, operationScope);
    if (!queued || getOfflineSyncMode() === "manual") {
      return queued ? { kind: "comment", result: queued, ticketId } : undefined;
    }
    const outcome = await (options.syncEngine ?? createSyncEngine({ comments: options.deps })).syncOne(
      {
        kind: "comment",
        ticketId,
        commentId,
        documentUri: editor.document.uri.toString(),
      },
      { connectionScope: operationScope },
    );
    const result = commentSyncOutcomeToSaveResult(outcome, false);
    if (result.status === "success") {
      options.onCommentsRefresh?.(ticketId);
    }
    return { kind: "comment", result, ticketId };
  }

  return undefined;
};
