import type { AttachmentLinkRequestSnapshot } from "../syncEffects";
import { isRemoteCommitUnknownError } from "../../views/ticketSync/ticketSyncResult";
import { classifyFailureDisposition } from "../../utils/redmineErrors";
import { defaultCommentDeps } from "./commentHandlerDependencies";
import { resolveCommentUploadEffect } from "./commentUploadEffectRecovery";
import { getEffectsForRevision } from "../syncEffects";
import type { OperationHandlerContext, OperationHandlerDeps, EffectResolution } from "./operationHandlerTypes";
import type { SyncOperationRepository } from "./syncRepository";
import type { CommentUpdateIntent, SyncOperationKey, SyncOutcome, UnifiedSyncOperation } from "./syncOperationTypes";

export async function resolveCommentUpdateEffect(input: {
  key: SyncOperationKey;
  effectId: string;
  operation: UnifiedSyncOperation<CommentUpdateIntent>;
  context: OperationHandlerContext;
  deps: OperationHandlerDeps & { repository: SyncOperationRepository };
  resolution: EffectResolution;
}): Promise<SyncOutcome> {
  const { key, effectId, operation, context, deps, resolution } = input;
  const repo = deps.repository;
  const revision = operation.intentRevision ?? operation.revision ?? 1;
  const scope = context.connectionScope;
  const effect = getEffectsForRevision(operation, revision).find((item) => item.effectId === effectId);
  if (!effect) {
    return { kind: "failed_before_commit", error: new Error(`Effect not found: ${effectId}`) };
  }

  const commentDeps = { ...defaultCommentDeps, ...deps.comment };
  if (effect.kind === "attachment_link") {
    const snapshot = effect.requestSnapshot?.kind === "attachment_link"
      ? effect.requestSnapshot as AttachmentLinkRequestSnapshot
      : undefined;
    if (!snapshot) {
      return { kind: "failed_before_commit", error: new Error(`Attachment link effect ${effectId} has no request snapshot`) };
    }

    if (resolution.kind === "assume_committed") {
      const assumed = await repo.transitionEffect(
        key,
        effectId,
        { kind: "assume_committed" },
        scope,
        { operationRevision: revision, sourceState: "commit_unknown" },
      );
      if (!assumed) {
        return { kind: "failed_before_commit", error: new Error(`Failed to assume committed for effect ${effectId}`) };
      }
      return {
        kind: "remote_committed",
        ticketId: operation.ticketId ?? 0,
        commentId: operation.commentId,
        pending: "remote_reconcile",
        message: `Attachment link effect ${effectId} assumed committed`,
      };
    }

    if (resolution.kind === "retry_effect") {
      if (effect.state === "failed" && effect.failure?.disposition === "non_retriable") {
        return { kind: "failed_before_commit", error: new Error("Cannot retry non-retriable failure") };
      }
      const started = await repo.transitionEffect(
        key,
        effectId,
        { kind: "start_explicit_retry", requestSnapshot: snapshot },
        scope,
        { operationRevision: revision, sourceState: effect.state },
      );
      if (!started) {
        return { kind: "failed_before_commit", error: new Error(`Failed to start retry for effect ${effectId}`) };
      }
      try {
        await commentDeps.updateIssue(snapshot.request);
      } catch (error) {
        const commitUnknown = isRemoteCommitUnknownError(error);
        const disposition = classifyFailureDisposition(error);
        await repo.transitionEffect(
          key,
          effectId,
          commitUnknown
            ? { kind: "mark_commit_unknown" }
            : { kind: "mark_failed", detail: (error as Error).message, disposition },
          scope,
          { operationRevision: revision, sourceState: "started" },
        );
        return commitUnknown
          ? { kind: "commit_unknown", operationId: operation.operationId, message: (error as Error).message }
          : { kind: "failed_before_commit", error: error as Error };
      }
      let committed: UnifiedSyncOperation | undefined;
      try {
        committed = await repo.transitionEffect(
          key,
          effectId,
          { kind: "commit", target: effect.target, requestSnapshot: snapshot },
          scope,
          { operationRevision: revision, sourceState: "started" },
        );
      } catch {
        committed = undefined;
      }
      if (!committed) {
        try {
          await repo.transitionEffect(
            key,
            effectId,
            { kind: "mark_commit_unknown" },
            scope,
            { operationRevision: revision, sourceState: "started" },
          );
        } catch {
          // Keep the started state when the unknown checkpoint itself cannot be persisted.
        }
        return { kind: "commit_unknown", operationId: operation.operationId, message: `Attachment link checkpoint failed for ${effectId}` };
      }
      return {
        kind: "remote_committed",
        ticketId: operation.ticketId ?? 0,
        commentId: operation.commentId,
        pending: "remote_reconcile",
        message: `Attachment link effect ${effectId} retried successfully`,
      };
    }
  }

  return resolveCommentUploadEffect({ ...input, effect, revision, commentDeps });
}
