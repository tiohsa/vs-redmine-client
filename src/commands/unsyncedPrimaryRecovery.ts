import * as vscode from "vscode";
import { UnsyncedFileSyncKey } from "../app/unsyncedTypes";
import { getCurrentConnectionScope } from "../config/connectionScope";
import type { createSyncEngine } from "../app/ticketSync";
import type { TicketSyncOutcome, TicketSyncQueueKey } from "../app/ticketSync";
import { isPrimaryEffectKind } from "../app/syncEffects";
import { showManualRepairRequired, type RecoveryCancelled } from "./unsyncedRecoveryPrompt";

export const resolveCommitUnknownInteractive = async (
  service: ReturnType<ReturnType<typeof createSyncEngine>["ticketService"]>,
  engine: ReturnType<typeof createSyncEngine>,
  key: TicketSyncQueueKey,
  operationScope: string,
): Promise<TicketSyncOutcome | RecoveryCancelled | undefined> => {
  const syncContext = { connectionScope: operationScope };
  const items = engine.getRecoveryItems(key, syncContext);
  const primaryItem = items.find((item) => isPrimaryEffectKind(item.effectKind));
  const actions = primaryItem?.allowedActions ?? [];

  const failedCreate = key.kind === "newTicket" && primaryItem?.state === "failed" && !actions.includes("link_created_ticket");
  const retryLabel = failedCreate ? vscode.l10n.t("Retry sync") : vscode.l10n.t("Retry remote write");
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
        attemptGeneration: primaryItem?.attemptGeneration,
        resolution: { kind: "reconcile_compensation" },
      });
    }
    return { kind: "cancelled" };
  }

  if (showManualRepairRequired(items)) {
    return undefined;
  }

  if (key.kind === "newTicket") {
    const linkLabel = vscode.l10n.t("Link existing ticket");
    const createChoices = [
      ...(actions.includes("link_created_ticket") ? [linkLabel] : []),
      ...(actions.includes("retry_remote_write") ? [retryLabel] : []),
    ];
    if (createChoices.length === 0) { return undefined; }
    const choice = await vscode.window.showWarningMessage(
      failedCreate ? vscode.l10n.t("Failed to create issue (HTTP {0}).", 403) : vscode.l10n.t("The previous ticket creation may have reached Redmine. Link the created ticket ID, or retry only after confirming that no ticket was created."),
      { modal: true },
      ...createChoices,
    );
    if (choice === linkLabel) {
      const rawTicketId = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("Enter the Redmine ticket ID created by the previous attempt."),
        validateInput: (value) => /^\d+$/.test(value) && Number(value) > 0
          ? undefined
          : vscode.l10n.t("Enter a positive ticket ID."),
      });
      if (!rawTicketId) {
        return { kind: "cancelled" };
      }
      return service.resolveCommitUnknown({
        key,
        context: syncContext,
        attemptGeneration: primaryItem?.attemptGeneration,
        resolution: { kind: "link_created_ticket", ticketId: Number(rawTicketId) },
      });
    }
    if (choice === retryLabel) {
      if (getCurrentConnectionScope() !== operationScope) { return { kind: "cancelled" }; }
      return service.resolveCommitUnknown({
        key,
        context: syncContext,
        attemptGeneration: primaryItem?.attemptGeneration,
        operationId: primaryItem?.operationId,
        operationRevision: primaryItem?.operationRevision,
        resolution: { kind: "retry_remote_write" },
      });
    }
    return { kind: "cancelled" };
  }

  const committedLabel = vscode.l10n.t("Treat as committed");
  const reconcileLabel = vscode.l10n.t("Reconcile from Redmine");
  const updateChoices = [
    ...(actions.includes("reconcile_remote") ? [reconcileLabel] : []),
    ...(actions.includes("assume_update_committed") ? [committedLabel] : []),
    ...(actions.includes("retry_remote_write") ? [retryLabel] : []),
  ];
  if (updateChoices.length === 0) { return undefined; }
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t("The previous ticket update may have reached Redmine. Reconcile from Redmine, or retry only after confirming that the update was not applied."),
    { modal: true },
    ...updateChoices,
  );
  if (choice === committedLabel) {
    return service.resolveCommitUnknown({
      key,
      context: syncContext,
      attemptGeneration: primaryItem?.attemptGeneration,
      resolution: { kind: "assume_update_committed" },
    });
  }
  if (choice === retryLabel) {
    return service.resolveCommitUnknown({
      key,
      context: syncContext,
      attemptGeneration: primaryItem?.attemptGeneration,
      resolution: { kind: "retry_remote_write" },
    });
  }
  if (choice === reconcileLabel) {
    return service.resolveCommitUnknown({
      key,
      context: syncContext,
      attemptGeneration: primaryItem?.attemptGeneration,
      resolution: { kind: "reconcile_remote" },
    });
  }
  return { kind: "cancelled" };
};

export const resolveCommentCommitUnknownInteractive = async (
  engine: ReturnType<typeof createSyncEngine>,
  key: Extract<UnsyncedFileSyncKey, { kind: "comment" }>,
  operationScope: string,
): Promise<Awaited<ReturnType<typeof engine.syncOne>> | RecoveryCancelled | undefined> => {
  const recoveryItems = engine.getRecoveryItems(key, { connectionScope: operationScope });
  if (showManualRepairRequired(recoveryItems)) {
    return undefined;
  }
  const primaryItem = recoveryItems.find((item) => isPrimaryEffectKind(item.effectKind));
  const actions = primaryItem?.allowedActions ?? [];
  const reconcileLabel = vscode.l10n.t("Reconcile from Redmine");
  const linkLabel = vscode.l10n.t("Link comment journal");
  const retryLabel = vscode.l10n.t("Retry remote write");
  const choices = [
    ...(actions.includes("reconcile_remote") ? [reconcileLabel] : []),
    ...(actions.includes("link_remote_comment") ? [linkLabel] : []),
    ...(actions.includes("retry_remote_write") ? [retryLabel] : []),
  ];
  if (choices.length === 0 || !primaryItem) {
    return undefined;
  }
  const choice = await vscode.window.showWarningMessage(
    actions.includes("retry_remote_write")
      ? vscode.l10n.t("The previous comment write failed. Retry the saved request, or reconcile from Redmine.")
      : vscode.l10n.t("The previous comment write may have reached Redmine. Check Redmine for one uniquely matching journal without sending the comment again."),
    { modal: true },
    ...choices,
  );
  if (choice === retryLabel) {
    return engine.resolveCommentCommitUnknown({
      key,
      context: { connectionScope: operationScope },
      operationId: primaryItem.operationId,
      operationRevision: primaryItem.operationRevision,
      attemptGeneration: primaryItem.attemptGeneration,
      resolution: { kind: "retry_remote_write" },
    });
  }
  if (choice === linkLabel) {
    const rawCommentId = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Enter the Redmine comment journal ID to verify and link."),
      validateInput: (value) => /^\d+$/.test(value) && Number(value) > 0
        ? undefined
        : vscode.l10n.t("Enter a positive comment journal ID."),
    });
    if (!rawCommentId) { return { kind: "cancelled" }; }
    return engine.resolveCommentCommitUnknown({
      key,
      context: { connectionScope: operationScope },
      operationId: primaryItem.operationId,
      operationRevision: primaryItem.operationRevision,
      attemptGeneration: primaryItem.attemptGeneration,
      resolution: { kind: "link_remote_comment", commentId: Number(rawCommentId) },
    });
  }
  if (choice !== reconcileLabel) { return { kind: "cancelled" }; }
  return engine.resolveCommentCommitUnknown({
    key,
    context: { connectionScope: operationScope },
    operationId: primaryItem.operationId,
    operationRevision: primaryItem.operationRevision,
    attemptGeneration: primaryItem.attemptGeneration,
    resolution: { kind: "reconcile_remote" },
  });
};
