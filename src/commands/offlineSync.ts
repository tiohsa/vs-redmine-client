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
  const totalItems =
    queue.newTickets.length + ticketUpdates.length + queue.comments.length;

  if (totalItems === 0) {
    showInfo("No local changes to sync.");
    return;
  }

  const failedTickets: OfflineTicketUpdate[] = [];
  const failedComments: OfflineCommentUpdate[] = [];
  const failedNewTickets: typeof queue.newTickets = [];

  let synced = 0;
  let conflicts = 0;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Syncing local changes to Redmine…",
      cancellable: true,
    },
    async (progress, token) => {
      let processed = 0;

      const advance = (detail: string): void => {
        processed++;
        progress.report({
          message: detail,
          increment: (1 / totalItems) * 100,
        });
      };

      // ── 新規チケット ────────────────────────────────────────────────────
      for (const entry of queue.newTickets) {
        if (token.isCancellationRequested) {
          failedNewTickets.push(...queue.newTickets.slice(processed));
          break;
        }
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
        if (isTicketResultSuccess(result)) {
          synced++;
        } else {
          failedNewTickets.push(entry);
        }
        advance(`New ticket (${processed}/${totalItems})`);
      }

      // ── チケット更新 ────────────────────────────────────────────────────
      for (const update of ticketUpdates) {
        if (token.isCancellationRequested) {
          failedTickets.push(update);
          continue;
        }
        const result = await applyQueuedTicketUpdate({ update });
        if (isTicketResultSuccess(result)) {
          synced++;
        } else if (result.status === "conflict") {
          conflicts++;
          failedTickets.push(update);
        } else {
          failedTickets.push(update);
        }
        advance(`Ticket #${update.ticketId} (${processed}/${totalItems})`);
      }

      // ── コメント更新 ────────────────────────────────────────────────────
      for (const update of queue.comments) {
        if (token.isCancellationRequested) {
          failedComments.push(update);
          continue;
        }
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
        if (isCommentResultSuccess(result)) {
          synced++;
        } else if (result.status === "conflict") {
          conflicts++;
          failedComments.push(update);
        } else {
          failedComments.push(update);
        }
        advance(`Comment (${processed}/${totalItems})`);
      }
    },
  );

  const failed =
    failedTickets.length + failedComments.length + failedNewTickets.length;

  if (failed > 0 || conflicts > 0) {
    replaceOfflineSyncQueue({
      tickets: new Map(failedTickets.map((item) => [item.ticketId, item])),
      comments: failedComments,
      newTickets: failedNewTickets,
    });
    const parts: string[] = [];
    if (synced > 0) { parts.push(`Synced: ${synced}`); }
    if (conflicts > 0) { parts.push(`Conflicts: ${conflicts}`); }
    if (failed - conflicts > 0) { parts.push(`Failed: ${failed - conflicts}`); }
    showWarning(
      `Sync completed with issues. ${parts.join(", ")}. Remaining: ${summarizeFailures(
        failedTickets,
        failedComments,
        failedNewTickets.length,
      )}`,
    );
    return;
  }

  clearOfflineSyncQueue();
  showInfo(`Sync completed. Synced: ${synced}.`);
};
