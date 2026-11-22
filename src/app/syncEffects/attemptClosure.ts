import { normalizeAttemptGeneration } from "./attemptGeneration";
import { isPrimaryEffect } from "./effectSelection";
import type { DurableSyncEffect, DurableSyncEffectKind, DurableSyncEffectState } from "./effectTypes";

export type AttemptClosureClassification =
  | "NO_REMOTE_OBLIGATION"
  | "COMPENSATED"
  | "COVERED_BY_PARENT_COMPENSATION"
  | "EXPLICIT_COMPENSATION_REQUIRED"
  | "RECOVERY_REQUIRED"
  | "INVARIANT_VIOLATION";

export type AttemptEffectClassification = {
  effectId: string;
  effectKind: DurableSyncEffectKind;
  kind: DurableSyncEffectKind;
  operationRevision: number;
  attemptGeneration: number;
  state: DurableSyncEffectState;
  classification: AttemptClosureClassification;
};

export type AttemptEffectCoverage = AttemptEffectClassification;

export type AttemptClosureBlockerReason =
  | "REMOTE_OUTCOME_UNKNOWN"
  | "ROLLBACK_REQUIRED"
  | "COVERAGE_MISSING"
  | "RECOVERY_REQUIRED"
  | "INVARIANT_VIOLATION";

export type AttemptClosureBlocker = {
  effectId: string;
  effectKind?: DurableSyncEffectKind;
  state?: DurableSyncEffectState;
  operationRevision?: number;
  attemptGeneration?: number;
  classification: AttemptClosureClassification;
  reason: AttemptClosureBlockerReason;
  detail?: string;
};

export type AttemptClosureDecision = {
  closable: boolean;
  operationRevision: number;
  attemptGeneration: number;
  blockers: readonly AttemptClosureBlocker[];
  coveredEffects: readonly AttemptEffectCoverage[];
  classifications: readonly AttemptEffectClassification[];
};

export type AttemptClosureEvaluationOperation = {
  effects?: readonly DurableSyncEffect[];
  revision?: number;
  intentRevision?: number;
  attemptGeneration?: number;
};

const hasRemoteIdentity = (effect: DurableSyncEffect): boolean =>
  effect.remoteId !== undefined ||
  (typeof effect.token === "string" && effect.token.length > 0) ||
  (typeof effect.target.token === "string" && effect.target.token.length > 0);

const getEffectToken = (effect: DurableSyncEffect): string | undefined => {
  if (typeof effect.token === "string" && effect.token.length > 0) {
    return effect.token;
  }
  return undefined;
};

const getClassificationForState = (
  effect: DurableSyncEffect,
): AttemptClosureClassification => {
  switch (effect.state) {
    case "planned":
      return "NO_REMOTE_OBLIGATION";
    case "failed":
      return hasRemoteIdentity(effect)
        ? "INVARIANT_VIOLATION"
        : "NO_REMOTE_OBLIGATION";
    case "compensated":
      return "COMPENSATED";
    case "started":
    case "commit_unknown":
    case "compensation_started":
    case "compensation_unknown":
      return "RECOVERY_REQUIRED";
    case "committed":
      if (effect.kind === "local_finalize") {
        return "NO_REMOTE_OBLIGATION";
      }
      if (effect.kind === "image_upload") {
        return "RECOVERY_REQUIRED";
      }
      if (effect.kind === "attachment_upload") {
        return "RECOVERY_REQUIRED";
      }
      return "EXPLICIT_COMPENSATION_REQUIRED";
  }
};

const getBlockerReason = (
  classification: AttemptClosureClassification,
  effect: AttemptEffectClassification,
): AttemptClosureBlockerReason | undefined => {
  switch (classification) {
    case "INVARIANT_VIOLATION":
      return "INVARIANT_VIOLATION";
    case "EXPLICIT_COMPENSATION_REQUIRED":
      return "ROLLBACK_REQUIRED";
    case "RECOVERY_REQUIRED":
      if (
        effect.state === "started" ||
        effect.state === "commit_unknown" ||
        effect.state === "compensation_started" ||
        effect.state === "compensation_unknown"
      ) {
        return "REMOTE_OUTCOME_UNKNOWN";
      }
      if (effect.kind === "attachment_upload") {
        return "COVERAGE_MISSING";
      }
      return "RECOVERY_REQUIRED";
    case "NO_REMOTE_OBLIGATION":
    case "COMPENSATED":
    case "COVERED_BY_PARENT_COMPENSATION":
      return undefined;
  }
};

const isTicketCreatePrimary = (effect: DurableSyncEffect): boolean =>
  effect.kind === "ticket_create" || effect.effectId === "ticket-create";

export const evaluateAttemptClosure = (
  input: AttemptClosureEvaluationOperation | readonly DurableSyncEffect[] | undefined,
  targetRevision?: number,
  targetAttemptGeneration?: number,
): AttemptClosureDecision => {
  const isEffectList = Array.isArray(input);
  const operation = !isEffectList && input !== undefined
    ? (input as AttemptClosureEvaluationOperation)
    : undefined;
  const effects: readonly DurableSyncEffect[] | undefined = operation
    ? operation.effects
    : (input as readonly DurableSyncEffect[] | undefined);
  const firstEffect = effects?.[0];
  const operationRevision =
    targetRevision ??
    operation?.intentRevision ??
    operation?.revision ??
    firstEffect?.operationRevision ??
    1;
  const attemptGeneration = normalizeAttemptGeneration(
    targetAttemptGeneration ?? operation?.attemptGeneration ?? firstEffect?.attemptGeneration,
  );
  const activeEffects: DurableSyncEffect[] = [];

  for (const effect of effects ?? []) {
    if (normalizeAttemptGeneration(effect.attemptGeneration) === attemptGeneration) {
      activeEffects.push(effect);
    }
  }

  const classifications: AttemptEffectClassification[] = [];
  const primaryEffects: DurableSyncEffect[] = [];
  const attachmentIndexes: Array<{ effect: DurableSyncEffect; index: number }> = [];

  for (const effect of activeEffects) {
    const hasExplicitRevision = typeof effect.operationRevision === "number";
    const effectRevision = effect.operationRevision ?? operationRevision;
    const effectClassification =
      (operation !== undefined && !hasExplicitRevision) || effectRevision !== operationRevision
        ? "INVARIANT_VIOLATION"
        : getClassificationForState(effect);
    const record: AttemptEffectClassification = {
      effectId: effect.effectId,
      effectKind: effect.kind,
      kind: effect.kind,
      operationRevision: effectRevision,
      attemptGeneration: normalizeAttemptGeneration(effect.attemptGeneration),
      state: effect.state,
      classification: effectClassification,
    };
    classifications.push(record);
    const index = classifications.length - 1;

    if (isPrimaryEffect(effect)) {
      primaryEffects.push(effect);
    }
    if (effect.kind === "attachment_upload" && effect.state === "committed") {
      attachmentIndexes.push({ effect, index });
    }
  }

  const primary = primaryEffects.length === 1 ? primaryEffects[0] : undefined;
  const primaryCanCoverAttachments =
    primary !== undefined &&
    isTicketCreatePrimary(primary) &&
    primary.state === "compensated" &&
    primary.operationRevision === operationRevision &&
    normalizeAttemptGeneration(primary.attemptGeneration) === attemptGeneration &&
    primary.requestSnapshot?.kind === "ticket_create";
  const primaryUploads = primaryCanCoverAttachments && primary?.requestSnapshot?.kind === "ticket_create"
    ? primary.requestSnapshot.request.uploads
    : undefined;
  const primaryUploadTokens: ReadonlySet<string> | undefined = primaryUploads === undefined
    ? undefined
    : new Set(primaryUploads.map((upload) => upload.token));

  for (const candidate of attachmentIndexes) {
    const token = getEffectToken(candidate.effect);
    const covered =
      classifications[candidate.index].classification === "RECOVERY_REQUIRED" &&
      primaryCanCoverAttachments &&
      candidate.effect.operationRevision === operationRevision &&
      normalizeAttemptGeneration(candidate.effect.attemptGeneration) === attemptGeneration &&
      token !== undefined &&
      primaryUploadTokens?.has(token) === true;
    if (covered) {
      classifications[candidate.index] = {
        ...classifications[candidate.index],
        classification: "COVERED_BY_PARENT_COMPENSATION",
      };
    }
  }

  const blockers: AttemptClosureBlocker[] = [];
  for (const classification of classifications) {
    const reason = getBlockerReason(classification.classification, classification);
    if (reason !== undefined) {
      blockers.push({
        effectId: classification.effectId,
        effectKind: classification.effectKind,
        state: classification.state,
        operationRevision: classification.operationRevision,
        attemptGeneration: classification.attemptGeneration,
        classification: classification.classification,
        reason,
      });
    }
  }

  if (primaryEffects.length > 1) {
    blockers.push({
      effectId: "__primary__",
      classification: "INVARIANT_VIOLATION",
      reason: "INVARIANT_VIOLATION",
      detail: "Multiple Primary effects exist in the current Attempt generation",
    });
  } else if (operation !== undefined && primary === undefined) {
    blockers.push({
      effectId: "__primary__",
      classification: "INVARIANT_VIOLATION",
      reason: "INVARIANT_VIOLATION",
      detail: "Attempt closure requires exactly one Primary effect",
    });
  } else if (primary !== undefined && primary.state !== "compensated") {
    const primaryClassification = classifications.find(
      (classification) => classification.effectId === primary.effectId,
    );
    if (primaryClassification && getBlockerReason(primaryClassification.classification, primaryClassification) === undefined) {
      blockers.push({
        effectId: primary.effectId,
        effectKind: primary.kind,
        state: primary.state,
        operationRevision: primary.operationRevision,
        attemptGeneration: normalizeAttemptGeneration(primary.attemptGeneration),
        classification: "INVARIANT_VIOLATION",
        reason: "INVARIANT_VIOLATION",
        detail: "Attempt closure requires the Primary effect to be compensated",
      });
    }
  }

  const coveredEffects = classifications.filter(
    (classification) => classification.classification === "COVERED_BY_PARENT_COMPENSATION",
  );

  return {
    closable: blockers.length === 0,
    operationRevision,
    attemptGeneration,
    blockers,
    coveredEffects,
    classifications,
  };
};

export const isAttemptClosureSafe = (
  effects: readonly DurableSyncEffect[] | undefined,
): boolean => evaluateAttemptClosure(effects).closable;
