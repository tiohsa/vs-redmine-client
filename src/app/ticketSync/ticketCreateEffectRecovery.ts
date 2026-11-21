import * as vscode from "vscode";
import { uploadFileAttachment } from "../../redmine/attachments";
import { getIssueDetail } from "../../redmine/issues";
import { computeFileHashAndSizeAsync } from "../../utils/fileHash";
import { classifyFailureDisposition } from "../../utils/redmineErrors";
import {
  parseTicketEditorContent,
} from "../../views/ticketEditorContent";
import { defaultCreateDeps } from "../../views/ticketSync/ticketSyncDeps";
import { isRemoteCommitUnknownError } from "../../views/ticketSync/ticketSyncResult";
import {
  getAttemptGeneration,
  getEffectsForRevision,
  getOperationRecoveryMode,
  getPrimaryEffectForRevision,
  type TicketCreateRequestSnapshot,
  type UploadRequestSnapshot,
} from "../syncEffects";
import type {
  EffectResolution,
  OperationHandlerContext,
  OperationHandlerDeps,
} from "./operationHandlerTypes";
import type {
  SyncOperationKey,
  SyncOutcome,
  TicketCreateIntent,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import { type SyncOperationRepository } from "./syncRepository";
import { verifyCompensationIdentity } from "./ticketRemoteIdentity";
import { persistUploadSnapshot } from "./uploadSnapshotLease";
import { getDefaultUploadSpoolStore } from "./uploadSpoolStore";

import { resolveTicketChildEffect, type LegacyTicketRecoveryDependencies } from "./ticketChildEffectRecovery";

export async function resolveTicketCreateEffect(
  input: {
    key: SyncOperationKey;
    effectId: string;
    operation: UnifiedSyncOperation<TicketCreateIntent>;
    context: OperationHandlerContext;
    deps: OperationHandlerDeps & { repository: SyncOperationRepository };
    resolution: EffectResolution;
  },
  finalize: (operation: UnifiedSyncOperation<TicketCreateIntent>) => Promise<SyncOutcome>,
): Promise<SyncOutcome> {
  const { key, effectId, operation, context, deps, resolution } = input;
  const repo = deps.repository;
  const revision = operation.intentRevision ?? operation.revision ?? 1;
  const scope = context.connectionScope;
  const effect = getEffectsForRevision(operation, revision).find((e) => e.effectId === effectId);
  if (!effect) {
    return { kind: "failed_before_commit", error: new Error(`Effect not found: ${effectId}`) };
  }

  const recoveryMode = getOperationRecoveryMode(operation);
  if (recoveryMode === "compensation_blocked" && resolution.kind !== "reconcile_compensation") {
    return {
      kind: "failed_before_commit",
      error: new Error(vscode.l10n.t("Only reconcile_compensation is allowed while primary compensation has unresolved rollback obligations.")),
    };
  }

  const createDeps = { ...defaultCreateDeps, ...deps.ticketCreate };

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
      ticketId: operation.createdRemoteId ?? 0,
      pending: "remote_reconcile",
      message: `Effect ${effectId} marked as failed`,
    };
  }

  if (effectId === "ticket-create" && (effect.state === "compensation_unknown" || effect.state === "compensation_started" || resolution.kind === "reconcile_compensation")) {
    const remoteTicketId = effect.remoteId ?? (resolution as any).remoteId ?? operation.createdRemoteId;
    if (!remoteTicketId) {
      return { kind: "failed_before_commit", error: new Error("Missing remoteId for ticket compensation recovery") };
    }
    const getDetail = deps?.ticketCreate?.getIssueDetail ?? (deps as any)?.getIssueDetail ?? createDeps.getIssueDetail ?? getIssueDetail;
    const deleteIssue = deps?.ticketCreate?.deleteIssue ?? (deps as any)?.deleteIssue ?? createDeps.deleteIssue;

    try {
      const detail = await getDetail(remoteTicketId);
      if (detail && detail.ticket) {
        const snapshot = effect.requestSnapshot as TicketCreateRequestSnapshot | undefined;
        const expectedProject = snapshot?.request?.projectId ?? operation.projectId;
        const expectedSubject = snapshot?.request?.subject ?? (operation.intent as any)?.subject;
        const idCheck = verifyCompensationIdentity(detail.ticket, {
          projectId: expectedProject,
          subject: expectedSubject,
        });
        if (!idCheck.ok) {
          return { kind: "failed_before_commit", error: new Error(`Compensation rejected due to identity mismatch: ${idCheck.reason}`) };
        }

        const startDel = await repo.transitionEffect(key, effectId, { kind: "start_compensation" }, scope, { operationRevision: revision, sourceState: effect.state });
        if (!startDel) {
          return { kind: "failed_before_commit", error: new Error("Failed to transition to start_compensation") };
        }
        if (deleteIssue) {
          await deleteIssue(remoteTicketId);
        }
        const compDone = await repo.transitionEffect(key, effectId, { kind: "complete_compensation" }, scope, { operationRevision: revision, sourceState: "compensation_started" });
        if (!compDone) {
          await repo.transitionEffect(key, effectId, { kind: "mark_compensation_unknown", detail: "complete_compensation failed to persist" }, scope, { operationRevision: revision, sourceState: "compensation_started" });
          return { kind: "commit_unknown", operationId: operation.operationId, message: "Compensation completed on remote but checkpoint failed" };
        }
        if (getAttemptGeneration(compDone) > getAttemptGeneration(operation)) {
          return { kind: "queued" };
        }
        return { kind: "no_change", ticketId: remoteTicketId };
      }
    } catch (err: any) {
      if (err?.status === 404 || err?.message?.includes("404") || err?.message?.toLowerCase().includes("not found")) {
        const compDone = await repo.transitionEffect(key, effectId, { kind: "complete_compensation" }, scope, { operationRevision: revision, sourceState: effect.state });
        if (compDone) {
          if (getAttemptGeneration(compDone) > getAttemptGeneration(operation)) {
            return { kind: "queued" };
          }
          return { kind: "no_change", ticketId: remoteTicketId };
        }
      }
      await repo.transitionEffect(key, effectId, { kind: "mark_compensation_unknown", detail: (err as Error).message }, scope, { operationRevision: revision, sourceState: effect.state === "started" || effect.state === "compensation_started" ? effect.state : "compensation_started" });
      return { kind: "commit_unknown", operationId: operation.operationId, message: (err as Error).message };
    }
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
        ticketId: operation.createdRemoteId ?? 0,
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
      const hasFrozenSpool = snapshot?.spoolFilePath !== undefined;
      const uploadFilePath = hasFrozenSpool ? snapshot?.spoolFilePath : effect.target.filePath ?? snapshot?.filePath;
      if (!uploadFilePath) {
        return { kind: "failed_before_commit", error: new Error(`Cannot retry attachment without filePath for effect ${effectId}`) };
      }

      let contentHash = snapshot?.contentHash;
      let contentSize = snapshot?.contentSize;
      if (hasFrozenSpool) {
        if (!snapshot || !await (deps.uploadSpoolStore ?? getDefaultUploadSpoolStore()).verify(snapshot)) {
          return { kind: "failed_before_commit", error: new Error(`Spool file identity mismatch for attachment effect ${effectId}`) };
        }
      } else {
        const currentFile = await computeFileHashAndSizeAsync(uploadFilePath);
        if (!currentFile) {
          return {
            kind: "failed_before_commit",
            error: new Error(`Cannot compute hash for file: ${uploadFilePath}`),
          };
        }
        if (
          snapshot?.contentHash &&
          (snapshot.contentHash !== currentFile.contentHash || snapshot.contentSize !== currentFile.contentSize)
        ) {
          return {
            kind: "failed_before_commit",
            error: new Error(`File content has changed since snapshot (expected hash ${snapshot.contentHash}, found ${currentFile.contentHash}). Retry rejected.`),
          };
        }
        contentHash = currentFile.contentHash;
        contentSize = currentFile.contentSize;
      }

      if (!contentHash || contentSize === undefined) {
        return {
          kind: "failed_before_commit",
          error: new Error(`Cannot retry attachment without frozen content identity for effect ${effectId}`),
        };
      }

      const uploadSnapshot: UploadRequestSnapshot = snapshot ?? {
        kind: "upload",
        filePath: effect.target.filePath ?? uploadFilePath,
        filename: effect.target.filename ?? "attachment",
        contentType: "application/octet-stream",
        contentHash,
        contentSize,
        spoolFilePath: undefined,
      };

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
        const uploadFn = (createDeps as any).uploadFile ?? uploadFileAttachment;
        const res = await uploadFn(uploadFilePath);
        const committed = await repo.transitionEffect(
          key,
          effectId,
          { kind: "commit", token: res.token, target: { filePath: uploadSnapshot.filePath, filename: uploadSnapshot.filename }, requestSnapshot: uploadSnapshot },
          scope,
          { operationRevision: revision, sourceState: "started" },
        );
        if (!committed) {
          return { kind: "commit_unknown", operationId: operation.operationId, message: `Attachment uploaded but commit checkpoint failed for ${effectId}` };
        }
        return { kind: "remote_committed", ticketId: operation.createdRemoteId ?? 0, pending: "remote_reconcile", message: `Attachment ${effectId} uploaded successfully` };
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
    const getDetail = deps.ticketCreate?.getIssueDetail ?? createDeps.getIssueDetail ?? getIssueDetail;
    const outcome = await resolveTicketChildEffect({
      key, effect, operation, resolution, repo, scope, revision,
      isTicketCreation: true,
      fallbackParentTicketId: getPrimaryEffectForRevision(operation, revision)?.remoteId ?? operation.createdRemoteId,
      forwardProjectId: operation.projectId ?? operation.intent?.projectId,
      getSubject: (snapshot) => {
        const parsedContent = operation.intent?.content
          ? parseTicketEditorContent(operation.intent.content, { allowMissingMetadata: true, allowMissingSubject: true })
          : undefined;
        const ordinal = effect.target.ordinal ?? 0;
        const target: typeof effect.target & { subject?: string } = effect.target;
        return snapshot?.subject ?? target.subject ?? operation.intent?.childTickets?.[ordinal]?.subject ??
          operation.intent?.metadata?.children?.[ordinal] ?? parsedContent?.metadata?.children?.[ordinal];
      },
      getDetail,
      getCompensationDetail: deps.ticketCreate?.getIssueDetail ?? legacyDeps.getIssueDetail ?? getDetail,
      createChild: (request) => createDeps.createIssue(request),
      deleteChild: deps.ticketCreate?.deleteIssue ?? legacyDeps.deleteIssue ?? createDeps.deleteIssue,
      finalize: (nextOp) => finalize(nextOp as UnifiedSyncOperation<TicketCreateIntent>),
    });
    if (outcome) {
      return outcome;
    }
  }

  return {
    kind: "failed_before_commit",
    error: new Error(`Unsupported effect resolution for kind ${effect.kind} or resolution ${JSON.stringify(resolution)}`),
  };
}
