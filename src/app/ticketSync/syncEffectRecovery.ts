import * as vscode from "vscode";
import { runWithConnectionScope } from "../../redmine/client";
import { OperationHandlerContext } from "./operationHandlers";
import { withAttemptGenerationFence } from "./syncRepository";
import { SyncOutcome } from "./syncOperationTypes";
import {
  canRetryEffect,
  getAttemptGeneration,
  getOperationRecoveryMode,
  isPrimaryEffectKind,
} from "../syncEffects";
import { beginActiveSync } from "../../views/offlineSyncStore";

import type { SyncEffectRecoveryInput, SyncRecoveryDependencies } from "./syncRecoveryTypes";

import { matchRecoveryAttempt } from "./syncRecoveryAttempt";

export const resolveEffect = async (
  input: SyncEffectRecoveryInput,
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
      error: new Error(`Operation not found for effect resolution: key=${JSON.stringify(input.key)}, effectId=${input.effectId}`),
    };
  }

  const attempt = matchRecoveryAttempt(op, input);
  if (!attempt.ok) {
    return { kind: "failed_before_commit", error: attempt.error };
  }
  const { currentRevision, currentAttemptGeneration } = attempt;
  const effect = (op.effects ?? []).find(
    (e) =>
      e.effectId === input.effectId &&
      (e.operationRevision ?? currentRevision) === input.operationRevision &&
      getAttemptGeneration({ attemptGeneration: e.attemptGeneration }) === currentAttemptGeneration,
  );
  if (!effect) {
    return {
      kind: "failed_before_commit",
      error: new Error(`Effect not found: effectId=${input.effectId} in operation ${op.operationId}`),
    };
  }

  if (effect.state !== input.expectedEffectState) {
    return {
      kind: "failed_before_commit",
      error: new Error(`Effect state mismatch: effect ${input.effectId} is in state "${effect.state}", expected "${input.expectedEffectState}"`),
    };
  }

  if (effect.operationRevision !== undefined && effect.operationRevision !== input.operationRevision) {
    return {
      kind: "failed_before_commit",
      error: new Error(`Effect revision mismatch: expected ${effect.operationRevision}, got ${input.operationRevision}`),
    };
  }

  if (input.resolution.kind === "retry_effect" && !canRetryEffect(effect)) {
    return {
      kind: "failed_before_commit",
      error: new Error(effect.failure?.detail ?? `Effect ${input.effectId} is not retryable without valid identity or retryable disposition.`),
    };
  }

  const isPrimaryEffect =
    input.effectId === "ticket-create" ||
    input.effectId === "ticket-update" ||
    input.effectId === "comment-create" ||
    input.effectId === "comment-update" ||
    isPrimaryEffectKind(effect.kind);

  if (isPrimaryEffect && effect.state !== "compensation_unknown" && effect.state !== "compensation_started") {
    return {
      kind: "failed_before_commit",
      error: new Error("Primary mutations cannot be resolved via generic resolveEffect. Use resolveCommitUnknown instead."),
    };
  }

  const opRecoveryMode = getOperationRecoveryMode(op);
  if (opRecoveryMode === "compensation_blocked" && input.resolution.kind !== "reconcile_compensation") {
    return {
      kind: "failed_before_commit",
      error: new Error(vscode.l10n.t("Only reconcile_compensation is allowed while primary compensation has unresolved rollback obligations.")),
    };
  }

  if (opRecoveryMode === "compensation_uncertainty" && !isPrimaryEffect) {
    if (
      input.resolution.kind === "retry_effect" ||
      input.resolution.kind === "link_remote_child" ||
      (input.resolution as any).kind === "start" ||
      (input.resolution as any).kind === "assume_committed"
    ) {
      return {
        kind: "failed_before_commit",
        error: new Error("Secondary forward recovery is blocked by primary compensation uncertainty. Reconcile primary compensation first."),
      };
    }
  }

  const flightKey = `${scope}:resolveEffect:${op.operationId}:${input.operationRevision}:${currentAttemptGeneration}:${input.effectId}`;
  if (recovery.inFlight.has(flightKey)) {
    return recovery.inFlight.get(flightKey)!;
  }

  const endActiveSync = beginActiveSync(scope, op.operationId);
  const flightPromise: Promise<SyncOutcome> = runWithConnectionScope(scope, async (): Promise<SyncOutcome> => {
    const handler = recovery.handlers[op.kind];
    const handlerCtx: OperationHandlerContext = { connectionScope: scope };
    const repository = withAttemptGenerationFence(recovery.repository, currentAttemptGeneration);
    const depsWithRepo = { ...input.deps, repository };

    if (handler && handler.resolveEffect) {
      return handler.resolveEffect({
        key: input.key,
        effectId: input.effectId,
        operation: op,
        context: handlerCtx,
        deps: depsWithRepo,
        resolution: input.resolution,
      });
    }

    return {
      kind: "failed_before_commit",
      error: new Error(`Handler for "${op.kind}" does not support effect-specific recovery for effectId "${input.effectId}"`),
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
