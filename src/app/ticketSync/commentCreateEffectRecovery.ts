import { getEffectsForRevision } from "../syncEffects";
import { defaultCommentDeps } from "./commentHandlerDependencies";
import { resolveCommentUploadEffect } from "./commentUploadEffectRecovery";
import type { OperationHandlerContext, OperationHandlerDeps, EffectResolution } from "./operationHandlerTypes";
import type { SyncOperationRepository } from "./syncRepository";
import type { CommentCreateIntent, SyncOperationKey, SyncOutcome, UnifiedSyncOperation } from "./syncOperationTypes";

export async function resolveCommentCreateEffect(input: {
  key: SyncOperationKey;
  effectId: string;
  operation: UnifiedSyncOperation<CommentCreateIntent>;
  context: OperationHandlerContext;
  deps: OperationHandlerDeps & { repository: SyncOperationRepository };
  resolution: EffectResolution;
}): Promise<SyncOutcome> {
  const { effectId, operation, deps } = input;
  const revision = operation.intentRevision ?? operation.revision ?? 1;
  const effect = getEffectsForRevision(operation, revision).find((item) => item.effectId === effectId);
  if (!effect) {
    return { kind: "failed_before_commit", error: new Error(`Effect not found: ${effectId}`) };
  }
  const commentDeps = { ...defaultCommentDeps, ...deps.comment };
  return resolveCommentUploadEffect({ ...input, effect, revision, commentDeps });
}
