import { normalizeAttemptGeneration } from "./attemptGeneration";
import type { DurableSyncEffect, DurableSyncEffectKind, DurableSyncEffectState } from "./effectTypes";

const UNCERTAIN_EFFECT_STATES: ReadonlySet<DurableSyncEffectState> = new Set([
  "started",
  "commit_unknown",
  "compensation_started",
  "compensation_unknown",
]);

export const isPrimaryEffect = (effect: DurableSyncEffect): boolean =>
  isPrimaryEffectKind(effect.kind) ||
  effect.effectId === "ticket-create" ||
  effect.effectId === "ticket-update" ||
  effect.effectId === "comment-create" ||
  effect.effectId === "comment-update";

export const isPrimaryEffectKind = (kind: DurableSyncEffectKind): boolean =>
  kind === "ticket_create" ||
  kind === "ticket_update" ||
  kind === "comment_create" ||
  kind === "comment_update";

export const getEffectsForRevision = (
  operation: {
    effects?: DurableSyncEffect[];
    revision?: number;
    intentRevision?: number;
    attemptGeneration?: number;
  },
  targetRevision?: number,
  targetAttemptGeneration?: number,
): DurableSyncEffect[] => {
  const rev = targetRevision ?? operation.intentRevision ?? operation.revision ?? 1;
  const attemptGeneration = normalizeAttemptGeneration(
    targetAttemptGeneration ?? operation.attemptGeneration,
  );
  return (operation.effects ?? []).filter(
    (e) =>
      (e.operationRevision ?? rev) === rev &&
      normalizeAttemptGeneration(e.attemptGeneration) === attemptGeneration,
  );
};

export const getPrimaryEffectForRevision = (
  operation: {
    effects?: DurableSyncEffect[];
    revision?: number;
    intentRevision?: number;
    attemptGeneration?: number;
  },
  targetRevision?: number,
): DurableSyncEffect | undefined => {
  const activeEffects = getEffectsForRevision(operation, targetRevision);
  return activeEffects.find(isPrimaryEffect);
};

export const hasUncertainPrimaryDurableSyncEffect = (
  effects: readonly DurableSyncEffect[] | undefined,
): boolean => effects?.some((effect) => isPrimaryEffectKind(effect.kind) && UNCERTAIN_EFFECT_STATES.has(effect.state)) === true;

export const hasUncertainDurableSyncEffect = (
  effects: readonly DurableSyncEffect[] | undefined,
): boolean => effects?.some((effect) => UNCERTAIN_EFFECT_STATES.has(effect.state)) === true;
