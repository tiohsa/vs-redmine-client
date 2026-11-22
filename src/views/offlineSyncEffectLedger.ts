import {
  getAttemptGeneration,
  normalizeAttemptGeneration,
  transitionDurableSyncEffect,
  type DurableSyncEffect,
  type DurableSyncEffectAction,
  type DurableSyncEffectState,
} from "../app/syncEffects";
import { isAbandoned } from "./offlineSyncPolicy";
import { findStoredOperation, replaceStoredOperationInQueue } from "./offlineSyncQueueEntries";
import { commitQueueMutation, mutateQueueAsync, skipQueueMutation } from "./offlineSyncQueueStorage";
import type { StoredOfflineOperation } from "./offlineSyncTypes";

export const planOfflineSyncEffectAsync = async (
  operationId: string,
  effect: DurableSyncEffect,
  scope: string,
  expectedRevision: number,
): Promise<DurableSyncEffect | undefined> => {
  return mutateQueueAsync(scope, (queue) => {
  const operation = findStoredOperation(queue, operationId);
  if (
    !operation ||
    isAbandoned(operation) ||
    operation.revision !== expectedRevision ||
    effect.operationRevision !== expectedRevision ||
    (effect.attemptGeneration !== undefined &&
      normalizeAttemptGeneration(effect.attemptGeneration) !== getAttemptGeneration(operation)) ||
    (operation.connectionScope !== undefined && operation.connectionScope !== scope)
  ) {
    return skipQueueMutation(undefined);
  }
  const existing = operation.effects?.find((candidate) =>
    candidate.effectId === effect.effectId &&
    normalizeAttemptGeneration(candidate.attemptGeneration) === getAttemptGeneration(operation)
  );
  if (existing) {
    return skipQueueMutation(
      existing.operationRevision === expectedRevision ? { ...existing } : undefined,
    );
  }
  const planned = {
    ...effect,
    attemptGeneration: getAttemptGeneration(operation),
    target: { ...effect.target },
  };
  const nextOperation = {
    ...operation,
    effects: [...(operation.effects ?? []), planned],
  } as StoredOfflineOperation;
  replaceStoredOperationInQueue(queue, operation, nextOperation);
  return commitQueueMutation({ ...planned, target: { ...planned.target } });
  });
};

export const transitionOfflineSyncEffectAsync = async (
  operationId: string,
  effectId: string,
  action: DurableSyncEffectAction,
  scope: string,
  expected: {
    operationRevision: number;
    attemptGeneration?: number;
    sourceState: DurableSyncEffectState;
  },
): Promise<DurableSyncEffect | undefined> => {
  return mutateQueueAsync(scope, (queue) => {
  const operation = findStoredOperation(queue, operationId);
  if (
    !operation ||
    isAbandoned(operation) ||
    operation.revision !== expected.operationRevision ||
    (expected.attemptGeneration !== undefined &&
      getAttemptGeneration(operation) !== normalizeAttemptGeneration(expected.attemptGeneration)) ||
    (operation.connectionScope !== undefined && operation.connectionScope !== scope)
  ) {
    return skipQueueMutation(undefined);
  }
  const effects = operation.effects ?? [];
  const index = effects.findIndex((effect) =>
    effect.effectId === effectId &&
    normalizeAttemptGeneration(effect.attemptGeneration) === getAttemptGeneration(operation)
  );
  if (index === -1) { return skipQueueMutation(undefined); }
  const transitioned = transitionDurableSyncEffect(effects[index], action, {
    ...expected,
    attemptGeneration: expected.attemptGeneration ?? getAttemptGeneration(operation),
  });
  if (!transitioned) { return skipQueueMutation(undefined); }
  const nextEffects = [...effects];
  nextEffects[index] = transitioned;
  const nextOperation = {
    ...operation,
    effects: nextEffects,
  } as StoredOfflineOperation;
  replaceStoredOperationInQueue(queue, operation, nextOperation);
  return commitQueueMutation({ ...transitioned, target: { ...transitioned.target } });
  });
};
