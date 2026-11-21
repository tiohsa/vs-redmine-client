import { runWithConnectionScope } from "../../redmine/client";
import {
  OperationHandlerContext,
  OperationHandlerDeps,
} from "./operationHandlers";
import { withAttemptGenerationFence } from "./syncRepository";
import { SyncOutcome } from "./syncOperationTypes";
import { getAttemptGeneration } from "../syncEffects";
import { beginActiveSync } from "../../views/offlineSyncStore";

import { getOutcomeTicketId } from "./syncOutcomeTicketId";
import type { SyncRecoveryInput, SyncRecoveryDependencies } from "./syncRecoveryTypes";

import { matchRecoveryAttempt } from "./syncRecoveryAttempt";

export const resolveLocalFinalize = async (
  input: SyncRecoveryInput,
  recovery: SyncRecoveryDependencies,
): Promise<SyncOutcome> => {
  const scope = input.context.connectionScope;
  if (!Number.isInteger(input.attemptGeneration) || input.attemptGeneration <= 0) {
    return {
      kind: "failed_before_commit",
      error: new Error("Recovery attemptGeneration is required and must be a positive integer."),
    };
  }
  const op = recovery.repository.getOperation(input.key, scope);
  if (!op) {
    return {
      kind: "failed_before_commit",
      error: new Error(`Operation not found for local finalize resolution: key=${JSON.stringify(input.key)}`),
    };
  }
  const attempt = matchRecoveryAttempt(op, input);
  if (!attempt.ok) {
    return { kind: "failed_before_commit", error: attempt.error };
  }
  const { currentRevision, currentAttemptGeneration } = attempt;
  if (op.phase !== "local_finalize_pending") {
    return {
      kind: "failed_before_commit",
      error: new Error(`Operation phase mismatch: expected "local_finalize_pending", got "${op.phase}"`),
    };
  }

  const flightKey = `${scope}:${op.operationId}`;
  const existingFlight = recovery.inFlight.get(flightKey);
  if (existingFlight) {
    return existingFlight;
  }

  const handler = recovery.handlers[op.kind];
  if (!handler) {
    return {
      kind: "failed_before_commit",
      error: new Error(`No handler registered for operation kind ${op.kind}`),
    };
  }
  const handlerCtx: OperationHandlerContext = {
    connectionScope: scope,
  };
  const repository = withAttemptGenerationFence(
    input.deps?.repository ?? recovery.repository,
    input.attemptGeneration,
  );
  const depsWithRepo: OperationHandlerDeps = {
    ...input.deps,
    repository,
    skipDocumentRewrite: true,
  };

  const endActiveSync = beginActiveSync(scope, op.operationId);
  const flightPromise = runWithConnectionScope(scope, async (): Promise<SyncOutcome> => {
    const freshOp = repository.getOperation(input.key, scope);
    if (
      !freshOp ||
      freshOp.operationId !== input.operationId ||
      (freshOp.intentRevision ?? freshOp.revision ?? 1) !== input.operationRevision ||
      getAttemptGeneration(freshOp) !== input.attemptGeneration ||
      freshOp.phase !== "local_finalize_pending"
    ) {
      return {
        kind: "failed_before_commit",
        error: new Error("Operation state changed before local finalize resolution."),
      };
    }

    const canonical = (freshOp as any).canonical;
    const finalizeResult = await handler.finalizeLocal(freshOp, canonical, handlerCtx, depsWithRepo);
    if (!finalizeResult.ok) {
      return {
        kind: "remote_committed",
        ticketId: getOutcomeTicketId(freshOp),
        commentId: freshOp.commentId,
        pending: "local_finalize",
        message: finalizeResult.message,
      };
    }

    const compRes = await repository.completeOperation(
      freshOp.key ?? input.key,
      scope,
      freshOp.intentRevision ?? freshOp.revision ?? 1,
      { canonical, remoteUpdatedAt: freshOp.remoteUpdatedAt },
      getAttemptGeneration(freshOp),
    );
    if (!compRes) {
      return {
        kind: "remote_committed",
        ticketId: getOutcomeTicketId(freshOp),
        commentId: freshOp.commentId,
        pending: "local_finalize",
        message: "Failed to complete operation persistence",
      };
    }
    return {
      kind: "completed",
      ticketId: getOutcomeTicketId(freshOp),
      commentId: freshOp.commentId,
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
