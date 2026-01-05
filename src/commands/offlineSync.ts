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
import { registerTicketDocument } from "../views/ticketEditorRegistry";
import { finalizeNewCommentDraftDocument } from "../views/commentSaveSync";
import { showInfo, showWarning } from "../utils/notifications";
import { TicketSaveResult } from "../views/ticketSaveTypes";
import { CommentSaveResult } from "../views/commentSaveTypes";

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

export const runOfflineSync = async (): Promise<void> => {
  const queue = getOfflineSyncQueue();
  const ticketUpdates = Array.from(queue.tickets.values());

  if (
    queue.newTickets.length === 0 &&
    ticketUpdates.length === 0 &&
    queue.comments.length === 0
  ) {
    showInfo("No offline changes to sync.");
    return;
  }

  const failedTickets: OfflineTicketUpdate[] = [];
  const failedComments: OfflineCommentUpdate[] = [];
  const failedNewTickets: typeof queue.newTickets = [];

  for (const entry of queue.newTickets) {
    const result = await createTicketFromQueuedContent({
      content: entry.content,
      projectId: entry.projectId,
      baseDir: entry.baseDir,
    });
    if (result.status === "created" && result.createdId && entry.documentUri) {
      const document = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.toString() === entry.documentUri,
      );
      if (document) {
        registerTicketDocument(result.createdId, document, "ticket", entry.projectId);
      }
    }

    if (!isTicketResultSuccess(result)) {
      failedNewTickets.push(entry);
    }
  }

  for (const update of ticketUpdates) {
    const result = await applyQueuedTicketUpdate({ update });
    if (!isTicketResultSuccess(result)) {
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
    if (!isCommentResultSuccess(result)) {
      failedComments.push(update);
    }
  }

  if (failedTickets.length > 0 || failedComments.length > 0 || failedNewTickets.length > 0) {
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
    return;
  }

  clearOfflineSyncQueue();
  showInfo("Offline sync completed.");
};
