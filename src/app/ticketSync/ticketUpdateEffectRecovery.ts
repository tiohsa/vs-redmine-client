import { uploadFileAttachment } from "../../redmine/attachments";
import { createIssue, getIssueDetail } from "../../redmine/issues";
import { classifyFailureDisposition } from "../../utils/redmineErrors";
import { defaultDeps as defaultTicketDeps } from "../../views/ticketSync/ticketSyncDeps";
import { isRemoteCommitUnknownError } from "../../views/ticketSync/ticketSyncResult";
import {
  getEffectsForRevision,
  type UploadRequestSnapshot,
} from "../syncEffects";
import { prepareMarkdownImageUpload } from "./markdownImageEffects";
import type {
  EffectResolution,
  OperationHandlerContext,
  OperationHandlerDeps,
} from "./operationHandlerTypes";
import type { SyncOperationKey, SyncOutcome, TicketUpdateIntent, UnifiedSyncOperation } from "./syncOperationTypes";
import { type SyncOperationRepository } from "./syncRepository";
import { persistUploadSnapshot } from "./uploadSnapshotLease";
import { getDefaultUploadSpoolStore } from "./uploadSpoolStore";

import { resolveTicketChildEffect, type LegacyTicketRecoveryDependencies } from "./ticketChildEffectRecovery";

export async function resolveTicketUpdateEffect(
  input: {
    key: SyncOperationKey;
    effectId: string;
    operation: UnifiedSyncOperation<TicketUpdateIntent>;
    context: OperationHandlerContext;
    deps: OperationHandlerDeps & { repository: SyncOperationRepository };
    resolution: EffectResolution;
  },
  finalize: (operation: UnifiedSyncOperation<TicketUpdateIntent>) => Promise<SyncOutcome>,
): Promise<SyncOutcome> {
  const { key, effectId, operation, context, deps, resolution } = input;
  const repo = deps.repository;
  const revision = operation.intentRevision ?? operation.revision ?? 1;
  const scope = context.connectionScope;
  const effect = getEffectsForRevision(operation, revision).find((e) => e.effectId === effectId);
  if (!effect) {
    return { kind: "failed_before_commit", error: new Error(`Effect not found: ${effectId}`) };
  }

  const saveDeps = deps?.ticketUpdate
    ? { ...defaultTicketDeps, ...deps.ticketUpdate }
    : { ...defaultTicketDeps };

  if (resolution.kind === "mark_failed") {
    const marked = await repo.transitionEffect(
      key,
      effectId,
      { kind: "mark_failed", detail: "Manually marked as failed", disposition: resolution.disposition ?? "retryable", category: resolution.category },
      scope,
      { operationRevision: revision, sourceState: effect.state },
    );
    if (!marked) {
      return { kind: "failed_before_commit", error: new Error(`Failed to mark effect as failed: ${effectId}`) };
    }
    return {
      kind: "remote_committed",
      ticketId: operation.ticketId ?? 0,
      pending: "remote_reconcile",
      message: `Effect ${effectId} marked as failed`,
    };
  }

  if (effect.kind === "attachment_upload" || effect.kind === "image_upload") {
    if (resolution.kind === "assume_committed") {
      const token = resolution.token ?? effect.token;
      const assumed = await repo.transitionEffect(
        key,
        effectId,
        { kind: "assume_committed", token, remoteId: resolution.remoteId },
        scope,
        { operationRevision: revision, sourceState: effect.state },
      );
      if (!assumed) {
        return { kind: "failed_before_commit", error: new Error(`Failed to assume committed for effect ${effectId}`) };
      }
      return {
        kind: "remote_committed",
        ticketId: operation.ticketId ?? 0,
        pending: "remote_reconcile",
        message: `Attachment effect ${effectId} assumed committed`,
      };
    }

    if (resolution.kind === "retry_effect") {
      if (effect.state === "failed" && effect.failure?.disposition === "non_retriable") {
        return { kind: "failed_before_commit", error: new Error("Cannot retry non-retriable failure") };
      }
      const snapshot = effect.requestSnapshot as UploadRequestSnapshot | undefined;
      if (effect.state === "commit_unknown" && (!snapshot?.contentHash || snapshot.contentSize === undefined)) {
        return {
          kind: "failed_before_commit",
          error: new Error(`Cannot retry uncertain upload without snapshot content hash/size for effect ${effectId}`),
        };
      }
      const filePath = effect.target.filePath ?? snapshot?.filePath;
      if (!filePath) {
        return { kind: "failed_before_commit", error: new Error(`Cannot retry attachment without filePath for effect ${effectId}`) };
      }

      let uploadFilePath: string;
      let uploadSnapshot: UploadRequestSnapshot;
      try {
        ({ uploadFilePath, snapshot: uploadSnapshot } = await prepareMarkdownImageUpload(filePath, effect, context.connectionScope, deps.uploadSpoolStore ?? getDefaultUploadSpoolStore()));
      } catch (error) {
        return { kind: "failed_before_commit", error: error as Error };
      }

      const started = await persistUploadSnapshot(uploadSnapshot, () => repo.transitionEffect(
        key,
        effectId,
        { kind: "start_explicit_retry", requestSnapshot: uploadSnapshot },
        scope,
        { operationRevision: revision, sourceState: effect.state },
      ));
      if (!started) {
        return { kind: "failed_before_commit", error: new Error(`Failed to start retry for effect ${effectId}`) };
      }
      try {
        const uploadFn = saveDeps.uploadFile ?? uploadFileAttachment;
        const res = await uploadFn(uploadFilePath);
        const committed = await repo.transitionEffect(
          key,
          effectId,
          { kind: "commit", token: res.token, target: { filePath: uploadSnapshot.filePath ?? filePath, filename: uploadSnapshot.filename }, requestSnapshot: uploadSnapshot },
          scope,
          { operationRevision: revision, sourceState: "started" },
        );
        if (!committed) {
          return { kind: "commit_unknown", operationId: operation.operationId, message: `Attachment uploaded but commit checkpoint failed for ${effectId}` };
        }
        return { kind: "remote_committed", ticketId: operation.ticketId ?? 0, pending: "remote_reconcile", message: `Attachment ${effectId} uploaded successfully` };
      } catch (err) {
        const isUnknown = isRemoteCommitUnknownError(err);
        const disposition = classifyFailureDisposition(err);
        await repo.transitionEffect(
          key,
          effectId,
          isUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
          scope,
          { operationRevision: revision, sourceState: "started" },
        );
        return isUnknown
          ? { kind: "commit_unknown", operationId: operation.operationId, message: (err as Error).message }
          : { kind: "failed_before_commit", error: err as Error };
      }
    }
  }

  if (effect.kind === "child_create") {
    const legacyDeps: LegacyTicketRecoveryDependencies & OperationHandlerDeps = deps;
    const getDetail = deps.ticketUpdate?.getIssueDetail ?? saveDeps.getIssueDetail ?? getIssueDetail;
    const outcome = await resolveTicketChildEffect({
      key, effect, operation, resolution, repo, scope, revision,
      isTicketCreation: false,
      fallbackParentTicketId: operation.ticketId,
      forwardProjectId: operation.projectId,
      getSubject: (snapshot) => {
        const ordinal = effect.target.ordinal ?? 0;
        return snapshot?.subject ?? operation.intent?.childTickets?.[ordinal]?.subject ??
          operation.intent?.metadata?.children?.[ordinal];
      },
      getDetail,
      getCompensationDetail: deps.ticketUpdate?.getIssueDetail ?? legacyDeps.getIssueDetail ?? getDetail,
      createChild: saveDeps.createIssue ?? createIssue,
      deleteChild: deps.ticketUpdate?.deleteIssue ?? legacyDeps.deleteIssue ?? saveDeps.deleteIssue,
      finalize: (nextOp) => finalize(nextOp as UnifiedSyncOperation<TicketUpdateIntent>),
    });
    if (outcome) {
      return outcome;
    }
  }

  return { kind: "failed_before_commit", error: new Error(`Unsupported effect recovery for ${effectId}`) };
}
