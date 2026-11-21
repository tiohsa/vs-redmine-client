import * as vscode from "vscode";
import {
  getOfflineNewTicket,
  getOfflineSyncQueue,
  isAbandoned,
  resolveStoredOfflineOperation,
} from "../views/offlineSyncStore";
import { UnsyncedFileSyncKey } from "../app/unsyncedTypes";
import { showInfo, showWarning } from "../utils/notifications";
import { RewriteDocumentDeps } from "../views/editorDocumentRewrite";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";
import {
  createTicketSyncService,
  createSyncEngine,
  TicketSyncQueueItemNotFoundError,
} from "../app/ticketSync";
import { getPrimaryEffectForRevision, isPrimaryEffectKind } from "../app/syncEffects";
import { getTicketDraft } from "../views/ticketDraftStore";
import type { ConflictContext } from "../views/ticketSaveTypes";
import type { CommentConflictContext } from "../views/commentSaveTypes";
import { renameSyncedNewTicketFileIfEligible } from "../views/ticketSync/ticketEditorRewrite";
import { refreshTicketEditorContexts } from "../app/editorEventController";
import { resolveCommitUnknownInteractive, resolveCommentCommitUnknownInteractive } from "./unsyncedPrimaryRecovery";
import { resolveSecondaryEffectsInteractive } from "./unsyncedSecondaryRecovery";
import { resolveTicketLocalFinalizeInteractive } from "./unsyncedLocalFinalize";

export type SyncFailureReason =
  | "parse_error"
  | "api_error"
  | "validation_error"
  | "permission_denied"
  | "conflict"
  | "file_rewrite_failed"
  | "unknown";

export type SyncUnsyncedFileResult =
  | { status: "success"; kind: "ticket" | "newTicket" | "comment"; id?: number; hasRemainingChanges?: boolean }
  | { status: "queued"; kind: "ticket" | "newTicket" | "comment"; id?: number }
  | { status: "no_change"; kind: "ticket" | "newTicket" | "comment"; id?: number; hasRemainingChanges?: boolean }
  | { status: "commit_unknown" | "recovery_pending"; kind: "ticket" | "newTicket" | "comment"; message: string }
  | { status: "cancelled"; kind: "ticket" | "newTicket" | "comment" }
  | { status: "conflict"; kind: "ticket"; id: number; conflictContext?: ConflictContext }
  | { status: "conflict"; kind: "comment"; id?: number; commentConflictContext?: CommentConflictContext }
  | { status: "failed"; kind: "ticket" | "newTicket" | "comment"; message?: string; reason?: SyncFailureReason };

type SyncUnsyncedFileOptions = {
  suppressResultNotifications?: boolean;
  onTicketCreated?: () => void;
  onSubjectUpdated?: (ticketId: number, subject: string) => void;
  createTicketSyncService?: typeof createTicketSyncService;
  createSyncEngine?: typeof createSyncEngine;
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
  const showInfoResult = (message: string): void => { if (!options.suppressResultNotifications) { showInfo(message); } };
  const showWarningResult = (message: string): void => { if (!options.suppressResultNotifications) { showWarning(message); } };
  const { syncKey } = item;
  const cancelled = (): SyncUnsyncedFileResult => ({ status: "cancelled", kind: syncKey.kind });
  const hasRemainingChanges = (): boolean => {
    const remaining = resolveStoredOfflineOperation(getOfflineSyncQueue(operationScope), syncKey)?.value;
    return !!remaining && !isAbandoned(remaining);
  };
  const pendingResult = (outcome: { kind: "commit_unknown" | "remote_committed"; message?: string; pending?: string }): SyncUnsyncedFileResult => {
    const baseMessage = outcome.kind === "commit_unknown"
      ? vscode.l10n.t("The Redmine write outcome is unknown. Open recovery to check before retrying.")
      : outcome.pending === "local_finalize"
        ? vscode.l10n.t("Changes are on Redmine. Resume recovery to finish updating the local file.")
        : vscode.l10n.t("The Redmine write was recorded. Resume recovery to verify the result and finish synchronization.");
    const message = outcome.kind === "remote_committed" && outcome.pending === "local_finalize" && outcome.message
      ? `${baseMessage} (${outcome.message})`
      : baseMessage;
    showWarningResult(message);
    return { status: outcome.kind === "commit_unknown" ? "commit_unknown" : "recovery_pending", kind: syncKey.kind, message };
  };
  const queue = getOfflineSyncQueue(operationScope);
  const stored = resolveStoredOfflineOperation(queue, syncKey)?.value;
  if (stored && isAbandoned(stored)) {
    return { status: "failed", kind: syncKey.kind, message: vscode.l10n.t("Sync was abandoned for this item.") };
  }
  const serviceFactory = options.createTicketSyncService ?? createTicketSyncService;
  const engineFactory = options.createSyncEngine ?? createSyncEngine;

  if (syncKey.kind === "ticket") {
    const previousPhase = getOfflineSyncQueue(operationScope).tickets.get(
      syncKey.ticketId,
    )?.phase;
    const engine = engineFactory({ tickets: serviceFactory() });
    let outcome = await engine.syncOne(
      syncKey,
      { connectionScope: operationScope },
    );
    const recoveryItems = engine.getRecoveryItems(syncKey, { connectionScope: operationScope });
    const hasPrimaryRecovery = recoveryItems.some((item) => isPrimaryEffectKind(item.effectKind) && item.allowedActions.length > 0);
    let primaryResolved = false;
    if (
      (outcome.kind === "commit_unknown" &&
        (previousPhase === "commit_unknown" || previousPhase === "remote_write_started")) ||
      (outcome.kind === "failed_before_commit" && hasPrimaryRecovery) ||
      (outcome.kind === "remote_committed" && outcome.pending === "remote_reconcile" &&
        (previousPhase === "remote_committed" || previousPhase === "reconciliation_pending"))
    ) {
      const resolved = await resolveCommitUnknownInteractive(engine.ticketService(), engine, syncKey, operationScope);
      if (resolved?.kind === "cancelled") { return cancelled(); }
      if (resolved) {
        outcome = resolved;
        primaryResolved = true;
      }
    }
    if (!hasPrimaryRecovery || primaryResolved) {
      if (outcome.kind === "failed_before_commit" || outcome.kind === "remote_committed" || outcome.kind === "commit_unknown") {
        const secOutcome = await resolveSecondaryEffectsInteractive(engine, syncKey, operationScope);
        if (secOutcome?.kind === "cancelled") { return cancelled(); }
        if (secOutcome) {
          outcome = secOutcome;
        }
      }
    }
    if (
      previousPhase === "local_finalize_pending" &&
      outcome.kind === "remote_committed" &&
      outcome.pending === "local_finalize"
    ) {
      const finalizedOutcome = await resolveTicketLocalFinalizeInteractive(engine, syncKey, operationScope, outcome);
      if (finalizedOutcome?.kind === "cancelled") { return cancelled(); }
      if (finalizedOutcome) {
        outcome = finalizedOutcome;
      }
    }
    if (outcome.kind === "commit_unknown" || outcome.kind === "remote_committed") { return pendingResult(outcome); }
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
      showInfoResult(hasRemainingChanges()
        ? vscode.l10n.t("This sync completed. Later local changes are still waiting to sync.")
        : vscode.l10n.t("Ticket update synced."));
      return {
        status: outcome.kind === "no_change" ? "no_change" : "success",
        kind: "ticket",
        id: syncKey.ticketId,
        ...(hasRemainingChanges() ? { hasRemainingChanges: true } : {}),
      };
    } else if (outcome.kind === "queued") {
      showInfoResult(vscode.l10n.t("Recovery completed. The item is queued for synchronization."));
      return { status: "queued", kind: "ticket", id: syncKey.ticketId };
    } else if (outcome.kind === "conflict") {
      showWarningResult(vscode.l10n.t("Conflicts with remote changes detected. Open the file to review."));
      return {
        status: "conflict",
        kind: "ticket",
        id: syncKey.ticketId,
        conflictContext: "conflictContext" in outcome ? outcome.conflictContext : undefined,
      };
    } else {
      if (
        outcome.kind === "failed_before_commit" &&
        (outcome.error instanceof TicketSyncQueueItemNotFoundError ||
          outcome.error.message.includes("Queue entry for this ticket update not found"))
      ) {
        showWarningResult(vscode.l10n.t("Queue entry for this ticket update not found."));
        return undefined;
      }
      const message = outcome.kind === "failed_before_commit"
          ? outcome.error.message
          : vscode.l10n.t("Unknown error");
      showWarningResult(vscode.l10n.t("Sync failed: {0}", message ?? vscode.l10n.t("Unknown error")));
      return { status: "failed", kind: "ticket", message };
    }
  }

  if (syncKey.kind === "newTicket") {
    const previous = getOfflineNewTicket(syncKey, operationScope);
    const previousPhase = previous?.phase;
    const wasFailed = previous && getPrimaryEffectForRevision(previous)?.state === "failed";
    const engine = engineFactory({ tickets: serviceFactory({ rewrite: rewriteDeps }) });
    let outcome = await engine.syncOne(
      syncKey,
      { connectionScope: operationScope },
    );
    const recoveryItems = engine.getRecoveryItems(syncKey, { connectionScope: operationScope });
    const hasPrimaryRecovery = recoveryItems.some((item) => isPrimaryEffectKind(item.effectKind) && item.allowedActions.length > 0);
    let primaryResolved = false;
    if (
      (outcome.kind === "commit_unknown" &&
        (previousPhase === "commit_unknown" || previousPhase === "remote_write_started")) ||
      (outcome.kind === "failed_before_commit" && wasFailed && hasPrimaryRecovery) ||
      (outcome.kind === "remote_committed" && recoveryItems.some((item) =>
        isPrimaryEffectKind(item.effectKind) && item.allowedActions.includes("reconcile_compensation")))
    ) {
      const resolved = await resolveCommitUnknownInteractive(engine.ticketService(), engine, syncKey, operationScope);
      if (resolved?.kind === "cancelled") { return cancelled(); }
      if (resolved) {
        outcome = resolved;
        primaryResolved = true;
      }
    }
    if (!hasPrimaryRecovery || primaryResolved) {
      if (outcome.kind === "failed_before_commit" || outcome.kind === "remote_committed" || outcome.kind === "commit_unknown") {
        const secOutcome = await resolveSecondaryEffectsInteractive(engine, syncKey, operationScope);
        if (secOutcome?.kind === "cancelled") { return cancelled(); }
        if (secOutcome) {
          outcome = secOutcome;
        }
      }
    }
    if (outcome.kind === "completed") {
      if (
        !hasRemainingChanges() &&
        outcome.ticketId &&
        previous?.documentUri &&
        Object.keys(rewriteDeps).length === 0
      ) {
        await renameSyncedNewTicketFileIfEligible({
          oldUri: vscode.Uri.parse(previous.documentUri),
          ticketId: outcome.ticketId,
          projectId: previous.projectId,
          connectionScope: operationScope,
        });
        refreshTicketEditorContexts();
      }
      options.onTicketCreated?.();
      showInfoResult(hasRemainingChanges()
        ? vscode.l10n.t("This sync completed. Later local changes are still waiting to sync.")
        : vscode.l10n.t("New ticket created."));
      return { status: "success", kind: "newTicket", id: outcome.ticketId, ...(hasRemainingChanges() ? { hasRemainingChanges: true } : {}) };
    }
    if (outcome.kind === "queued") {
      showInfoResult(vscode.l10n.t("Recovery completed. The item is queued for synchronization."));
      return { status: "queued", kind: "newTicket" };
    }
    if (outcome.kind === "commit_unknown" || outcome.kind === "remote_committed") { return pendingResult(outcome); }
    if (
      outcome.kind === "failed_before_commit" &&
      (outcome.error instanceof TicketSyncQueueItemNotFoundError ||
        outcome.error.message.includes("Queue entry for this new ticket not found"))
    ) {
      showWarningResult(vscode.l10n.t("Queue entry for this new ticket not found."));
      return undefined;
    }
    const message = normalizeNewTicketSyncFailureMessage(
      outcome.kind === "failed_before_commit" ? outcome.error.message : undefined,
    );
    showWarningResult(vscode.l10n.t("Sync failed: {0}", message));
    return { status: "failed", kind: "newTicket", message, reason: "api_error" };
  }

  if (syncKey.kind === "comment") {
    const engine = engineFactory();
    let outcome = await engine.syncOne(syncKey, { connectionScope: operationScope });
    const recoveryItems = engine.getRecoveryItems(syncKey, { connectionScope: operationScope });
    const primaryRecovery = recoveryItems.find((item) =>
      isPrimaryEffectKind(item.effectKind) &&
      (item.allowedActions.includes("reconcile_remote") || item.allowedActions.includes("link_remote_comment")),
    );
    if (primaryRecovery && (
      outcome.kind === "commit_unknown" ||
      outcome.kind === "failed_before_commit" ||
      (outcome.kind === "remote_committed" && outcome.pending === "remote_reconcile")
    )) {
      const resolved = await resolveCommentCommitUnknownInteractive(
        engine,
        syncKey,
        operationScope,
      );
      if (resolved?.kind === "cancelled") { return cancelled(); }
      outcome = resolved ?? outcome;
    }
    if (outcome.kind === "failed_before_commit" || outcome.kind === "remote_committed") {
      const secOutcome = await resolveSecondaryEffectsInteractive(engine, syncKey, operationScope);
      if (secOutcome?.kind === "cancelled") { return cancelled(); }
      if (secOutcome) {
        outcome = secOutcome;
      }
    }
    if (outcome.kind === "commit_unknown" || outcome.kind === "remote_committed") { return pendingResult(outcome); }
    if (outcome.kind === "completed" || outcome.kind === "no_change") {
      showInfoResult(hasRemainingChanges()
        ? vscode.l10n.t("This sync completed. Later local changes are still waiting to sync.")
        : vscode.l10n.t("Comment synced."));
      if (outcome.kind === "no_change") {
        return { status: "no_change", kind: "comment", ...(hasRemainingChanges() ? { hasRemainingChanges: true } : {}) };
      }
      return {
        status: "success",
        kind: "comment",
        id: "commentId" in outcome ? outcome.commentId : undefined,
        ...(hasRemainingChanges() ? { hasRemainingChanges: true } : {}),
      };
    } else if (outcome.kind === "queued") {
      showInfoResult(vscode.l10n.t("Recovery completed. The item is queued for synchronization."));
      return { status: "queued", kind: "comment" };
    } else if (outcome.kind === "conflict") {
      showWarningResult(vscode.l10n.t("Conflicts with remote changes detected. Open the file to review."));
      return {
        status: "conflict",
        kind: "comment",
        id: "commentId" in outcome ? outcome.commentId : syncKey.commentId,
        commentConflictContext: "commentConflictContext" in outcome ? outcome.commentConflictContext : undefined,
      };
    } else {
      const message = outcome.kind === "failed_before_commit"
        ? outcome.error.message
        : vscode.l10n.t("Unknown error");
      if (message === "Queue entry for this comment update not found.") {
        showWarningResult(vscode.l10n.t("Queue entry for this comment update not found."));
        return undefined;
      }
      showWarningResult(vscode.l10n.t("Sync failed: {0}", message ?? vscode.l10n.t("Unknown error")));
      return { status: "failed", kind: "comment", message };
    }
  }

  return undefined;
};
