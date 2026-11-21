import type {
  GenericLifecycleAction,
  GenericSyncPhase,
  LifecycleExpectation,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import {
  applyGenericTransition,
  retainDurableEffectsForRetry,
} from "./syncStateMachine";
import {
  DurableSyncEffect,
  DurableSyncEffectAction,
  getAttemptGeneration,
  normalizeAttemptGeneration,
  isPrimaryEffectKind,
  isRejectedTicketCreate,
  transitionDurableSyncEffect,
} from "../syncEffects";

import type { PrimaryRemoteTransition } from "./syncRepositoryTypes";

const matchesPrimarySourcePhase = (actual: GenericSyncPhase, expected?: GenericSyncPhase): boolean => {
  if (!expected || actual === expected) {
    return true;
  }
  const isStartedMatch =
    (expected === "queued" || expected === "preparing") &&
    (actual === "queued" || actual === "preparing" || actual === "remote_write_started");
  const isRetryMatch =
    (expected === "commit_unknown" || expected === "queued") &&
    (actual === "commit_unknown" || actual === "queued" || actual === "remote_write_started");
  return isStartedMatch || isRetryMatch;
};

const matchesPrimaryTransitionExpectation = (
  current: UnifiedSyncOperation,
  expected?: LifecycleExpectation,
): boolean => !expected || (
  (!expected.operationId || current.operationId === expected.operationId) &&
  matchesPrimarySourcePhase(current.phase, expected.sourcePhase) &&
  (expected.revision === undefined || current.revision === expected.revision) &&
  (expected.attemptGeneration === undefined ||
    getAttemptGeneration(current) === normalizeAttemptGeneration(expected.attemptGeneration))
);

const initialPrimaryEffect = (
  operation: UnifiedSyncOperation,
  transition: PrimaryRemoteTransition,
  effectId: string,
  kind: DurableSyncEffect["kind"],
  operationRevision: number,
  attemptGeneration: number,
): DurableSyncEffect | undefined => {
  if (transition.kind === "reconcile" || transition.kind === "assume_committed") {
    return undefined;
  }
  const effect: DurableSyncEffect = {
    effectId,
    kind,
    operationRevision,
    attemptGeneration,
    state: transition.kind === "start" || transition.kind === "start_explicit_retry" ? "planned" : "started",
    target: { documentUri: operation.documentUri, ticketId: operation.ticketId, commentId: operation.commentId },
  };
  if (transition.kind === "start" || transition.kind === "start_explicit_retry" || transition.kind === "commit") {
    effect.requestSnapshot = transition.requestSnapshot;
  }
  return effect;
};

export const applyPrimaryRemoteTransition = (
  current: UnifiedSyncOperation,
  transition: PrimaryRemoteTransition,
  expected?: LifecycleExpectation,
): UnifiedSyncOperation | undefined => {
  if (!matchesPrimaryTransitionExpectation(current, expected)) {
    return undefined;
  }

  const currentRevision = current.revision ?? current.intentRevision ?? 1;
  const currentAttemptGeneration = getAttemptGeneration(current);
  const primaryId = current.kind === "ticket_create"
    ? "ticket-create"
    : current.kind === "ticket_update"
      ? "ticket-update"
      : current.kind === "comment_create"
        ? "comment-create"
        : "comment-update";
  const primaryKind = current.kind === "ticket_create"
    ? "ticket_create"
    : current.kind === "ticket_update"
      ? "ticket_update"
      : current.kind === "comment_create"
        ? "comment_create"
        : "comment_update";

  let opAction: GenericLifecycleAction;
  let effectAction: DurableSyncEffectAction;

  switch (transition.kind) {
    case "reconcile":
    case "assume_committed":
      opAction = transition.kind === "reconcile"
        ? { ...transition, kind: "record_reconciled_identity" }
        : { ...transition, kind: "assume_remote_commit" };
      effectAction = { kind: "assume_committed", remoteId: transition.remoteId };
      break;
    case "start":
      opAction = { kind: "start_normal_remote_write" };
      effectAction = { kind: "start", requestSnapshot: transition.requestSnapshot };
      break;
    case "start_explicit_retry":
      opAction = { kind: "start_explicit_retry_remote_write" };
      effectAction = { kind: "start_explicit_retry", requestSnapshot: transition.requestSnapshot };
      break;
    case "commit":
      opAction = {
        kind: "record_remote_commit",
        createdRemoteId: transition.remoteId,
        projectId: transition.projectId,
        remoteUpdatedAt: transition.remoteUpdatedAt,
      };
      effectAction = {
        kind: "commit",
        remoteId: transition.remoteId,
        requestSnapshot: transition.requestSnapshot,
      };
      break;
    case "commit_unknown":
      opAction = { kind: "mark_commit_unknown", message: transition.detail };
      effectAction = { kind: "mark_commit_unknown", detail: transition.detail };
      break;
    case "failed":
      opAction = { kind: "abort_known_remote_failure" };
      effectAction = {
        kind: "mark_failed",
        detail: transition.failure.detail,
        disposition: transition.failure.disposition,
        category: transition.failure.category,
      };
      break;
  }

  const currentEffects = [...(current.effects ?? [])];
  const primaryIndex = currentEffects.findIndex(
    (e) =>
      (e.effectId === primaryId || isPrimaryEffectKind(e.kind)) &&
      (e.operationRevision ?? currentRevision) === currentRevision &&
      normalizeAttemptGeneration(e.attemptGeneration) === currentAttemptGeneration,
  );

  const sourceEffect = primaryIndex === -1
    ? initialPrimaryEffect(current, transition, primaryId, primaryKind, currentRevision, currentAttemptGeneration)
    : currentEffects[primaryIndex];
  if (!sourceEffect) {
    return undefined;
  }
  const updatedEffect = transitionDurableSyncEffect(sourceEffect, effectAction, {
    operationRevision: currentRevision,
    attemptGeneration: currentAttemptGeneration,
    sourceState: sourceEffect.state,
  });

  if (!updatedEffect) {
    return undefined;
  }

  if (primaryIndex === -1) {
    currentEffects.push(updatedEffect);
  } else {
    currentEffects[primaryIndex] = updatedEffect;
  }

  if (opAction.kind === "abort_known_remote_failure" && isRejectedTicketCreate(updatedEffect)) {
    opAction.preserveRequest = true;
  }
  const isRepeatedStart = current.phase === "remote_write_started" &&
    (transition.kind === "start" || transition.kind === "start_explicit_retry");
  const isRepeatedCommit = current.phase === "remote_committed" && transition.kind === "commit";
  let nextOp: UnifiedSyncOperation | undefined;
  if (isRepeatedStart || isRepeatedCommit) {
    const version = (current.version ?? current.persistenceVersion ?? 0) + 1;
    nextOp = { ...current, version, persistenceVersion: version, updatedAt: new Date().toISOString() };
  } else {
    nextOp = applyGenericTransition(current, opAction);
  }
  if (!nextOp) {
    return undefined;
  }

  nextOp.effects = (transition.kind === "failed" || transition.kind === "commit_unknown")
    ? retainDurableEffectsForRetry(currentEffects)
    : currentEffects;
  if (transition.kind === "commit" && transition.remoteId !== undefined) {
    nextOp.createdRemoteId = transition.remoteId;
  }

  return nextOp;
};
