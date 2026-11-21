import * as vscode from "vscode";
import {
  getOfflineSyncQueue,
  isAbandoned,
  OfflineCommentUpdate,
  OfflineTicketUpdate,
  resolveStoredOfflineOperation,
  sameDocumentIdentity,
} from "../views/offlineSyncStore";
import { showInfo, showWarning } from "../utils/notifications";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { CreateOperationHttpError } from "../redmine/httpError";
import { runWithConnectionScope } from "../redmine/client";
import { createSyncEngine, createTicketSyncService } from "../app/ticketSync";
import type { SyncEngine, TicketSyncService } from "../app/ticketSync";
import { renameSyncedNewTicketFileIfEligible } from "../views/ticketSync/ticketEditorRewrite";
import { refreshTicketEditorContexts } from "../app/editorEventController";

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

export type OfflineSyncRunResult = {
  remainingChanges?: number;
  newTicketDiagnostics?: readonly string[];
  createdTicketIds?: readonly number[];
  createdComments?: ReadonlyArray<{ ticketId: number; commentId: number }>;
} & (
  | { status: "nothing_to_sync"; total: 0; synced: 0; failed: 0; conflicts: 0 }
  | { status: "success"; total: number; synced: number; failed: 0; conflicts: 0 }
  | { status: "partial_failure"; total: number; synced: number; failed: number; conflicts: number }
  | { status: "cancelled"; total: number; synced: number; failed: number; conflicts: number }
  | { status: "failed"; total: number; synced: number; failed: number; conflicts: number }
  | { status: "recovery_pending"; total: number; synced: number; failed: number; conflicts: number }
);

type OfflineSyncDependencies = {
  suppressResultNotifications?: boolean;
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
  const info = (message: string): void => { if (!deps.suppressResultNotifications) { showInfo(message); } };
  const warning = (message: string): void => { if (!deps.suppressResultNotifications) { showWarning(message); } };
  const queue = getOfflineSyncQueue(operationScope);
  const legacyService = deps.createTicketSyncService?.();
  const syncEngine = deps.createSyncEngine?.() ?? legacyService ?? createSyncEngine();
  const ticketUpdates = Array.from(queue.tickets.values()).filter((item) => !isAbandoned(item));
  const totalItems =
    queue.newTickets.filter((item) => !isAbandoned(item)).length + ticketUpdates.length +
    queue.comments.filter((item) => !isAbandoned(item)).length;

  if (totalItems === 0) {
    info(vscode.l10n.t("No local changes to sync."));
    return { status: "nothing_to_sync", total: 0, synced: 0, failed: 0, conflicts: 0 };
  }

  const failedTickets: OfflineTicketUpdate[] = [];
  const failedComments: OfflineCommentUpdate[] = [];
  const failedNewTickets: typeof queue.newTickets = [];

  const newTicketSnapshot = queue.newTickets.map((item) => ({ ...item }));
  const createdTicketIds: number[] = [];
  const createdComments: Array<{ ticketId: number; commentId: number }> = [];
  const newTicketErrors = new Set<string>();
  let synced = 0;
  let conflicts = 0;
  let wasCancelled = false;
  let recoveryPending = false;

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
        if (outcome.kind === "commit_unknown" || outcome.kind === "remote_committed" || outcome.kind === "queued") { recoveryPending = true; }
        if (outcome.kind === "completed" || outcome.kind === "no_change") {
          synced++;
        } else if (outcome.kind === "conflict") {
          conflicts++;
        }

        if (key.kind === "newTicket" && outcome.kind === "completed") {
          const createdId =
            "ticketId" in outcome && typeof outcome.ticketId === "number" && outcome.ticketId > 0
              ? outcome.ticketId
              : undefined;
          if (createdId !== undefined) {
            createdTicketIds.push(createdId);
            const original = newTicketSnapshot.find((candidate) =>
              (key.queueId && candidate.queueId === key.queueId) ||
              (key.documentUri && sameDocumentIdentity(candidate.documentUri, key.documentUri))
            );
            const remainingEntry = resolveStoredOfflineOperation(getOfflineSyncQueue(operationScope), key)?.value;
            if (original?.documentUri && !remainingEntry) {
              await renameSyncedNewTicketFileIfEligible({
                oldUri: vscode.Uri.parse(original.documentUri),
                ticketId: createdId,
                projectId: original.projectId,
                connectionScope: operationScope,
              });
              refreshTicketEditorContexts();
            }
          }
        }

        if (
          key.kind === "comment" &&
          key.commentId === undefined &&
          outcome.kind === "completed" &&
          "commentId" in outcome &&
          typeof outcome.commentId === "number" &&
          outcome.commentId > 0
        ) {
          createdComments.push({ ticketId: key.ticketId, commentId: outcome.commentId });
        }

        if (outcome.kind !== "completed" && outcome.kind !== "no_change") {
          if (key.kind === "newTicket") {
            if ("error" in outcome &&
                outcome.error instanceof CreateOperationHttpError) {
              newTicketErrors.add(outcome.error.message);
            }
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
    const diagnostics = Array.from(newTicketErrors);
    const counts = {
      total: totalItems,
      synced,
      failed,
      conflicts,
      ...(diagnostics.length > 0 ? { newTicketDiagnostics: diagnostics } : {}),
      ...(createdTicketIds.length > 0 ? { createdTicketIds } : {}),
      ...(createdComments.length > 0 ? { createdComments } : {}),
    };
    const parts: string[] = [];
    if (synced > 0) { parts.push(vscode.l10n.t("Synced: {0}", synced)); }
    if (conflicts > 0) { parts.push(vscode.l10n.t("Conflicts: {0}", conflicts)); }
    if (failed - conflicts > 0) { parts.push(vscode.l10n.t("Failed: {0}", failed - conflicts)); }
    warning(
      vscode.l10n.t(
        "Sync completed with issues. {0}. Remaining: {1}",
        parts.join(", "),
        summarizeFailures(failedTickets, failedComments, failedNewTickets.length),
      ) + (diagnostics.length > 0 ? ` ${diagnostics.join(" ")}` : ""),
    );
    if (wasCancelled) {
      return { status: "cancelled", ...counts };
    }
    if (recoveryPending) {
      return { status: "recovery_pending", ...counts };
    }
    if (synced === 0) {
      return { status: "failed", ...counts };
    }
    return { status: "partial_failure", ...counts };
  }

  const remaining = getOfflineSyncQueue(operationScope);
  const remainingChanges = [...remaining.tickets.values(), ...remaining.comments, ...remaining.newTickets].filter((item) => !isAbandoned(item)).length;
  info(remainingChanges > 0
    ? vscode.l10n.t("Sync completed. Synced: {0}; local changes remaining: {1}.", synced, remainingChanges)
    : vscode.l10n.t("Sync completed. Synced: {0}.", synced));
  return {
    status: "success",
    total: totalItems,
    synced,
    failed: 0,
    conflicts: 0,
    ...(remainingChanges > 0 ? { remainingChanges } : {}),
    ...(createdTicketIds.length > 0 ? { createdTicketIds } : {}),
    ...(createdComments.length > 0 ? { createdComments } : {}),
  };
};
