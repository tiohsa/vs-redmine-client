import * as vscode from "vscode";
import {
  getOfflineSyncQueue,
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
import type {
  TicketSyncOutcome,
  TicketSyncQueueKey,
} from "../app/ticketSync";
import { isPrimaryEffectKind } from "../app/syncEffects";
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
  createSyncEngine?: typeof createSyncEngine;
};

const normalizeNewTicketSyncFailureMessage = (message?: string): string => {
  if (message === "Ticket subject is required.") {
    return vscode.l10n.t("Subject is missing. Enter a subject in the Markdown heading line and sync again.");
  }
  return message ?? vscode.l10n.t("Unknown error");
};

const resolveCommitUnknownInteractive = async (
  service: ReturnType<ReturnType<typeof createSyncEngine>["ticketService"]>,
  engine: ReturnType<typeof createSyncEngine>,
  key: TicketSyncQueueKey,
  operationScope: string,
): Promise<TicketSyncOutcome | undefined> => {
  const syncContext = { connectionScope: operationScope };
  const items = engine.getRecoveryItems(key as any, syncContext);
  const primaryItem = items.find((item) => isPrimaryEffectKind(item.effectKind));
  const actions = primaryItem?.allowedActions ?? [];

  const retryLabel = vscode.l10n.t("Retry remote write");
  const compLabel = vscode.l10n.t("Clean up remote write (Reconcile compensation)");

  if (actions.includes("reconcile_compensation") || primaryItem?.state === "compensation_unknown" || primaryItem?.state === "compensation_started") {
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t("The previous operation has pending compensation on Redmine. Reconcile compensation to clean up remote side?"),
      { modal: true },
      compLabel,
    );
    if (choice === compLabel) {
      return service.resolveCommitUnknown({
        key,
        context: syncContext,
        resolution: { kind: "reconcile_compensation" },
      });
    }
    return undefined;
  }

  if (key.kind === "newTicket") {
    const linkLabel = vscode.l10n.t("Link existing ticket");
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t("The previous ticket creation may have reached Redmine. Link the created ticket ID, or retry only after confirming that no ticket was created."),
      { modal: true },
      linkLabel,
      retryLabel,
    );
    if (choice === linkLabel) {
      const rawTicketId = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("Enter the Redmine ticket ID created by the previous attempt."),
        validateInput: (value) => /^\d+$/.test(value) && Number(value) > 0
          ? undefined
          : vscode.l10n.t("Enter a positive ticket ID."),
      });
      if (!rawTicketId) {
        return undefined;
      }
      return service.resolveCommitUnknown({
        key,
        context: syncContext,
        resolution: { kind: "link_created_ticket", ticketId: Number(rawTicketId) },
      });
    }
    if (choice === retryLabel) {
      return service.resolveCommitUnknown({
        key,
        context: syncContext,
        resolution: { kind: "retry_remote_write" },
      });
    }
    return undefined;
  }

  const committedLabel = vscode.l10n.t("Treat as committed");
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t("The previous ticket update may have reached Redmine. Reconcile from Redmine, or retry only after confirming that the update was not applied."),
    { modal: true },
    committedLabel,
    retryLabel,
  );
  if (choice === committedLabel) {
    return service.resolveCommitUnknown({
      key,
      context: syncContext,
      resolution: { kind: "assume_update_committed" },
    });
  }
  if (choice === retryLabel) {
    return service.resolveCommitUnknown({
      key,
      context: syncContext,
      resolution: { kind: "retry_remote_write" },
    });
  }
  return undefined;
};

const resolveCommentCommitUnknownInteractive = async (
  engine: ReturnType<typeof createSyncEngine>,
  key: Extract<UnsyncedFileSyncKey, { kind: "comment" }>,
  operationScope: string,
): Promise<Awaited<ReturnType<typeof engine.syncOne>> | undefined> => {
  const reconcileLabel = vscode.l10n.t("Reconcile from Redmine");
  const linkLabel = vscode.l10n.t("Link comment journal");
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t("The previous comment write may have reached Redmine. Check Redmine for one uniquely matching journal without sending the comment again."),
    { modal: true },
    reconcileLabel,
    linkLabel,
  );
  if (choice === linkLabel) {
    const rawCommentId = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Enter the Redmine comment journal ID to verify and link."),
      validateInput: (value) => /^\d+$/.test(value) && Number(value) > 0
        ? undefined
        : vscode.l10n.t("Enter a positive comment journal ID."),
    });
    if (!rawCommentId) { return undefined; }
    return engine.resolveCommentCommitUnknown({
      key,
      context: { connectionScope: operationScope },
      resolution: { kind: "link_remote_comment", commentId: Number(rawCommentId) },
    });
  }
  if (choice !== reconcileLabel) { return undefined; }
  return engine.resolveCommentCommitUnknown({
    key,
    context: { connectionScope: operationScope },
    resolution: { kind: "reconcile_remote" },
  });
};

const resolveSecondaryEffectsInteractive = async (
  engine: ReturnType<typeof createSyncEngine>,
  key: UnsyncedFileSyncKey,
  operationScope: string,
): Promise<Awaited<ReturnType<typeof engine.syncOne>> | undefined> => {
  const syncContext = { connectionScope: operationScope };
  const items = engine.getRecoveryItems(key as any, syncContext);
  const primaryItem = items.find((item) => isPrimaryEffectKind(item.effectKind));
  if (
    primaryItem &&
    (primaryItem.state === "compensation_unknown" ||
      primaryItem.state === "compensation_started" ||
      primaryItem.allowedActions.includes("reconcile_compensation"))
  ) {
    return undefined;
  }
  const secondaryItems = items.filter((item) => !isPrimaryEffectKind(item.effectKind) && item.allowedActions.length > 0);
  if (secondaryItems.length === 0) {
    return undefined;
  }

  const retryLabel = vscode.l10n.t("Retry");
  const linkLabel = vscode.l10n.t("Link existing ID");
  const compLabel = vscode.l10n.t("Clean up remote issue (Reconcile compensation)");

  let resolvedAny = false;

  for (const item of secondaryItems) {
    const actions = item.allowedActions;
    if (actions.length === 0) {
      continue;
    }

    if (actions.includes("reconcile_compensation") || item.state === "compensation_unknown" || item.state === "compensation_started") {
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t("Child issue creation failed or timed out and requires compensation on Redmine. Reconcile compensation?"),
        { modal: true },
        compLabel,
      );
      if (choice === compLabel) {
        const outcome = await engine.resolveEffect({
          key: key as any,
          operationId: item.operationId,
          operationRevision: item.operationRevision,
          effectId: item.effectId,
          expectedEffectState: item.state,
          context: syncContext,
          resolution: { kind: "reconcile_compensation" },
        });
        resolvedAny = true;
        if (outcome.kind !== "completed" && outcome.kind !== "no_change" && outcome.kind !== "remote_committed") {
          return outcome;
        }
      }
    } else if (actions.includes("link_remote_child")) {
      const choices = [linkLabel];
      if (actions.includes("retry_effect")) {
        choices.push(retryLabel);
      }
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t("Child issue creation outcome is unknown. Link existing child ticket ID?"),
        { modal: true },
        ...choices,
      );
      if (choice === linkLabel) {
        const rawId = await vscode.window.showInputBox({
          prompt: vscode.l10n.t("Enter the Redmine child ticket ID."),
          validateInput: (val) => /^\d+$/.test(val) && Number(val) > 0 ? undefined : vscode.l10n.t("Enter a positive ticket ID."),
        });
        if (rawId) {
          const outcome = await engine.resolveEffect({
            key: key as any,
            operationId: item.operationId,
            operationRevision: item.operationRevision,
            effectId: item.effectId,
            expectedEffectState: item.state,
            context: syncContext,
            resolution: { kind: "link_remote_child", remoteId: Number(rawId) },
          });
          resolvedAny = true;
          if (outcome.kind !== "completed" && outcome.kind !== "no_change" && outcome.kind !== "remote_committed") {
            return outcome;
          }
        }
      } else if (choice === retryLabel) {
        const outcome = await engine.resolveEffect({
          key: key as any,
          operationId: item.operationId,
          operationRevision: item.operationRevision,
          effectId: item.effectId,
          expectedEffectState: item.state,
          context: syncContext,
          resolution: { kind: "retry_effect" },
        });
        resolvedAny = true;
        if (outcome.kind !== "completed" && outcome.kind !== "no_change" && outcome.kind !== "remote_committed") {
          return outcome;
        }
      }
    } else if (actions.includes("retry_effect")) {
      const choice = await vscode.window.showWarningMessage(
        item.state === "failed"
          ? vscode.l10n.t("Secondary operation '{0}' failed: {1}. Do you want to retry?", item.effectId, item.message ?? "")
          : vscode.l10n.t("Upload outcome for '{0}' is unknown. Retry?", item.effectId),
        { modal: true },
        retryLabel,
      );
      if (choice === retryLabel) {
        const outcome = await engine.resolveEffect({
          key: key as any,
          operationId: item.operationId,
          operationRevision: item.operationRevision,
          effectId: item.effectId,
          expectedEffectState: item.state,
          context: syncContext,
          resolution: { kind: "retry_effect" },
        });
        resolvedAny = true;
        if (outcome.kind !== "completed" && outcome.kind !== "no_change" && outcome.kind !== "remote_committed") {
          return outcome;
        }
      }
    }
  }

  if (resolvedAny) {
    return engine.syncOne(key as any, syncContext);
  }
  return undefined;
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
      if (resolved) {
        outcome = resolved;
        primaryResolved = true;
      }
    }
    if (!hasPrimaryRecovery || primaryResolved) {
      if (outcome.kind === "failed_before_commit" || outcome.kind === "remote_committed" || outcome.kind === "commit_unknown") {
        const secOutcome = await resolveSecondaryEffectsInteractive(engine, syncKey, operationScope);
        if (secOutcome) {
          outcome = secOutcome;
        }
      }
    }
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
        (outcome.error instanceof TicketSyncQueueItemNotFoundError ||
          outcome.error.message.includes("Queue entry for this ticket update not found"))
      ) {
        showWarning(vscode.l10n.t("Queue entry for this ticket update not found."));
        return undefined;
      }
      const message = outcome.kind === "remote_committed"
        ? outcome.message
        : outcome.kind === "commit_unknown"
          ? outcome.message
        : outcome.kind === "failed_before_commit"
          ? outcome.error.message
          : vscode.l10n.t("Unknown error");
      showWarning(vscode.l10n.t("Sync failed: {0}", message ?? vscode.l10n.t("Unknown error")));
      return { status: "failed", kind: "ticket", message };
    }
  }

  if (syncKey.kind === "newTicket") {
    const previousPhase = getOfflineSyncQueue(operationScope).newTickets.find(
      (candidate) =>
        syncKey.documentUri && candidate.documentUri === syncKey.documentUri,
    )?.phase;
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
      (outcome.kind === "failed_before_commit" && hasPrimaryRecovery)
    ) {
      const resolved = await resolveCommitUnknownInteractive(engine.ticketService(), engine, syncKey, operationScope);
      if (resolved) {
        outcome = resolved;
        primaryResolved = true;
      }
    }
    if (!hasPrimaryRecovery || primaryResolved) {
      if (outcome.kind === "failed_before_commit" || outcome.kind === "remote_committed" || outcome.kind === "commit_unknown") {
        const secOutcome = await resolveSecondaryEffectsInteractive(engine, syncKey, operationScope);
        if (secOutcome) {
          outcome = secOutcome;
        }
      }
    }
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
    if (outcome.kind === "commit_unknown") {
      showWarning(outcome.message);
      return {
        status: "failed",
        kind: "newTicket",
        message: outcome.message,
        reason: "api_error",
      };
    }
    if (
      outcome.kind === "failed_before_commit" &&
      (outcome.error instanceof TicketSyncQueueItemNotFoundError ||
        outcome.error.message.includes("Queue entry for this new ticket not found"))
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
    const previousPhase = getOfflineSyncQueue(operationScope).comments.find((comment) =>
      comment.ticketId === syncKey.ticketId &&
      ((syncKey.commentId !== undefined && comment.commentId === syncKey.commentId) ||
        (syncKey.documentUri !== undefined && comment.documentUri === syncKey.documentUri)),
    )?.phase;
    const engine = engineFactory();
    let outcome = await engine.syncOne(syncKey, { connectionScope: operationScope });
    if (
      outcome.kind === "commit_unknown" &&
      (previousPhase === "commit_unknown" || previousPhase === "remote_write_started")
    ) {
      outcome = await resolveCommentCommitUnknownInteractive(
        engine,
        syncKey,
        operationScope,
      ) ?? outcome;
    }
    if (outcome.kind === "failed_before_commit" || outcome.kind === "remote_committed") {
      const secOutcome = await resolveSecondaryEffectsInteractive(engine, syncKey, operationScope);
      if (secOutcome) {
        outcome = secOutcome;
      }
    }
    if (outcome.kind === "completed" || outcome.kind === "no_change") {
      showInfo(vscode.l10n.t("Comment synced."));
      if (outcome.kind === "no_change") {
        return { status: "no_change", kind: "comment" };
      }
      return {
        status: "success",
        kind: "comment",
        id: (outcome as { commentId?: number }).commentId,
      };
    } else if (outcome.kind === "conflict") {
      showWarning(vscode.l10n.t("Conflicts with remote changes detected. Open the file to review."));
      return { status: "conflict", kind: "comment" };
    } else {
      const message = outcome.kind === "failed_before_commit"
        ? outcome.error.message
        : outcome.kind === "commit_unknown" || outcome.kind === "remote_committed"
          ? outcome.message
        : vscode.l10n.t("Unknown error");
      if (message === "Queue entry for this comment update not found.") {
        showWarning(vscode.l10n.t("Queue entry for this comment update not found."));
        return undefined;
      }
      showWarning(vscode.l10n.t("Sync failed: {0}", message ?? vscode.l10n.t("Unknown error")));
      return { status: "failed", kind: "comment", message };
    }
  }

  return undefined;
};
