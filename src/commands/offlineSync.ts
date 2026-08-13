import * as vscode from "vscode";
import {
  getOfflineSyncQueue,
  OfflineCommentUpdate,
  OfflineTicketUpdate,
} from "../views/offlineSyncStore";
import { showInfo, showWarning } from "../utils/notifications";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";
import { createSyncEngine, createTicketSyncService } from "../app/ticketSync";
import type { SyncEngine, TicketSyncService } from "../app/ticketSync";

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
  createSyncEngine?: () => Pick<SyncEngine, "syncAll">;
  /** @deprecated Test and extension compatibility while callers move to SyncEngine. */
  createTicketSyncService?: () => Pick<TicketSyncService, "syncAll">;
};

const defaultOfflineSyncDependencies: OfflineSyncDependencies = {
  createSyncEngine,
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
  const syncEngine = deps.createSyncEngine?.() ?? {
    syncAll: (context: { connectionScope: string }, options: { shouldContinue?: () => boolean }) =>
      deps.createTicketSyncService!().syncAll(context, options),
  };
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

      const syncAllOutcome = await syncEngine.syncAll(
        { connectionScope: operationScope },
        {
          shouldContinue: () => !token.isCancellationRequested,
        },
      );
      for (const result of syncAllOutcome.results) {
        const key = result.key;
        const outcome = result.outcome;
        if (outcome.kind === "completed" || outcome.kind === "no_change") {
          synced++;
        } else if (outcome.kind === "conflict") {
          conflicts++;
        }

        if (outcome.kind !== "completed" && outcome.kind !== "no_change") {
          if (key.kind === "newTicket") {
            const original = queue.newTickets.find((candidate) => candidate.queueId === key.queueId);
            if (original) { failedNewTickets.push(original); }
          } else if (key.kind === "ticket") {
            const original = queue.tickets.get(key.ticketId);
            if (original) { failedTickets.push(original); }
          } else {
            const commentKey = key;
            const original = queue.comments.find((candidate) =>
              candidate.ticketId === commentKey.ticketId &&
              (commentKey.commentId !== undefined
                ? candidate.commentId === commentKey.commentId
                : candidate.documentUri === commentKey.documentUri),
            );
            if (original) { failedComments.push(original); }
          }
        }
        const label = result.key.kind === "newTicket"
          ? "New ticket"
          : result.key.kind === "ticket"
            ? `Ticket #${result.key.ticketId}`
            : "Comment";
        advance(`${label} (${processed}/${totalItems})`);
      }
      for (const key of syncAllOutcome.remaining) {
        if (key.kind === "newTicket") {
          const original = queue.newTickets.find((candidate) => candidate.queueId === key.queueId);
          if (original) { failedNewTickets.push(original); }
        } else if (key.kind === "ticket") {
          const original = queue.tickets.get(key.ticketId);
          if (original) { failedTickets.push(original); }
        } else {
          const original = queue.comments.find((candidate) =>
            candidate.ticketId === key.ticketId &&
            (key.commentId !== undefined
              ? candidate.commentId === key.commentId
              : candidate.documentUri === key.documentUri),
          );
          if (original) { failedComments.push(original); }
        }
      }
      if (syncAllOutcome.cancelled) {
        wasCancelled = true;
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
