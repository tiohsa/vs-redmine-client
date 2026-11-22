import { evaluateAttemptClosure, type AttemptClosureBlockerReason } from "./attemptClosure";
import { normalizeAttemptGeneration } from "./attemptGeneration";
import { canRetryEffect, canRetryFailedCommentEffect, isRejectedTicketCreate } from "./effectRetry";
import { getEffectsForRevision, getPrimaryEffectForRevision, isPrimaryEffect } from "./effectSelection";
import type { DurableSyncEffect, DurableSyncEffectKind, DurableSyncEffectState } from "./effectTypes";

const isChildCreateEffect = (effect: DurableSyncEffect): boolean =>
  effect.kind === "child_create" || effect.effectId.startsWith("child-create");

export const isEffectBlockingNormalSync = (effect: DurableSyncEffect): boolean => {
  if (
    effect.state === "started" ||
    effect.state === "commit_unknown" ||
    effect.state === "failed" ||
    effect.state === "compensation_started" ||
    effect.state === "compensation_unknown"
  ) {
    return true;
  }
  return false;
};

export const isPrimaryRecoveryRequired = (
  operation?: { phase?: string },
  primaryEffect?: { state?: DurableSyncEffectState },
): boolean => {
  if (!operation) {
    return false;
  }
  if (
    operation.phase === "commit_unknown" ||
    operation.phase === "compensation_unknown" ||
    operation.phase === "compensation_started"
  ) {
    return true;
  }
  if (
    primaryEffect?.state === "commit_unknown" ||
    primaryEffect?.state === "failed" ||
    primaryEffect?.state === "compensation_unknown" ||
    primaryEffect?.state === "compensation_started"
  ) {
    return true;
  }
  if (operation.phase === "remote_write_started" && primaryEffect?.state === "started") {
    return true;
  }
  return false;
};

const isCommittedCommentIdentityPending = (
  operation: { kind?: string; phase?: string },
  primaryEffect?: { state?: DurableSyncEffectState },
): boolean => operation.kind === "comment_create" &&
  operation.phase === "reconciliation_pending" &&
  primaryEffect?.state === "committed";

export type RecoveryActionKind =
  | "retry_remote_write"
  | "reconcile_remote"
  | "link_created_ticket"
  | "link_remote_comment"
  | "assume_update_committed"
  | "retry_effect"
  | "link_remote_child"
  | "reconcile_compensation";

export type RecoveryDisposition = "actionable" | "manual_repair_required";

export type RecoveryItem = {
  operationId: string;
  operationRevision: number;
  attemptGeneration: number;
  effectId: string;
  effectKind: DurableSyncEffectKind;
  state: DurableSyncEffectState;
  message?: string;
  allowedActions: RecoveryActionKind[];
  disposition: RecoveryDisposition;
  manualRepairReason?: AttemptClosureBlockerReason;
};

export type OperationRecoveryMode =
  | "normal"
  | "commit_uncertainty"
  | "compensation_uncertainty"
  | "compensation_blocked";

export const getOperationRecoveryMode = (operation: {
  phase?: string;
  effects?: DurableSyncEffect[];
  revision?: number;
  intentRevision?: number;
  attemptGeneration?: number;
}): OperationRecoveryMode => {
  const currentRevision = operation.intentRevision ?? operation.revision ?? 1;
  const primaryEffect = getPrimaryEffectForRevision(operation, currentRevision);

  const isPrimaryCompensation =
    operation.phase === "compensation_unknown" ||
    operation.phase === "compensation_started" ||
    primaryEffect?.state === "compensation_unknown" ||
    primaryEffect?.state === "compensation_started";

  if (primaryEffect?.state === "compensated") {
    return "compensation_blocked";
  }

  if (isPrimaryCompensation) {
    return "compensation_uncertainty";
  }

  const isCommitUncertain =
    operation.phase === "commit_unknown" ||
    operation.phase === "remote_write_started" ||
    primaryEffect?.state === "commit_unknown" ||
    primaryEffect?.state === "started";

  if (isCommitUncertain) {
    return "commit_uncertainty";
  }

  return "normal";
};

const isCompensationInProgress = (state: DurableSyncEffectState): boolean =>
  state === "compensation_unknown" || state === "compensation_started";

const getPrimaryRecoveryActions = (
  operationKind: string | undefined,
  effect: DurableSyncEffect,
): RecoveryActionKind[] => {
  if (isCompensationInProgress(effect.state)) {
    return ["reconcile_compensation"];
  }

  const actions: RecoveryActionKind[] = [];
  if (operationKind === "ticket_create") {
    if (!isRejectedTicketCreate(effect)) {
      actions.push("link_created_ticket");
    }
  } else if (operationKind === "comment_create" || operationKind === "comment_update") {
    actions.push("reconcile_remote", "link_remote_comment");
    if (effect.kind === operationKind && canRetryFailedCommentEffect(effect)) {
      actions.push("retry_remote_write");
    }
    return actions;
  } else {
    actions.push("assume_update_committed", "reconcile_remote");
  }

  if (canRetryEffect(effect)) {
    actions.push("retry_remote_write");
  }
  return actions;
};

const getSecondaryRecoveryActions = (
  recoveryMode: OperationRecoveryMode,
  effect: DurableSyncEffect,
): RecoveryActionKind[] => {
  if (recoveryMode === "compensation_blocked") {
    return isCompensationInProgress(effect.state) ||
      (isChildCreateEffect(effect) && effect.state === "committed")
      ? ["reconcile_compensation"]
      : [];
  }
  if (recoveryMode === "compensation_uncertainty") {
    return isCompensationInProgress(effect.state) ? ["reconcile_compensation"] : [];
  }

  const isChild = effect.kind === "child_create" ||
    (typeof effect.effectId === "string" && effect.effectId.startsWith("child-create"));
  if (isCompensationInProgress(effect.state)) {
    return ["reconcile_compensation"];
  }
  if (isChild && effect.state === "commit_unknown") {
    return ["link_remote_child"];
  }
  return (!isChild || effect.state === "failed") && canRetryEffect(effect)
    ? ["retry_effect"]
    : [];
};

export const getRecoveryItemsForOperation = (
  operation: {
    operationId: string;
    kind?: string;
    phase?: string;
    revision?: number;
    intentRevision?: number;
    attemptGeneration?: number;
    effects?: DurableSyncEffect[];
    errorMessage?: string;
  },
): RecoveryItem[] => {
  const currentRevision = operation.intentRevision ?? operation.revision ?? 1;
  const activeEffects = getEffectsForRevision(operation, currentRevision);
  const recoveryMode = getOperationRecoveryMode(operation);
  const closureDecision = evaluateAttemptClosure(operation);
  const classificationsByEffectId = new Map(
    closureDecision.classifications.map((classification) => [classification.effectId, classification]),
  );
  const blockersByEffectId = new Map(
    closureDecision.blockers.map((blocker) => [blocker.effectId, blocker]),
  );
  const items: RecoveryItem[] = [];

  const manualRepairMessage = (detail?: string): string => detail ??
    "Manual repair required. A committed remote effect cannot be proven safe to retry or to belong to the compensated parent operation. Automatic recovery is disabled to avoid a duplicate remote mutation.";

  for (const effect of activeEffects) {
    const isPrimary = isPrimaryEffect(effect);

    if (isPrimary) {
      if (
        isPrimaryRecoveryRequired(operation, effect) ||
        isCommittedCommentIdentityPending(operation, effect)
      ) {
        const allowedActions = getPrimaryRecoveryActions(operation.kind, effect);
        items.push({
          operationId: operation.operationId,
          operationRevision: effect.operationRevision,
          attemptGeneration: normalizeAttemptGeneration(
            operation.attemptGeneration ?? effect.attemptGeneration,
          ),
          effectId: effect.effectId,
          effectKind: effect.kind,
          state: effect.state,
          message: effect.failure?.detail ?? effect.detail ?? operation.errorMessage,
          allowedActions,
          disposition: allowedActions.length > 0 ? "actionable" : "manual_repair_required",
          ...(allowedActions.length === 0
            ? {
              manualRepairReason: blockersByEffectId.get(effect.effectId)?.reason ?? "RECOVERY_REQUIRED",
              message: manualRepairMessage(blockersByEffectId.get(effect.effectId)?.detail),
            }
            : {}),
        });
      }
    } else {
      const classification = classificationsByEffectId.get(effect.effectId);
      const isCompensationBlockedEffect =
        recoveryMode === "compensation_blocked" &&
        classification !== undefined &&
        classification.classification !== "NO_REMOTE_OBLIGATION" &&
        classification.classification !== "COMPENSATED" &&
        classification.classification !== "COVERED_BY_PARENT_COMPENSATION";
      if (
        isCompensationBlockedEffect ||
        effect.state === "failed" ||
        effect.state === "commit_unknown" ||
        effect.state === "compensation_unknown" ||
        effect.state === "compensation_started"
      ) {
        const allowedActions = getSecondaryRecoveryActions(recoveryMode, effect);
        const blocker = blockersByEffectId.get(effect.effectId);
        const requiresManualRepair = allowedActions.length === 0;
        items.push({
          operationId: operation.operationId,
          operationRevision: effect.operationRevision,
          attemptGeneration: normalizeAttemptGeneration(
            operation.attemptGeneration ?? effect.attemptGeneration,
          ),
          effectId: effect.effectId,
          effectKind: effect.kind,
          state: effect.state,
          message: requiresManualRepair
            ? manualRepairMessage(blocker?.detail)
            : effect.failure?.detail ?? effect.detail,
          allowedActions,
          disposition: requiresManualRepair ? "manual_repair_required" : "actionable",
          ...(requiresManualRepair
            ? { manualRepairReason: blocker?.reason ?? "RECOVERY_REQUIRED" }
            : {}),
        });
      }
    }
  }

  for (const blocker of recoveryMode === "compensation_blocked"
    ? closureDecision.blockers
    : []) {
    if (items.some((item) => item.effectId === blocker.effectId)) {
      continue;
    }
    const effect = activeEffects.find((candidate) => candidate.effectId === blocker.effectId);
    items.push({
      operationId: operation.operationId,
      operationRevision: blocker.operationRevision ?? currentRevision,
      attemptGeneration: blocker.attemptGeneration ?? normalizeAttemptGeneration(operation.attemptGeneration),
      effectId: blocker.effectId,
      effectKind: blocker.effectKind ?? effect?.kind ?? "local_finalize",
      state: blocker.state ?? effect?.state ?? "failed",
      message: manualRepairMessage(blocker.detail),
      allowedActions: [],
      disposition: "manual_repair_required",
      manualRepairReason: blocker.reason,
    });
  }

  return items;
};
