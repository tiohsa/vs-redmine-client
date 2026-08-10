import * as vscode from "vscode";
import {
  getOfflineSyncQueue,
  OfflineCommentUpdate,
  OfflineTicketUpdate,
  removeOfflineCommentEntry,
} from "../views/offlineSyncStore";
import { applyQueuedCommentUpdate } from "../views/commentSaveSync";
import { finalizeNewCommentDraftDocument } from "../views/commentSaveSync";
import { showInfo, showWarning } from "../utils/notifications";
import { CommentSaveResult } from "../views/commentSaveTypes";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";
import { createTicketSyncService } from "../app/ticketSync";
import type { TicketSyncService } from "../app/ticketSync";

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

export type OfflineSyncRunResult =
  | { status: "nothing_to_sync"; total: 0; synced: 0; failed: 0; conflicts: 0 }
  | { status: "success"; total: number; synced: number; failed: 0; conflicts: 0 }
  | { status: "partial_failure"; total: number; synced: number; failed: number; conflicts: number }
  | { status: "cancelled"; total: number; synced: number; failed: number; conflicts: number }
  | { status: "failed"; total: number; synced: number; failed: number; conflicts: number };

type OfflineSyncDependencies = {
  createTicketSyncService: () => Pick<TicketSyncService, "syncAll">;
};

const defaultOfflineSyncDependencies: OfflineSyncDependencies = {
  createTicketSyncService,
};

export const runOfflineSync = async (
  deps: OfflineSyncDependencies = defaultOfflineSyncDependencies,
): Promise<OfflineSyncRunResult> => {
  const operationScope = getCurrentConnectionScope();
  return runWithConnectionScope(
    operationScope,
    () => runOfflineSyncAtScope(operationScope, deps),
  );
};

const runOfflineSyncAtScope = async (
  operationScope: string,
  deps: OfflineSyncDependencies,
): Promise<OfflineSyncRunResult> => {
  const queue = getOfflineSyncQueue(operationScope);
  const ticketSyncService = deps.createTicketSyncService();
  const ticketUpdates = Array.from(queue.tickets.values());
  const totalItems =
    queue.newTickets.length + ticketUpdates.length + queue.comments.length;

  if (totalItems === 0) {
    showInfo(vscode.l10n.t("No local changes to sync."));
    return { status: "nothing_to_sync", total: 0, synced: 0, failed: 0, conflicts: 0 };
  }

  const failedTickets: OfflineTicketUpdate[] = [];
  const failedComments: OfflineCommentUpdate[] = [];
  const failedNewTickets: typeof queue.newTickets = [];

  let synced = 0;
  let conflicts = 0;
  let wasCancelled = false;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t("Syncing local changes to Redmine…"),
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

      const ticketOperations = [
        ...queue.newTickets.map((operation) => ({ kind: "newTicket" as const, operation })),
        ...ticketUpdates.map((operation) => ({ kind: "ticket" as const, operation })),
      ];
      if (ticketOperations.length > 0) {
        const outcomes = await ticketSyncService.syncAll({
          context: { connectionScope: operationScope },
          newTickets: queue.newTickets,
          tickets: ticketUpdates,
          shouldContinue: () => !token.isCancellationRequested,
        });
        for (let index = 0; index < outcomes.length; index++) {
          const item = ticketOperations[index];
          const outcome = outcomes[index];
          if (outcome.kind === "completed" || outcome.kind === "no_change") {
            synced++;
          } else if (item.kind === "newTicket") {
            const current = getOfflineSyncQueue(operationScope).newTickets.find(
              (candidate) => candidate.queueId === item.operation.queueId,
            );
            failedNewTickets.push(current ?? item.operation);
          } else {
            if (outcome.kind === "conflict") {
              conflicts++;
            }
            failedTickets.push(item.operation);
          }
          advance(item.kind === "newTicket"
            ? `New ticket (${processed}/${totalItems})`
            : `Ticket #${item.operation.ticketId} (${processed}/${totalItems})`);
        }
        if (outcomes.length < ticketOperations.length) {
          wasCancelled = true;
          for (const item of ticketOperations.slice(outcomes.length)) {
            if (item.kind === "newTicket") {
              failedNewTickets.push(item.operation);
            } else {
              failedTickets.push(item.operation);
            }
          }
        }
      }

      // ── コメント更新 ────────────────────────────────────────────────────
      for (const update of queue.comments) {
        if (token.isCancellationRequested) {
          wasCancelled = true;
          failedComments.push(update);
          continue;
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
        if (isCommentResultSuccess(result)) {
          synced++;
          removeOfflineCommentEntry(
            { commentId: update.commentId, documentUri: update.documentUri },
            operationScope,
          );
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

  if (wasCancelled || failed > 0 || conflicts > 0) {
    const parts: string[] = [];
    if (synced > 0) { parts.push(vscode.l10n.t("Synced: {0}", synced)); }
    if (conflicts > 0) { parts.push(vscode.l10n.t("Conflicts: {0}", conflicts)); }
    if (failed - conflicts > 0) { parts.push(vscode.l10n.t("Failed: {0}", failed - conflicts)); }
    showWarning(
      vscode.l10n.t(
        "Sync completed with issues. {0}. Remaining: {1}",
        parts.join(", "),
        summarizeFailures(failedTickets, failedComments, failedNewTickets.length),
      ),
    );
    if (wasCancelled) {
      return { status: "cancelled", total: totalItems, synced, failed, conflicts };
    }
    if (synced === 0) {
      return { status: "failed", total: totalItems, synced, failed, conflicts };
    }
    return { status: "partial_failure", total: totalItems, synced, failed, conflicts };
  }

  showInfo(vscode.l10n.t("Sync completed. Synced: {0}.", synced));
  return { status: "success", total: totalItems, synced, failed: 0, conflicts: 0 };
};
