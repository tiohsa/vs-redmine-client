import { normalizeAttemptGeneration } from "./attemptGeneration";
import { canRetryEffect, isRejectedTicketCreate } from "./effectRetry";
import type {
  DurableSyncEffect,
  DurableSyncEffectAction,
  DurableSyncEffectExpectation,
  SyncEffectRequestSnapshot,
} from "./effectTypes";

export const restoreDurableSyncEffect = (
  effect: DurableSyncEffect,
): DurableSyncEffect => {
  const restored: DurableSyncEffect = {
    ...effect,
    attemptGeneration: normalizeAttemptGeneration(effect.attemptGeneration),
    state:
      effect.state === "started"
        ? "commit_unknown"
        : effect.state === "compensation_started"
        ? "compensation_unknown"
        : effect.state,
    target: { ...effect.target },
  };
  if (effect.requestSnapshot) {
    restored.requestSnapshot = { ...effect.requestSnapshot };
  } else {
    delete restored.requestSnapshot;
  }
  if (effect.failure) {
    restored.failure = { ...effect.failure };
  }
  return restored;
};

export const areSnapshotsEqual = (
  a?: SyncEffectRequestSnapshot,
  b?: SyncEffectRequestSnapshot,
): boolean => {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
};

const actionAllowsSource = (
  action: DurableSyncEffectAction,
  effect: DurableSyncEffect,
): boolean => {
  const source = effect.state;
  switch (action.kind) {
    case "start": return source === "planned";
    case "start_explicit_retry":
      if (source === "failed") {
        return canRetryEffect(effect) && (!isRejectedTicketCreate(effect) ||
          areSnapshotsEqual(effect.requestSnapshot, action.requestSnapshot));
      }
      return source === "commit_unknown";
    case "commit": return source === "started";
    case "assume_committed": return source === "commit_unknown";
    case "mark_commit_unknown": return source === "started";
    case "mark_failed": return source === "started" || source === "planned";
    case "start_compensation": return source === "committed" || source === "compensation_unknown";
    case "complete_compensation": return source === "compensation_started" || source === "compensation_unknown";
    case "mark_compensation_unknown": return source === "compensation_started" || source === "compensation_unknown";
  }
};

export const transitionDurableSyncEffect = (
  effect: DurableSyncEffect,
  action: DurableSyncEffectAction,
  expected: DurableSyncEffectExpectation,
): DurableSyncEffect | undefined => {
  if (
    effect.operationRevision !== expected.operationRevision ||
    (expected.attemptGeneration !== undefined &&
      normalizeAttemptGeneration(effect.attemptGeneration) !==
        normalizeAttemptGeneration(expected.attemptGeneration)) ||
    effect.state !== expected.sourceState ||
    !actionAllowsSource(action, effect)
  ) {
    return undefined;
  }
  switch (action.kind) {
    case "start":
    case "start_explicit_retry":
      return {
        ...effect,
        state: "started",
        requestSnapshot: action.requestSnapshot ?? effect.requestSnapshot,
        detail: undefined,
        failure: undefined,
      };
    case "commit":
    case "assume_committed":
      return {
        ...effect,
        state: "committed",
        remoteId: action.remoteId ?? effect.remoteId,
        token: action.token ?? effect.token,
        target: action.target ? { ...effect.target, ...action.target } : effect.target,
        requestSnapshot: action.requestSnapshot ?? effect.requestSnapshot,
        detail: undefined,
        failure: undefined,
      };
    case "mark_commit_unknown":
      return { ...effect, state: "commit_unknown", detail: action.detail, failure: undefined };
    case "mark_failed":
      return {
        ...effect,
        state: "failed",
        detail: action.detail,
        failure: {
          disposition: action.disposition ?? "retryable",
          category: action.category,
          detail: action.detail,
        },
      };
    case "start_compensation":
      return { ...effect, state: "compensation_started", detail: undefined, failure: undefined };
    case "complete_compensation":
      return { ...effect, state: "compensated", detail: undefined, failure: undefined };
    case "mark_compensation_unknown":
      return { ...effect, state: "compensation_unknown", detail: action.detail, failure: undefined };
  }
};
