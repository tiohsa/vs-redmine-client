import * as vscode from "vscode";
import { runWithConnectionScope } from "../../redmine/client";
import {
  defaultCommentDeps,
  OperationHandlerContext,
} from "./operationHandlers";
import { getIssueDetail } from "../../redmine/issues";
import { reconcileCommentCommitUnknown } from "../../views/commentSaveSync";
import { withAttemptGenerationFence } from "./syncRepository";
import { SyncOutcome } from "./syncOperationTypes";
import {
  canRetryEffect,
  canRetryFailedCommentEffect,
  getAttemptGeneration,
  getEffectsForRevision,
  getOperationRecoveryMode,
  getPrimaryEffectForRevision,
  isPrimaryRecoveryRequired,
} from "../syncEffects";
import { beginSyncUnlessDeleting, deletionInProgressError } from "./syncDeletionGuard";

import { getOutcomeTicketId } from "./syncOutcomeTicketId";
import type { CommitUnknownRecoveryInput, CommitUnknownRecoveryDependencies } from "./syncRecoveryTypes";

export const resolveCommitUnknown = async (
  input: CommitUnknownRecoveryInput,
  recovery: CommitUnknownRecoveryDependencies,
): Promise<SyncOutcome> => {
  if (input.resolution?.kind === "link_created_ticket") {
    input = { ...input, resolution: {
      kind: "link_remote_ticket", ticketId: input.resolution.ticketId, explicitLink: true,
    } };
  }
  const scope = input.context.connectionScope;
  if (!input.operationId || !Number.isInteger(input.operationRevision) || input.operationRevision <= 0) {
    return {
      kind: "failed_before_commit",
      error: new Error("Recovery operationId and operationRevision are required."),
    };
  }
  if (!Number.isInteger(input.attemptGeneration) || input.attemptGeneration <= 0) {
    return {
      kind: "failed_before_commit",
      error: new Error("Recovery attemptGeneration is required and must be a positive integer."),
    };
  }
  const op = recovery.repository.getOperation(input.key, scope);
  if (op && op.operationId !== input.operationId) {
    return {
      kind: "failed_before_commit",
      error: new Error(`Operation ID mismatch: expected "${op.operationId}", got "${input.operationId}"`),
    };
  }
  const currentRevision = op?.intentRevision ?? op?.revision ?? 1;
  if (op && currentRevision !== input.operationRevision) {
    return {
      kind: "failed_before_commit",
      error: new Error(`Operation revision mismatch: expected ${currentRevision}, got ${input.operationRevision}`),
    };
  }
  const currentAttemptGeneration = getAttemptGeneration(op);
  if (
    op &&
    currentAttemptGeneration !== input.attemptGeneration
  ) {
    return {
      kind: "failed_before_commit",
      error: new Error(`Operation attempt generation mismatch: expected ${currentAttemptGeneration}, got ${input.attemptGeneration}`),
    };
  }
  const primaryEffect = op ? getPrimaryEffectForRevision(op, currentRevision) : undefined;
  const isCommittedCommentIdentityPending = op?.kind === "comment_create" &&
    op.phase === "reconciliation_pending" &&
    primaryEffect?.state === "committed";
  const isRecoverable = op && (
    isPrimaryRecoveryRequired(op, primaryEffect) || isCommittedCommentIdentityPending
  );
  if (!op || !isRecoverable) {
    return {
      kind: "commit_unknown",
      operationId: op?.operationId ?? "",
      ticketId: op?.ticketId,
      commentId: op?.commentId,
      message: op?.errorMessage ?? "Operation is not in commit_unknown or failed state",
    };
  }

  if (getOperationRecoveryMode(op) === "compensation_blocked" && input.resolution?.kind !== "reconcile_compensation") {
    return {
      kind: "failed_before_commit",
      ticketId: op.ticketId,
      commentId: op.commentId,
      error: new Error(vscode.l10n.t("Only reconcile_compensation is allowed while primary compensation has unresolved rollback obligations.")),
    };
  }

  const resKind = input.resolution?.kind ?? "reconcile";
  const flightKey = `${scope}:resolve:${op.operationId}:${currentRevision}:${currentAttemptGeneration}:${resKind}`;
  const activeFlight = recovery.inFlight.get(flightKey);
  if (activeFlight) {
    return activeFlight;
  }

  const runner = (input as any).runInConnectionScope ?? runWithConnectionScope;
  const resolution = input.resolution;
  const linkedTarget = resolution?.kind === "link_remote_ticket"
    ? { ticketId: resolution.ticketId }
    : resolution?.kind === "link_remote_comment" && op.ticketId !== undefined
      ? { ticketId: op.ticketId, commentId: resolution.commentId }
      : undefined;
  const endActiveSync = beginSyncUnlessDeleting(scope, op, linkedTarget);
  if (!endActiveSync) {
    return { kind: "failed_before_commit", error: deletionInProgressError() };
  }
  const flightPromise = runner(scope, async (): Promise<SyncOutcome> => {
    const freshOp = recovery.repository.getOperation(input.key, scope);
    const freshRevision = freshOp?.intentRevision ?? freshOp?.revision ?? 1;
    const freshAttemptGeneration = getAttemptGeneration(freshOp);
    const freshPrimaryEffect = freshOp ? getPrimaryEffectForRevision(freshOp, freshRevision) : undefined;
    const isFreshCommittedCommentIdentityPending = freshOp?.kind === "comment_create" &&
      freshOp.phase === "reconciliation_pending" &&
      freshPrimaryEffect?.state === "committed";
    const isFreshRecoverable = freshOp && (
      isPrimaryRecoveryRequired(freshOp, freshPrimaryEffect) || isFreshCommittedCommentIdentityPending
    );
    if (!freshOp || !isFreshRecoverable) {
      return {
        kind: "commit_unknown",
        operationId: freshOp?.operationId ?? op.operationId,
        ticketId: freshOp?.ticketId ?? op.ticketId,
        commentId: freshOp?.commentId ?? op.commentId,
        message: freshOp?.errorMessage ?? "Operation is no longer in recoverable state",
      };
    }

    if (getOperationRecoveryMode(freshOp) === "compensation_blocked" && input.resolution?.kind !== "reconcile_compensation") {
      return {
        kind: "failed_before_commit",
        ticketId: freshOp.ticketId,
        commentId: freshOp.commentId,
        error: new Error(vscode.l10n.t("Only reconcile_compensation is allowed while primary compensation has unresolved rollback obligations.")),
      };
    }

    if (
      freshOp.operationId !== input.operationId ||
      freshRevision !== input.operationRevision ||
      freshAttemptGeneration !== currentAttemptGeneration ||
      freshAttemptGeneration !== input.attemptGeneration
    ) {
      return {
        kind: "failed_before_commit",
        error: new Error("Operation attempt generation changed while preparing recovery"),
      };
    }

    if (
      input.resolution?.kind === "reconcile_compensation" ||
      freshPrimaryEffect?.state === "compensation_unknown" ||
      freshPrimaryEffect?.state === "compensation_started"
    ) {
      return recovery.resolveEffect({
        key: input.key,
        operationId: freshOp.operationId,
        operationRevision: freshRevision,
        attemptGeneration: freshAttemptGeneration,
        effectId: freshPrimaryEffect?.effectId ?? "ticket-create",
        expectedEffectState: freshPrimaryEffect?.state ?? "compensation_unknown",
        context: input.context,
        resolution: { kind: "reconcile_compensation" },
        deps: input.deps,
      });
    }

    const handler = recovery.handlers[freshOp.kind];
    const handlerCtx: OperationHandlerContext = { connectionScope: scope };
    const repository = withAttemptGenerationFence(recovery.repository, freshAttemptGeneration);
    const depsWithRepo = { ...input.deps, repository };

    if (
      input.resolution?.kind === "link_remote_ticket" &&
      freshOp.kind === "ticket_update"
    ) {
      return {
        kind: "failed_before_commit",
        ticketId: freshOp.ticketId,
        error: new Error("Ticket Update recovery must use reconcile_remote; link_remote_ticket is not allowed."),
      };
    }





    if (
      (input.resolution?.kind === "link_remote_ticket" ||
        input.resolution?.kind === "link_remote_comment" ||
        (input.resolution as { kind?: string } | undefined)?.kind === "assume_remote_commit" ||
        (input.resolution as { kind?: string } | undefined)?.kind === "assume_update_committed") &&
      freshOp.phase !== "commit_unknown" &&
      !(input.resolution?.kind === "link_remote_comment" &&
        freshOp.kind === "comment_create" &&
        freshOp.phase === "reconciliation_pending" &&
        freshPrimaryEffect?.state === "committed")
    ) {
      return {
        kind: "commit_unknown",
        operationId: freshOp.operationId,
        ticketId: freshOp.ticketId,
        commentId: freshOp.commentId,
        message: vscode.l10n.t("The remote write is still in progress; wait for it to finish before resolving the outcome."),
      };
    }

    if (input.resolution?.kind === "retry_remote_write") {
      const isComment = freshOp.kind === "comment_create" || freshOp.kind === "comment_update";
      if (isComment && (!freshPrimaryEffect || freshPrimaryEffect.kind !== freshOp.kind || !canRetryFailedCommentEffect(freshPrimaryEffect))) {
        return {
          kind: "failed_before_commit",
          ticketId: freshOp.ticketId,
          commentId: freshOp.commentId,
          error: new Error(vscode.l10n.t("Only retryable comment failures with a saved request can be retried.")),
        };
      }

      const activeEffects = getEffectsForRevision(freshOp, freshRevision);
      const hasUnresolvedPrereq = activeEffects.some(
        (e) =>
          (e.kind === "attachment_upload" || e.kind === "attachment_link" || e.kind === "image_upload" || (typeof e.effectId === "string" && (e.effectId.startsWith("attachment") || e.effectId.startsWith("image")))) &&
          (e.state === "started" || e.state === "failed" || e.state === "commit_unknown" || e.state === "compensation_started" || e.state === "compensation_unknown" || e.state === "planned"),
      );
      if (hasUnresolvedPrereq) {
        return {
          kind: "commit_unknown",
          operationId: freshOp.operationId,
          ticketId: freshOp.ticketId,
          commentId: freshOp.commentId,
          message: "Prerequisite effects remain unresolved. Resolve prerequisite effects before retrying primary remote write.",
        };
      }

      const primaryEffect = getPrimaryEffectForRevision(freshOp, freshRevision);



      const isPrimaryCommitted =
        primaryEffect?.state === "committed" ||
        (primaryEffect === undefined && freshOp.createdRemoteId !== undefined && freshOp.createdRemoteId > 0);
      if (isPrimaryCommitted) {
        return {
          kind: "remote_committed",
          ticketId: getOutcomeTicketId(freshOp),
          commentId: freshOp.commentId,
          pending: "remote_reconcile",
          message: "Primary mutation is already committed. Use effect-specific recovery for remaining secondary effects.",
        };
      }

      if (primaryEffect && (!canRetryEffect(primaryEffect) ||
        (freshOp.kind === "ticket_create" && freshOp.createdRemoteId !== undefined))) {
        return {
          kind: "failed_before_commit",
          ticketId: freshOp.ticketId,
          commentId: freshOp.commentId,
          error: new Error(primaryEffect.failure?.detail ?? "Cannot retry mutation without verifiable request identity or retryable disposition."),
        };
      }

      const prepResult = await handler.prepare(freshOp, handlerCtx, depsWithRepo);
      if (!prepResult.ok) {
        if (isComment) {
          return prepResult.outcome;
        }
        return { kind: "commit_unknown", operationId: freshOp.operationId,
          ticketId: freshOp.ticketId, message: "Preflight preparation failed" };
      }

      const remoteResult = await handler.executeRemoteWrite(freshOp, prepResult.prepared, handlerCtx, depsWithRepo);
      if (!remoteResult.ok) {
        if (remoteResult.commitUnknown) {
          return {
            kind: "commit_unknown",
            operationId: freshOp.operationId,
            ticketId: freshOp.ticketId,
            commentId: freshOp.commentId,
            message: remoteResult.error.message,
          };
        }
        return {
          kind: "failed_before_commit",
          ticketId: freshOp.ticketId,
          commentId: freshOp.commentId,
          error: remoteResult.error,
        };
      }

      const committedOp = repository.getOperation(input.key, scope) ?? freshOp;

      return recovery.executeSyncLifecycle(committedOp, input.context, { deps: depsWithRepo });
    }

    if (input.resolution?.kind === "link_remote_ticket" || input.resolution?.kind === "link_remote_comment") {
      const isComment = input.resolution.kind === "link_remote_comment";
      const remoteId = input.resolution.kind === "link_remote_comment" ? input.resolution.commentId : input.resolution.ticketId;

      let detail: any = undefined;
      let linkedProjectId: number | undefined;
      if (isComment) {
        const commentDeps = { ...defaultCommentDeps, ...input.deps?.comment };
        const primarySnapshot = freshPrimaryEffect?.requestSnapshot;
        const submittedBody =
          primarySnapshot?.kind === "comment_create" || primarySnapshot?.kind === "comment_update"
            ? primarySnapshot.request?.notes ?? primarySnapshot.submittedBody
            : undefined;
        const verified = await reconcileCommentCommitUnknown(
          {
            ticketId: freshOp.ticketId ?? (freshOp.intent as any)?.ticketId ?? 0,
            commentId: freshOp.commentId,
            body: submittedBody ?? freshPrimaryEffect?.target?.submittedBody ?? (freshOp.intent as any)?.body ?? "",
            documentUri: freshOp.documentUri,
            operationId: freshOp.operationId,
            phase: freshOp.phase as any,
            revision: freshOp.revision,
          },
          commentDeps,
          remoteId,
        );
        if (!verified.ok) {
          return {
            kind: "commit_unknown",
            operationId: freshOp.operationId,
            ticketId: freshOp.ticketId,
            commentId: freshOp.commentId,
            message: verified.message,
          };
        }
        linkedProjectId = verified.projectId;
      } else {
        const getDetail = (freshOp.kind === "ticket_create" ? input.deps?.ticketCreate?.getIssueDetail : input.deps?.ticketUpdate?.getIssueDetail)
          ?? input.deps?.ticketCreate?.getIssueDetail
          ?? input.deps?.ticketUpdate?.getIssueDetail
          ?? getIssueDetail;
        try {
          detail = await getDetail(remoteId);
          if (!detail || !detail.ticket) {
            return {
              kind: "commit_unknown",
              operationId: freshOp.operationId,
              ticketId: freshOp.ticketId,
              message: `Remote ticket #${remoteId} not found`,
            };
          }
          const expectedProjectId = freshOp.projectId ?? (freshOp.intent as any)?.projectId;
          const expectedSubject = (freshOp.intent as any)?.subject ?? (freshOp.intent as any)?.baseSubject ?? "";
          if (expectedProjectId !== undefined && expectedProjectId > 0 && detail.ticket.projectId !== expectedProjectId) {
            return {
              kind: "commit_unknown",
              operationId: freshOp.operationId,
              ticketId: freshOp.ticketId,
              message: `Remote ticket #${remoteId} projectId (${detail.ticket.projectId}) does not match expected (${expectedProjectId})`,
            };
          }
          if (!input.resolution?.explicitLink && expectedSubject && detail.ticket.subject.trim() !== expectedSubject.trim()) {
            return {
              kind: "commit_unknown",
              operationId: freshOp.operationId,
              ticketId: freshOp.ticketId,
              message: `Remote ticket #${remoteId} subject ("${detail.ticket.subject}") does not match expected ("${expectedSubject}")`,
            };
          }
        } catch (err) {
          return {
            kind: "commit_unknown",
            operationId: freshOp.operationId,
            ticketId: freshOp.ticketId,
            message: (err as Error).message,
          };
        }
      }

      const identityAction = isComment
        ? { kind: "record_reconciled_identity" as const, remoteId, projectId: linkedProjectId }
        : { kind: "record_reconciled_identity" as const, remoteId };
      const transitioned = await repository.transitionOperation(
        input.key,
        identityAction,
        scope,
        { operationId: freshOp.operationId, sourcePhase: freshOp.phase, revision: freshOp.intentRevision ?? freshOp.revision },
      );
      if (!transitioned) {
        return {
          kind: "commit_unknown",
          operationId: freshOp.operationId,
          ticketId: freshOp.ticketId,
          commentId: freshOp.commentId,
          message: "Failed to record reconciled identity due to conflict",
        };
      }
      const fin = await handler.finalizeLocal(transitioned, detail, handlerCtx, depsWithRepo);
      if (fin.ok) {
        const compOp = await repository.completeOperation(input.key, scope, transitioned.intentRevision ?? transitioned.revision ?? 1, { canonical: detail, remoteUpdatedAt: transitioned.remoteUpdatedAt }, getAttemptGeneration(transitioned));
        if (compOp) {
          return {
            kind: "completed",
            ticketId: getOutcomeTicketId(transitioned),
            commentId: isComment ? remoteId : undefined,
          };
        }
        return { kind: "remote_committed", ticketId: getOutcomeTicketId(transitioned), commentId: isComment ? remoteId : undefined, pending: "local_finalize", message: "Failed to persist complete state" };
      }
      return { kind: "remote_committed", ticketId: getOutcomeTicketId(transitioned), commentId: isComment ? remoteId : undefined, pending: "local_finalize", message: fin.message };
    }

    if ((input.resolution as any)?.kind === "assume_remote_commit" || (input.resolution as any)?.kind === "assume_update_committed") {
      const assumed = await repository.transitionOperation(
        input.key,
        { kind: "assume_remote_commit" },
        scope,
        { operationId: freshOp.operationId, sourcePhase: freshOp.phase, revision: freshOp.intentRevision ?? freshOp.revision },
      );
      if (!assumed) {
        return {
          kind: "commit_unknown",
          operationId: freshOp.operationId,
          ticketId: freshOp.ticketId,
          commentId: freshOp.commentId,
          message: "Failed to transition to assume_remote_commit due to conflict",
        };
      }
      const reconciled = await handler.reconcileRemote(assumed, handlerCtx, depsWithRepo);
      if (!reconciled.ok) {
        return {
          kind: "remote_committed",
          ticketId: getOutcomeTicketId(assumed),
          commentId: assumed.commentId,
          pending: "remote_reconcile",
          message: reconciled.message,
        };
      }
      const fin = await handler.finalizeLocal(assumed, reconciled.canonical, handlerCtx, depsWithRepo);
      if (fin.ok) {
        const compOp = await repository.completeOperation(input.key, scope, assumed.intentRevision ?? assumed.revision ?? 1, { canonical: reconciled.canonical, remoteUpdatedAt: assumed.remoteUpdatedAt }, getAttemptGeneration(assumed));
        if (compOp) {
          return {
            kind: "completed",
            ticketId: getOutcomeTicketId(assumed),
            commentId: assumed.commentId,
          };
        }
        return {
          kind: "remote_committed",
          ticketId: getOutcomeTicketId(assumed),
          pending: "local_finalize",
          message: "Failed to persist complete state",
        };
      }
      return {
        kind: "remote_committed",
        ticketId: getOutcomeTicketId(assumed),
        pending: "local_finalize",
        message: fin.message,
      };
    }

    const reconciled = await handler.reconcileRemote(freshOp, handlerCtx, depsWithRepo);
    if (reconciled.ok && reconciled.remoteId) {
      const transitioned = await repository.transitionOperation(
        input.key,
        { kind: "record_reconciled_identity", remoteId: reconciled.remoteId, projectId: reconciled.projectId, remoteUpdatedAt: reconciled.remoteUpdatedAt },
        scope,
        { operationId: freshOp.operationId, sourcePhase: freshOp.phase, revision: freshOp.intentRevision ?? freshOp.revision },
      );
      if (!transitioned) {
        return { kind: "failed_before_commit", error: new Error("Failed to record reconciled identity") };
      }
      const fin = await handler.finalizeLocal(transitioned, reconciled.canonical, handlerCtx, depsWithRepo);
      if (fin.ok) {
        const compOp = await repository.completeOperation(input.key, scope, transitioned.intentRevision ?? transitioned.revision ?? 1, { canonical: reconciled.canonical, remoteUpdatedAt: transitioned.remoteUpdatedAt }, getAttemptGeneration(transitioned));
        if (compOp) {
          return {
            kind: "completed",
            ticketId: getOutcomeTicketId(transitioned),
            commentId: transitioned.createdRemoteId ?? transitioned.commentId,
          };
        }
        return {
          kind: "remote_committed",
          ticketId: getOutcomeTicketId(transitioned),
          commentId: transitioned.createdRemoteId ?? transitioned.commentId,
          pending: "local_finalize",
          message: "Failed to persist complete state",
        };
      }
      return {
        kind: "remote_committed",
        ticketId: getOutcomeTicketId(transitioned),
        commentId: transitioned.createdRemoteId ?? transitioned.commentId,
        pending: "local_finalize",
        message: fin.message,
      };
    }

    return {
      kind: "commit_unknown",
      operationId: freshOp.operationId,
      ticketId: freshOp.ticketId,
      commentId: freshOp.commentId,
      message: reconciled.ok ? "Reconciliation failed" : reconciled.message,
    };
  });

  recovery.inFlight.set(flightKey, flightPromise);
  try {
    return await flightPromise;
  } finally {
    recovery.inFlight.delete(flightKey);
    endActiveSync();
  }
};
