import * as vscode from "vscode";
import {
  getOfflineSyncQueue,
  removeOfflineCommentEntry,
} from "../views/offlineSyncStore";
import { applyQueuedCommentUpdate, finalizeNewCommentDraftDocument } from "../views/commentSaveSync";
import { updateCommentUpdateFileAfterSync } from "../views/commentUpdateFile";
import { UnsyncedFileSyncKey } from "../app/unsyncedTypes";
import { showInfo, showWarning } from "../utils/notifications";
import { RewriteDocumentDeps } from "../views/editorDocumentRewrite";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";
import {
  createTicketSyncService,
  TicketSyncQueueItemNotFoundError,
} from "../app/ticketSync";
import { getTicketDraft } from "../views/ticketDraftStore";

export type SyncFailureReason =
  | "parse_error"
  | "api_error"
  | "validation_error"
  | "permission_denied"
  | "conflict"
  | "file_rewrite_failed"
  | "unknown";

export type SyncUnsyncedFileResult =
  | { status: "success"; kind: "ticket" | "newTicket" | "comment"; id?: number }
  | { status: "no_change"; kind: "ticket" | "newTicket" | "comment"; id?: number }
  | { status: "conflict"; kind: "ticket" | "newTicket" | "comment"; id?: number }
  | { status: "failed"; kind: "ticket" | "newTicket" | "comment"; message?: string; reason?: SyncFailureReason };

type SyncUnsyncedFileOptions = {
  onTicketCreated?: () => void;
  onSubjectUpdated?: (ticketId: number, subject: string) => void;
  createTicketSyncService?: typeof createTicketSyncService;
};

const normalizeNewTicketSyncFailureMessage = (message?: string): string => {
  if (message === "Ticket subject is required.") {
    return vscode.l10n.t("Subject is missing. Enter a subject in the Markdown heading line and sync again.");
  }
  return message ?? vscode.l10n.t("Unknown error");
};

export const syncUnsyncedFile = async (
  item: { syncKey: UnsyncedFileSyncKey },
  options: SyncUnsyncedFileOptions = {},
  rewriteDeps: RewriteDocumentDeps = {},
): Promise<SyncUnsyncedFileResult | undefined> => {
  const operationScope = getCurrentConnectionScope();
  return runWithConnectionScope(
    operationScope,
    () => syncUnsyncedFileAtScope(item, options, rewriteDeps, operationScope),
  );
};

const syncUnsyncedFileAtScope = async (
  item: { syncKey: UnsyncedFileSyncKey },
  options: SyncUnsyncedFileOptions,
  rewriteDeps: RewriteDocumentDeps,
  operationScope: string,
): Promise<SyncUnsyncedFileResult | undefined> => {
  const { syncKey } = item;
  const serviceFactory = options.createTicketSyncService ?? createTicketSyncService;

  if (syncKey.kind === "ticket") {
    const outcome = await serviceFactory().syncQueueItem(
      syncKey,
      { connectionScope: operationScope },
    );
    if (outcome.kind === "completed" || outcome.kind === "no_change") {
      if (options.onSubjectUpdated && outcome.kind === "completed") {
        const canonicalSubject = getTicketDraft(
          syncKey.ticketId,
          operationScope,
        )?.baseSubject;
        if (canonicalSubject) {
          options.onSubjectUpdated(syncKey.ticketId, canonicalSubject);
        }
      }
      showInfo(vscode.l10n.t("Ticket update synced."));
      return {
        status: outcome.kind === "no_change" ? "no_change" : "success",
        kind: "ticket",
        id: syncKey.ticketId,
      };
    } else if (outcome.kind === "conflict") {
      showWarning(vscode.l10n.t("Conflicts with remote changes detected. Open the file to review."));
      return { status: "conflict", kind: "ticket", id: syncKey.ticketId };
    } else {
      if (
        outcome.kind === "failed_before_commit" &&
        outcome.error instanceof TicketSyncQueueItemNotFoundError
      ) {
        showWarning(vscode.l10n.t("Queue entry for this ticket update not found."));
        return undefined;
      }
      const message = outcome.kind === "remote_committed"
        ? outcome.message
        : outcome.kind === "failed_before_commit"
          ? outcome.error.message
          : vscode.l10n.t("Unknown error");
      showWarning(vscode.l10n.t("Sync failed: {0}", message ?? vscode.l10n.t("Unknown error")));
      return { status: "failed", kind: "ticket", message };
    }
  }

  if (syncKey.kind === "newTicket") {
    const outcome = await serviceFactory({ rewrite: rewriteDeps }).syncQueueItem(
      syncKey,
      { connectionScope: operationScope },
    );
    if (outcome.kind === "completed") {
      options.onTicketCreated?.();
      showInfo(vscode.l10n.t("New ticket created."));
      return { status: "success", kind: "newTicket", id: outcome.ticketId };
    }
    if (outcome.kind === "remote_committed") {
      const message = outcome.message ?? vscode.l10n.t(
        "Ticket #{0} was created, but local finalization is pending.",
        outcome.ticketId,
      );
      showWarning(message);
      return {
        status: "failed",
        kind: "newTicket",
        message,
        reason: outcome.pending === "local_finalize" ? "file_rewrite_failed" : "api_error",
      };
    }
    if (
      outcome.kind === "failed_before_commit" &&
      outcome.error instanceof TicketSyncQueueItemNotFoundError
    ) {
      showWarning(vscode.l10n.t("Queue entry for this new ticket not found."));
      return undefined;
    }
    const message = normalizeNewTicketSyncFailureMessage(
      outcome.kind === "failed_before_commit" ? outcome.error.message : undefined,
    );
    showWarning(vscode.l10n.t("Sync failed: {0}", message));
    return { status: "failed", kind: "newTicket", message, reason: "api_error" };
  }

  if (syncKey.kind === "comment") {
    const queue = getOfflineSyncQueue(operationScope);
    const update = syncKey.commentId !== undefined
      ? queue.comments.find((c) => c.ticketId === syncKey.ticketId && c.commentId === syncKey.commentId)
      : queue.comments.find((c) => c.documentUri === syncKey.documentUri && c.commentId === undefined);
    if (!update) {
      showWarning(vscode.l10n.t("Queue entry for this comment update not found."));
      return undefined;
    }
    const result = await applyQueuedCommentUpdate({ update, operationScope });
    if (
      result.status === "created" &&
      update.documentUri &&
      result.commentId &&
      result.projectId
    ) {
      const document = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.toString() === update.documentUri,
      );
      if (document) {
        finalizeNewCommentDraftDocument({
          document,
          ticketId: update.ticketId,
          projectId: result.projectId,
          commentId: result.commentId,
          operationScope,
        });
      }
    }
    if (result.status === "success" && update.sourceNotesHash && update.documentUri) {
      await updateCommentUpdateFileAfterSync(update.documentUri, update.body);
    }
    if (result.status === "success" || result.status === "no_change" || result.status === "created" || result.status === "created_unresolved") {
      removeOfflineCommentEntry(
        { commentId: syncKey.commentId, documentUri: syncKey.documentUri },
        operationScope,
      );
      showInfo(vscode.l10n.t("Comment synced."));
      if (result.status === "no_change") {
        return { status: "no_change", kind: "comment" };
      }
      return { status: "success", kind: "comment", id: result.status === "created" ? result.commentId : undefined };
    } else if (result.status === "conflict") {
      showWarning(vscode.l10n.t("Conflicts with remote changes detected. Open the file to review."));
      return { status: "conflict", kind: "comment" };
    } else {
      showWarning(vscode.l10n.t("Sync failed: {0}", result.message ?? vscode.l10n.t("Unknown error")));
      return { status: "failed", kind: "comment", message: result.message };
    }
  }

  return undefined;
};
