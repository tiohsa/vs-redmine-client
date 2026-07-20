import * as vscode from "vscode";
import {
  getOfflineSyncQueue,
  removeOfflineTicketUpdate,
  removeOfflineNewTicket,
  updateOfflineNewTicket,
  removeOfflineCommentEntry,
} from "../views/offlineSyncStore";
import { applyQueuedTicketUpdate, createTicketFromQueuedContent } from "../views/ticketSaveSync";
import { applyQueuedCommentUpdate, finalizeNewCommentDraftDocument } from "../views/commentSaveSync";
import { updateCommentUpdateFileAfterSync } from "../views/commentUpdateFile";
import { registerTicketDocument } from "../views/ticketEditorRegistry";
import { UnsyncedFileSyncKey } from "../app/unsyncedTypes";
import { showInfo, showWarning } from "../utils/notifications";
import { rewriteDocumentWithRegisteredFields, RewriteDocumentDeps } from "../views/editorDocumentRewrite";
import { removeTicketEditorByUri } from "../views/ticketEditorRegistry";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";

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

const normalizeNewTicketSyncFailureMessage = (message?: string): string => {
  if (message === "Ticket subject is required.") {
    return vscode.l10n.t("Subject is missing. Enter a subject in the Markdown heading line and sync again.");
  }
  return message ?? vscode.l10n.t("Unknown error");
};

export const syncUnsyncedFile = async (
  item: { syncKey: UnsyncedFileSyncKey },
  options: { onTicketCreated?: () => void; onSubjectUpdated?: (ticketId: number, subject: string) => void } = {},
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
  options: { onTicketCreated?: () => void; onSubjectUpdated?: (ticketId: number, subject: string) => void },
  rewriteDeps: RewriteDocumentDeps,
  operationScope: string,
): Promise<SyncUnsyncedFileResult | undefined> => {
  const { syncKey } = item;
  const queue = getOfflineSyncQueue(operationScope);

  if (syncKey.kind === "ticket") {
    const update = queue.tickets.get(syncKey.ticketId);
    if (!update) {
      showWarning(vscode.l10n.t("Queue entry for this ticket update not found."));
      return undefined;
    }
    const result = await applyQueuedTicketUpdate({ update, operationScope });
    if (result.status === "success" || result.status === "no_change") {
      removeOfflineTicketUpdate(syncKey.ticketId, operationScope);
      if (options.onSubjectUpdated && result.status === "success") {
        options.onSubjectUpdated(syncKey.ticketId, update.subject);
      }
      showInfo(vscode.l10n.t("Ticket update synced."));
      return { status: result.status, kind: "ticket", id: syncKey.ticketId };
    } else if (result.status === "conflict") {
      showWarning(vscode.l10n.t("Conflicts with remote changes detected. Open the file to review."));
      return { status: "conflict", kind: "ticket", id: syncKey.ticketId };
    } else {
      showWarning(vscode.l10n.t("Sync failed: {0}", result.message ?? vscode.l10n.t("Unknown error")));
      return { status: "failed", kind: "ticket", message: result.message };
    }
  }

  if (syncKey.kind === "newTicket") {
    const entry = syncKey.documentUri
      ? queue.newTickets.find((t) => t.documentUri === syncKey.documentUri)
      : queue.newTickets[0];
    if (!entry) {
      showWarning(vscode.l10n.t("Queue entry for this new ticket not found."));
      return undefined;
    }

    // createdIssueId が既にある場合は作成済み → ファイル書き換えのみ再試行
    let resolvedId = entry.createdIssueId;

    if (!resolvedId) {
      const { result, createdId } = await createTicketFromQueuedContent({
        operationScope,
        content: entry.content,
        projectId: entry.projectId,
        baseDir: entry.baseDir,
      });
      if (result.status !== "created" || !createdId) {
        const message = normalizeNewTicketSyncFailureMessage(result.message);
        showWarning(vscode.l10n.t("Sync failed: {0}", message));
        return { status: "failed", kind: "newTicket", message, reason: "api_error" };
      }
      resolvedId = createdId;
      // 作成成功を即座にキューに記録してから書き換えへ（重複作成防止）
      updateOfflineNewTicket(
        { queueId: entry.queueId, documentUri: entry.documentUri },
        { createdIssueId: resolvedId },
        operationScope,
      );
    }

    if (entry.documentUri) {
      const docUri = vscode.Uri.parse(entry.documentUri);
      removeTicketEditorByUri(docUri);
      const rewriteSuccess = await rewriteDocumentWithRegisteredFields(
        entry.documentUri,
        resolvedId,
        rewriteDeps,
        entry.projectId,
      );
      const document = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.toString() === entry.documentUri,
      );
      if (document) {
        registerTicketDocument(
          resolvedId,
          document,
          "ticket",
          entry.projectId,
          operationScope,
        );
      }
      if (rewriteSuccess) {
        removeOfflineNewTicket(
          { queueId: entry.queueId, documentUri: entry.documentUri },
          operationScope,
        );
        options.onTicketCreated?.();
        showInfo(vscode.l10n.t("New ticket created."));
        return { status: "success", kind: "newTicket", id: resolvedId };
      } else {
        updateOfflineNewTicket(
          { queueId: entry.queueId, documentUri: entry.documentUri },
          { status: "created_rewrite_failed" },
          operationScope,
        );
        showWarning(
          vscode.l10n.t("Redmine ticket created (#{0}). File rewrite failed. Retry sync to reattempt file conversion only.", resolvedId),
        );
        return {
          status: "failed",
          kind: "newTicket",
          message: vscode.l10n.t("File rewrite failed (ticket #{0} already created)", resolvedId),
          reason: "file_rewrite_failed",
        };
      }
    } else {
      options.onTicketCreated?.();
      showInfo(vscode.l10n.t("New ticket created."));
      return { status: "success", kind: "newTicket", id: resolvedId };
    }
  }

  if (syncKey.kind === "comment") {
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
