import type { IssueCreateInput, createIssue, deleteIssue, getIssueDetail } from "../../redmine/issues";
import { classifyFailureDisposition } from "../../utils/redmineErrors";
import { isRemoteCommitUnknownError } from "../../views/ticketSync/ticketSyncResult";
import type { ChildTicketCreateRequestSnapshot, DurableSyncEffect } from "../syncEffects";
import type { EffectResolution } from "./operationHandlerTypes";
import type { SyncOperationKey, SyncOutcome, UnifiedSyncOperation } from "./syncOperationTypes";
import type { SyncOperationRepository } from "./syncRepositoryTypes";
import { normalizeTicketText, verifyCompensationIdentity } from "./ticketRemoteIdentity";

export type LegacyTicketRecoveryDependencies = {
  getIssueDetail?: typeof getIssueDetail;
  deleteIssue?: typeof deleteIssue;
};

export const resolveTicketChildEffect = async (input: {
  key: SyncOperationKey;
  effect: DurableSyncEffect;
  operation: UnifiedSyncOperation;
  resolution: EffectResolution;
  repo: SyncOperationRepository;
  scope: string;
  revision: number;
  isTicketCreation: boolean;
  fallbackParentTicketId?: number;
  forwardProjectId?: number;
  getSubject(snapshot?: ChildTicketCreateRequestSnapshot): string | undefined;
  getDetail: typeof getIssueDetail;
  getCompensationDetail: typeof getIssueDetail;
  createChild: typeof createIssue;
  deleteChild?: typeof deleteIssue;
  finalize(operation: UnifiedSyncOperation): Promise<SyncOutcome>;
}): Promise<SyncOutcome | undefined> => {
  const {
    key, effect, operation, resolution, repo, scope, revision, isTicketCreation,
    fallbackParentTicketId, forwardProjectId, getSubject, getDetail, getCompensationDetail,
    createChild, deleteChild, finalize,
  } = input;
  const { effectId } = effect;
  const childSnapshot = effect.requestSnapshot as ChildTicketCreateRequestSnapshot | undefined;
  const parentTicketId = childSnapshot?.parentTicketId ?? effect.target.parentTicketId ?? fallbackParentTicketId;
  if (
    effect.state === "compensation_unknown" ||
    effect.state === "compensation_started" ||
    resolution.kind === "reconcile_compensation"
  ) {
    const remoteChildId = effect.remoteId ?? (resolution as EffectResolution & { remoteId?: number }).remoteId;

    if (remoteChildId) {
      let currentEffectState = effect.state;
      try {
        const detail = await getCompensationDetail(remoteChildId);
        if (detail && detail.ticket) {
          const expectedProj = childSnapshot?.projectId ?? operation.projectId;
          const expectedSubject = childSnapshot?.subject;
          const idCheck = verifyCompensationIdentity(detail.ticket, {
            projectId: expectedProj,
            parentId: parentTicketId,
            subject: expectedSubject,
          });
          if (!idCheck.ok) {
            return { kind: "failed_before_commit", error: new Error(`Child compensation rejected due to identity mismatch: ${idCheck.reason}`) };
          }

          const startDel = await repo.transitionEffect(
            key,
            effectId,
            { kind: "start_compensation" },
            scope,
            { operationRevision: revision, sourceState: currentEffectState },
          );
          if (!startDel) {
            return { kind: "failed_before_commit", error: new Error(`Failed to transition to start_compensation for ${effectId}`) };
          }
          currentEffectState = "compensation_started";
          if (deleteChild) {
            await deleteChild(remoteChildId);
          }
          const compDone = await repo.transitionEffect(
            key,
            effectId,
            { kind: "complete_compensation" },
            scope,
            { operationRevision: revision, sourceState: "compensation_started" },
          );
          if (!compDone) {
            await repo.transitionEffect(
              key,
              effectId,
              { kind: "mark_compensation_unknown", detail: "complete_compensation failed to persist" },
              scope,
              { operationRevision: revision, sourceState: "compensation_started" },
            );
            return { kind: "commit_unknown", operationId: operation.operationId, message: "Child compensation DELETE succeeded on remote but checkpoint failed" };
          }
          return finalize(compDone);
        }
      } catch (err: any) {
        if (err?.status === 404 || err?.message?.includes("404") || err?.message?.toLowerCase().includes("not found")) {
          if (currentEffectState === "committed") {
            const startComp = await repo.transitionEffect(
              key,
              effectId,
              { kind: "start_compensation" },
              scope,
              { operationRevision: revision, sourceState: "committed" },
            );
            if (!startComp) {
              return { kind: "failed_before_commit", error: new Error(`Failed to transition to start_compensation for ${effectId}`) };
            }
            currentEffectState = "compensation_started";
          }
          const compDone = await repo.transitionEffect(
            key,
            effectId,
            { kind: "complete_compensation" },
            scope,
            { operationRevision: revision, sourceState: currentEffectState },
          );
          if (compDone) {
            return finalize(compDone);
          }
        }
        const isUnknown = isRemoteCommitUnknownError(err);
        if (isUnknown || err?.code === "ETIMEDOUT") {
          await repo.transitionEffect(
            key,
            effectId,
            { kind: "mark_compensation_unknown", detail: (err as Error).message },
            scope,
            { operationRevision: revision, sourceState: currentEffectState },
          );
          return { kind: "commit_unknown", operationId: operation.operationId, message: (err as Error).message };
        }
        return { kind: "failed_before_commit", error: err as Error };
      }
    } else {
      const compDone = await repo.transitionEffect(
        key,
        effectId,
        { kind: "complete_compensation" },
        scope,
        { operationRevision: revision, sourceState: effect.state },
      );
      if (compDone) {
        return finalize(compDone);
      }
    }
  }

  if (resolution.kind === "link_remote_child" || (resolution.kind === "assume_committed" && resolution.remoteId)) {
    const remoteChildId = resolution.kind === "link_remote_child" ? resolution.remoteId : resolution.remoteId!;
    try {
      const detail = await getDetail(remoteChildId);
      if (!detail || !detail.ticket) {
        return { kind: "failed_before_commit", error: new Error(`Remote ticket #${remoteChildId} not found.`) };
      }

      if (parentTicketId && detail.ticket.parentId !== parentTicketId) {
        return {
          kind: "failed_before_commit",
          error: new Error(`Parent ticket ID mismatch: child #${remoteChildId} has parent ${detail.ticket.parentId}, expected ${parentTicketId}`),
        };
      }
      const expectedProj = childSnapshot?.projectId ?? forwardProjectId;
      if (expectedProj && detail.ticket.projectId !== expectedProj) {
        return {
          kind: "failed_before_commit",
          error: new Error(`Project mismatch: child #${remoteChildId} belongs to project ${detail.ticket.projectId}, expected ${expectedProj}`),
        };
      }
      const expectedSubj = getSubject(childSnapshot);
      if (expectedSubj && normalizeTicketText(detail.ticket.subject) !== normalizeTicketText(expectedSubj)) {
        return {
          kind: "failed_before_commit",
          error: new Error(`Subject mismatch: child #${remoteChildId} has subject "${detail.ticket.subject}", expected "${expectedSubj}"`),
        };
      }

      const assumed = await repo.transitionEffect(
        key,
        effectId,
        { kind: "assume_committed", remoteId: remoteChildId },
        scope,
        { operationRevision: revision, sourceState: effect.state },
      );
      if (!assumed) {
        return { kind: "failed_before_commit", error: new Error(`Failed to assume committed for child effect ${effectId}`) };
      }

      return finalize(assumed);
    } catch (err) {
      return { kind: "failed_before_commit", error: err as Error };
    }
  }

  if (resolution.kind === "retry_effect") {
    if (effect.state === "commit_unknown") {
      return {
        kind: "failed_before_commit",
        error: new Error(isTicketCreation
          ? "Blind retry for child_create in commit_unknown is forbidden without verified absence. Please link the remote issue ID or verify absence first."
          : "Blind retry for child_create in commit_unknown is forbidden without verified absence."),
      };
    }

    if (effect.state === "failed" && effect.failure?.disposition === "non_retriable") {
      return { kind: "failed_before_commit", error: new Error("Cannot retry non-retriable failure.") };
    }

    const subject = getSubject(childSnapshot);
    const projectId = childSnapshot?.projectId ?? forwardProjectId ?? 0;

    if (!parentTicketId || !subject) {
      return { kind: "failed_before_commit", error: new Error(isTicketCreation
        ? `Cannot retry child create for effect ${effectId}: missing parent or subject (parentTicketId=${parentTicketId}, subject=${subject})`
        : `Cannot retry child create for effect ${effectId}: missing parent or subject`) };
    }

    const childRequest: IssueCreateInput = childSnapshot?.request ?? {
      subject: subject ?? "",
      description: childSnapshot?.description ?? "",
      parentId: parentTicketId,
      projectId,
    };

    const updatedSnapshot: ChildTicketCreateRequestSnapshot = {
      kind: "child_create",
      parentTicketId,
      projectId,
      subject: childRequest.subject,
      description: childRequest.description,
      ordinal: effect.target.ordinal,
      request: childRequest,
    };

    const started = await repo.transitionEffect(
      key,
      effectId,
      { kind: "start_explicit_retry", requestSnapshot: updatedSnapshot },
      scope,
      { operationRevision: revision, sourceState: effect.state },
    );
    if (!started) {
      return { kind: "failed_before_commit", error: new Error(`Failed to start retry for effect ${effectId}`) };
    }
    try {
      const createdChildId = await createChild(childRequest);
      const committed = await repo.transitionEffect(
        key,
        effectId,
        { kind: "commit", remoteId: createdChildId, requestSnapshot: updatedSnapshot },
        scope,
        { operationRevision: revision, sourceState: "started" },
      );
      if (!committed) {
        return { kind: "commit_unknown", operationId: operation.operationId, message: `Child issue created but failed to persist commit checkpoint for ${effectId}` };
      }
      return finalize(committed);
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
  return undefined;
};
