import * as vscode from "vscode";
import { UnsyncedFileSyncKey } from "../app/unsyncedTypes";
import type { createSyncEngine } from "../app/ticketSync";
import { isPrimaryEffectKind } from "../app/syncEffects";
import { showManualRepairRequired, type RecoveryCancelled } from "./unsyncedRecoveryPrompt";

export const resolveSecondaryEffectsInteractive = async (
  engine: ReturnType<typeof createSyncEngine>,
  key: UnsyncedFileSyncKey,
  operationScope: string,
): Promise<Awaited<ReturnType<typeof engine.syncOne>> | RecoveryCancelled | undefined> => {
  const syncContext = { connectionScope: operationScope };
  const items = engine.getRecoveryItems(key, syncContext);
  if (showManualRepairRequired(items)) {
    return undefined;
  }
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
      if (choice !== compLabel) { return { kind: "cancelled" }; }
      if (choice === compLabel) {
        const outcome = await engine.resolveEffect({
          key,
          operationId: item.operationId,
          operationRevision: item.operationRevision,
          attemptGeneration: item.attemptGeneration,
          effectId: item.effectId,
          expectedEffectState: item.state,
          context: syncContext,
          resolution: { kind: "reconcile_compensation" },
        });
        resolvedAny = true;
        if (outcome.kind === "queued") {
          return outcome;
        }
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
      if (choice !== linkLabel && choice !== retryLabel) { return { kind: "cancelled" }; }
      if (choice === linkLabel) {
        const rawId = await vscode.window.showInputBox({
          prompt: vscode.l10n.t("Enter the Redmine child ticket ID."),
          validateInput: (val) => /^\d+$/.test(val) && Number(val) > 0 ? undefined : vscode.l10n.t("Enter a positive ticket ID."),
        });
        if (!rawId) { return { kind: "cancelled" }; }
        if (rawId) {
          const outcome = await engine.resolveEffect({
            key,
            operationId: item.operationId,
            operationRevision: item.operationRevision,
            attemptGeneration: item.attemptGeneration,
            effectId: item.effectId,
            expectedEffectState: item.state,
            context: syncContext,
            resolution: { kind: "link_remote_child", remoteId: Number(rawId) },
          });
          resolvedAny = true;
          if (outcome.kind === "queued") {
            return outcome;
          }
          if (outcome.kind !== "completed" && outcome.kind !== "no_change" && outcome.kind !== "remote_committed") {
            return outcome;
          }
        }
      } else if (choice === retryLabel) {
        const outcome = await engine.resolveEffect({
          key,
          operationId: item.operationId,
          operationRevision: item.operationRevision,
          attemptGeneration: item.attemptGeneration,
          effectId: item.effectId,
          expectedEffectState: item.state,
          context: syncContext,
          resolution: { kind: "retry_effect" },
        });
        resolvedAny = true;
        if (outcome.kind === "queued") {
          return outcome;
        }
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
      if (choice !== retryLabel) { return { kind: "cancelled" }; }
      if (choice === retryLabel) {
        const outcome = await engine.resolveEffect({
          key,
          operationId: item.operationId,
          operationRevision: item.operationRevision,
          attemptGeneration: item.attemptGeneration,
          effectId: item.effectId,
          expectedEffectState: item.state,
          context: syncContext,
          resolution: { kind: "retry_effect" },
        });
        resolvedAny = true;
        if (outcome.kind === "queued") {
          return outcome;
        }
        if (outcome.kind !== "completed" && outcome.kind !== "no_change" && outcome.kind !== "remote_committed") {
          return outcome;
        }
      }
    }
  }

  if (resolvedAny) {
    return engine.syncOne(key, syncContext);
  }
  return undefined;
};
