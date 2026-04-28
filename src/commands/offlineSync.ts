import * as vscode from "vscode";
import {
  clearOfflineSyncQueue,
  getOfflineSyncQueue,
  OfflineCommentUpdate,
  OfflineTicketUpdate,
  replaceOfflineSyncQueue,
} from "../views/offlineSyncStore";
import {
  applyQueuedTicketUpdate,
  createTicketFromQueuedContent,
} from "../views/ticketSaveSync";
import { applyQueuedCommentUpdate } from "../views/commentSaveSync";
import { registerTicketDocument, removeTicketEditorByUri } from "../views/ticketEditorRegistry";
import { rewriteDocumentWithRegisteredFields } from "../views/editorDocumentRewrite";
import { finalizeNewCommentDraftDocument } from "../views/commentSaveSync";
import { showInfo, showWarning } from "../utils/notifications";
import { TicketSaveResult } from "../views/ticketSaveTypes";
import { CommentSaveResult } from "../views/commentSaveTypes";

export type OfflineSyncRunResult =
  | { status: "nothing_to_sync"; total: 0; synced: 0; failed: 0; conflicts: 0 }
  | { status: "success"; total: number; synced: number; failed: 0; conflicts: 0 }
  | { status: "partial_failure"; total: number; synced: number; failed: number; conflicts: number }
  | { status: "cancelled"; total: number; synced: number; failed: number; conflicts: number }
  | { status: "failed"; total: number; synced: number; failed: number; conflicts: number };

const isTicketResultSuccess = (result: TicketSaveResult): boolean =>
  result.status === "success" ||
  result.status === "created" ||
  result.status === "no_change";

const isCommentResultSuccess = (result: CommentSaveResult): boolean =>
  result.status === "success" ||
  result.status === "created" ||
  result.status === "created_unresolved" ||
  result.status === "no_change";

const summarizeFailures = (
  ticketFailures: OfflineTicketUpdate[],
  commentFailures: OfflineCommentUpdate[],
  newTicketFailures: number,
): string => {
  const parts: string[] = [];
  if (newTicketFailures > 0) {
    parts.push(`New tickets: ${newTicketFailures}`);
  }
  if (ticketFailures.length > 0) {
    parts.push(`Ticket updates: ${ticketFailures.length}`);
  }
  if (commentFailures.length > 0) {
    parts.push(`Comment updates: ${commentFailures.length}`);
  }
  return parts.join(", ");
};

export const runOfflineSync = async (): Promise<OfflineSyncRunResult> => {
  const queue = getOfflineSyncQueue();
  const ticketUpdates = Array.from(queue.tickets.values());

  if (
    queue.newTickets.length === 0 &&
    ticketUpdates.length === 0 &&
    queue.comments.length === 0
  ) {
    showInfo("No offline changes to sync.");
    return { status: "nothing_to_sync", total: 0, synced: 0, failed: 0, conflicts: 0 };
  }

  const total = queue.newTickets.length + ticketUpdates.length + queue.comments.length;
  const failedTickets: OfflineTicketUpdate[] = [];
  const failedComments: OfflineCommentUpdate[] = [];
  const failedNewTickets: typeof queue.newTickets = [];
  let conflictCount = 0;

  for (const entry of queue.newTickets) {
    const { result, createdId } = await createTicketFromQueuedContent({
      content: entry.content,
      projectId: entry.projectId,
      baseDir: entry.baseDir,
    });
    if (result.status === "created" && createdId && entry.documentUri) {
      const docUri = vscode.Uri.parse(entry.documentUri);
      removeTicketEditorByUri(docUri);
      await rewriteDocumentWithRegisteredFields(entry.documentUri, createdId);
      const document = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.toString() === entry.documentUri,
      );
      if (document) {
        registerTicketDocument(createdId, document, "ticket", entry.projectId);
      }
    }

    if (!isTicketResultSuccess(result)) {
      failedNewTickets.push(entry);
    }
  }

  for (const update of ticketUpdates) {
    const result = await applyQueuedTicketUpdate({ update });
    if (result.status === "conflict") {
      conflictCount++;
      failedTickets.push(update);
    } else if (!isTicketResultSuccess(result)) {
      failedTickets.push(update);
    }
  }

  for (const update of queue.comments) {
    const result = await applyQueuedCommentUpdate({ update });
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
        });
      }
    }
    if (result.status === "conflict") {
      conflictCount++;
      failedComments.push(update);
    } else if (!isCommentResultSuccess(result)) {
      failedComments.push(update);
    }
  }

  const failedCount = failedTickets.length + failedComments.length + failedNewTickets.length;
  const syncedCount = total - failedCount;

  if (failedCount > 0) {
    replaceOfflineSyncQueue({
      tickets: new Map(failedTickets.map((item) => [item.ticketId, item])),
      comments: failedComments,
      newTickets: failedNewTickets,
    });
    showWarning(
      `Offline sync completed with failures. Remaining: ${summarizeFailures(
        failedTickets,
        failedComments,
        failedNewTickets.length,
      )}`,
    );
    return { status: "partial_failure", total, synced: syncedCount, failed: failedCount, conflicts: conflictCount };
  }

  clearOfflineSyncQueue();
  showInfo("Offline sync completed.");
  return { status: "success", total, synced: total, failed: 0, conflicts: 0 };
};
