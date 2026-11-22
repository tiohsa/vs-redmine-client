import {
  getAttemptGeneration,
  normalizeAttemptGeneration,
  transitionDurableSyncEffect,
  type DurableSyncEffect,
  type DurableSyncEffectAction,
  type DurableSyncEffectKind,
  type DurableSyncEffectState,
} from "../app/syncEffects";
import type { SyncOperationKind } from "./offlineSyncTypes";

export const primaryEffectKind = (kind: SyncOperationKind): DurableSyncEffectKind => {
  switch (kind) {
    case "ticketCreate": return "ticket_create";
    case "ticketUpdate": return "ticket_update";
    case "commentCreate": return "comment_create";
    case "commentUpdate": return "comment_update";
  }
};

export const primaryEffectId = (kind: SyncOperationKind): string => {
  switch (kind) {
    case "ticketCreate": return "ticket-create";
    case "ticketUpdate": return "ticket-update";
    case "commentCreate": return "comment-create";
    case "commentUpdate": return "comment-update";
  }
};

export const withPlannedPrimaryEffect = <T extends {
  revision?: number;
  attemptGeneration?: number;
  effects?: DurableSyncEffect[];
}>(operation: T, kind: SyncOperationKind, target: DurableSyncEffect["target"]): T => {
  const revision = operation.revision ?? 1;
  const attemptGeneration = getAttemptGeneration(operation);
  const effectId = primaryEffectId(kind);
  if (operation.effects?.some((effect) =>
    effect.effectId === effectId &&
    normalizeAttemptGeneration(effect.attemptGeneration) === attemptGeneration
  )) {
    return operation;
  }
  return {
    ...operation,
    effects: [...(operation.effects ?? []), {
      effectId,
      kind: primaryEffectKind(kind),
      operationRevision: revision,
      attemptGeneration,
      state: "planned",
      target,
    }],
  };
};

export const withPrimaryEffectTransition = <T extends {
  revision?: number;
  attemptGeneration?: number;
  effects?: DurableSyncEffect[];
}>(
  operation: T,
  kind: SyncOperationKind,
  action: DurableSyncEffectAction,
  sourceState: DurableSyncEffectState,
): T | undefined => {
  const effectId = primaryEffectId(kind);
  const attemptGeneration = getAttemptGeneration(operation);
  let effects = operation.effects ?? [];
  let index = effects.findIndex((effect) =>
    effect.effectId === effectId &&
    normalizeAttemptGeneration(effect.attemptGeneration) === attemptGeneration
  );
  if (index === -1 && sourceState !== "planned") {
    effects = [...effects, {
      effectId,
      kind: primaryEffectKind(kind),
      operationRevision: operation.revision ?? 1,
      attemptGeneration,
      state: sourceState,
      target: {},
    }];
    index = effects.length - 1;
  }
  if (index === -1) { return undefined; }
  if (
    (action.kind === "commit" && effects[index].state === "committed" && (action.remoteId === undefined || effects[index].remoteId === action.remoteId)) ||
    (action.kind === "mark_commit_unknown" && effects[index].state === "commit_unknown")
  ) {
    return { ...operation, effects };
  }
  const transitioned = transitionDurableSyncEffect(effects[index], action, {
    operationRevision: operation.revision ?? 1,
    attemptGeneration,
    sourceState,
  });
  if (!transitioned) {
    return undefined;
  }
  const nextEffects = [...effects];
  nextEffects[index] = transitioned;
  return { ...operation, effects: nextEffects };
};
