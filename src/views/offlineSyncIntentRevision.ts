import { getAttemptGeneration, getEffectsForRevision, isPrimaryEffectKind, normalizeAttemptGeneration, type DurableSyncEffect } from "../app/syncEffects";
import type { OfflineCommentUpdate, OfflineTicketUpdate } from "./offlineSyncTypes";

export const resolveRevisionForEditedQueuedFailure = (
  operation: {
    revision?: number;
    intentRevision?: number;
    attemptGeneration?: number;
    effects?: DurableSyncEffect[];
    preparationFailure?: string;
  },
): { revision: number; effects: DurableSyncEffect[] } | undefined => {
  const currentRevision = operation.intentRevision ?? operation.revision ?? 1;
  const activeEffects = getEffectsForRevision(operation, currentRevision);
  const hasFailedEffect = activeEffects.some((e) => e.state === "failed");
  if (!hasFailedEffect && !operation.preparationFailure) {
    return undefined;
  }
  const hasBlockingEffect = activeEffects.some((e) =>
    e.state === "commit_unknown" ||
    e.state === "compensation_unknown" ||
    e.state === "compensation_started" ||
    (isPrimaryEffectKind(e.kind) && e.state === "committed")
  );
  if (hasBlockingEffect) {
    return undefined;
  }
  const nextRevision = Math.max(operation.revision ?? 1, operation.intentRevision ?? 0) + 1;
  const reusableEffects = (operation.effects ?? []).filter((e) =>
    e.state === "committed" ||
    e.state === "commit_unknown" ||
    e.state === "compensation_unknown" ||
    e.state === "compensation_started"
  );
  return { revision: nextRevision, effects: reusableEffects };
};

export const hasCurrentAttemptNonPlannedEffect = (
  operation: Pick<OfflineTicketUpdate | OfflineCommentUpdate, "attemptGeneration" | "effects">,
): boolean => {
  const attemptGeneration = getAttemptGeneration(operation);
  return (operation.effects ?? []).some((effect) =>
    normalizeAttemptGeneration(effect.attemptGeneration) === attemptGeneration &&
    effect.state !== "planned"
  );
};
