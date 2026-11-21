import * as vscode from "vscode";
import { CreateOperationHttpError, extractHttpStatusCode } from "../../redmine/httpError";
import { runWithConnectionScope } from "../../redmine/client";
import {
  CommentCreateHandler,
  CommentUpdateHandler,
  OperationHandler,
  OperationHandlerContext,
  OperationHandlerDeps,
  TicketCreateHandler,
  TicketUpdateHandler,
} from "./operationHandlers";
import {
  createSyncOperationRepository,
  SyncOperationRepository,
  withAttemptGenerationFence,
} from "./syncRepository";
import {
  SyncOperationKey,
  SyncOutcome,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import {
  evaluateAttemptClosure,
  getAttemptGeneration,
  getEffectsForRevision,
  getOperationRecoveryMode,
  getPrimaryEffectForRevision,
  getRecoveryItemsForOperation,
  isPrimaryEffectKind,
  isRejectedTicketCreate,
  RecoveryItem,
} from "../syncEffects";
import type { SyncContext } from "./ports";
import { beginActiveSync } from "../../views/offlineSyncStore";

import { resolveCommitUnknown } from "./syncCommitUnknownRecovery";
import { resolveEffect } from "./syncEffectRecovery";
import { resolveLocalFinalize } from "./syncLocalFinalizeRecovery";
import type {
  CommitUnknownRecoveryInput,
  SyncEffectRecoveryInput,
  SyncRecoveryDependencies,
  SyncRecoveryInput,
} from "./syncRecoveryTypes";
import { getOutcomeTicketId } from "./syncOutcomeTicketId";

export type SyncAllStopReason = "completed" | "user_cancelled" | "blocked_by_recovery" | "failed";

export interface SyncCoordinatorOptions {
  deps?: OperationHandlerDeps;
  applyContent?: (editor: vscode.TextEditor, content: string) => Promise<void>;
  runInConnectionScope?: <T>(scope: string, operation: () => Promise<T>) => Promise<T>;
  shouldContinue?: () => boolean;
}

export interface SyncCoordinatorDependencies {
  repository?: SyncOperationRepository;
  handlers?: {
    ticketCreate?: OperationHandler;
    ticketUpdate?: OperationHandler;
    commentCreate?: OperationHandler;
    commentUpdate?: OperationHandler;
  };
}

export interface SyncAllCoordinatorOutcome {
  plan: SyncOperationKey[];
  results: Array<{ key: SyncOperationKey; outcome: SyncOutcome }>;
  remaining: SyncOperationKey[];
  cancelled: boolean;
  stopReason: SyncAllStopReason;
}

export class SyncCoordinator {
  private readonly repository: SyncOperationRepository;
  private readonly handlers: {
    ticket_create: OperationHandler;
    ticket_update: OperationHandler;
    comment_create: OperationHandler;
    comment_update: OperationHandler;
  };
  private readonly inFlight = new Map<string, Promise<SyncOutcome>>();

  private readonly recovery: SyncRecoveryDependencies;

  public constructor(deps: SyncCoordinatorDependencies = {}) {
    this.repository = deps.repository ?? createSyncOperationRepository();
    this.handlers = {
      ticket_create: deps.handlers?.ticketCreate ?? new TicketCreateHandler(),
      ticket_update: deps.handlers?.ticketUpdate ?? new TicketUpdateHandler(),
      comment_create: deps.handlers?.commentCreate ?? new CommentCreateHandler(),
      comment_update: deps.handlers?.commentUpdate ?? new CommentUpdateHandler(),
    };
    this.recovery = { repository: this.repository, handlers: this.handlers, inFlight: this.inFlight };
  }

  public getRepository(): SyncOperationRepository {
    return this.repository;
  }

  public getRecoveryItems(key: SyncOperationKey, context: SyncContext): RecoveryItem[] {
    const scope = context.connectionScope;
    const op = this.repository.getOperation(key, scope);
    if (!op) {
      return [];
    }
    return getRecoveryItemsForOperation(op);
  }

  public async sync(
    key: SyncOperationKey,
    context: SyncContext,
    options: SyncCoordinatorOptions = {},
  ): Promise<SyncOutcome> {
    const scope = context.connectionScope;
    const operation = this.repository.getOperation(key, scope);
    if (!operation) {
      return {
        kind: "failed_before_commit",
        error: new Error(
          key.kind === "comment"
            ? "Queue entry for this comment update not found."
            : key.kind === "newTicket"
              ? "Queue entry for this new ticket not found."
              : "Queue entry for this ticket update not found.",
        ),
      };
    }

    // INV-05: ConnectionScope 検証
    if (operation.connectionScope && operation.connectionScope !== scope) {
      const error = new Error(`Connection scope mismatch: expected ${operation.connectionScope}, got ${scope}`);
      return { kind: "failed_before_commit", error };
    }

    const currentRevision = operation.intentRevision ?? operation.revision ?? 1;
    const activeEffects = getEffectsForRevision(operation, currentRevision);
    const recoveryMode = getOperationRecoveryMode(operation);

    // INV-N07: Primary compensated + semantic rollback blocker is rollback-only.
    // Do this before any preparation/secondary/primary path so a stale parent ID
    // cannot reach a remote mutation through normal sync.
    if (recoveryMode === "compensation_blocked") {
      const closureDecision = evaluateAttemptClosure(
        operation,
        currentRevision,
        getAttemptGeneration(operation),
      );
      const compensatedPrimary = getPrimaryEffectForRevision(operation, currentRevision);
      if (closureDecision.closable && compensatedPrimary?.state === "compensated") {
        const closed = await this.repository.transitionEffect(
          key,
          compensatedPrimary.effectId,
          { kind: "complete_compensation" },
          scope,
          {
            operationRevision: currentRevision,
            attemptGeneration: getAttemptGeneration(operation),
            sourceState: "compensated",
          },
        );
        if (!closed) {
          return {
            kind: "failed_before_commit",
            error: new Error(vscode.l10n.t("Failed to persist the compensated Attempt closure.")),
          };
        }
        return {
          kind: "remote_committed",
          ticketId: 0,
          commentId: operation.commentId,
          pending: "remote_reconcile",
          message: vscode.l10n.t("The compensated Attempt was closed without a remote mutation. Run sync again to process the queued Attempt."),
        };
      }
      return {
        kind: "remote_committed",
        ticketId: 0,
        commentId: operation.commentId,
        pending: "remote_reconcile",
        message: vscode.l10n.t("Primary compensation has unresolved rollback obligations; reconcile compensation before forwarding this operation."),
      };
    }

    // 1. 親がコミット済みで、不確実・失敗した child effect が存在する場合のみ remote_committed を返して自動同期をブロック (INV-N01, INV-N02)
    const hasUnresolvedChildEffect = activeEffects.some(
      (e) =>
        (e.kind === "child_create" || (typeof e.effectId === "string" && e.effectId.startsWith("child-create"))) &&
        (e.state === "commit_unknown" || e.state === "failed" || e.state === "compensation_unknown" || e.state === "compensation_started"),
    );
    const primary = getPrimaryEffectForRevision(operation, currentRevision);
    // INV-N12: compensated な Primary Effect は committed として誤判定しない
    const isPrimaryCompensated = primary?.state === "compensated";
    const isParentCommitted = !isPrimaryCompensated && (
      operation.kind === "ticket_create"
        ? (primary?.state === "committed" ||
           primary?.state === "compensation_unknown" ||
           primary?.state === "compensation_started" ||
           primary?.state === "commit_unknown" || (
            operation.createdRemoteId !== undefined &&
            operation.createdRemoteId > 0 &&
            operation.phase !== "queued" &&
            operation.phase !== "preparing"
          ))
        : (primary?.state === "committed")
    );

    if (hasUnresolvedChildEffect && isParentCommitted) {
      const committedParentId = getOutcomeTicketId(operation, operation.createdRemoteId ?? primary?.remoteId);
      return {
        kind: "remote_committed",
        ticketId: committedParentId,
        commentId: operation.commentId,
        pending: "remote_reconcile",
        message: "Secondary child effects remain unresolved",
      };
    }

    // D-04 / F-02 / F-03: failed / commit_unknown な Effect を持つ Operation は normal sync から自動再送できない (retry = 0)
    if (primary && (primary.state === "failed" || primary.state === "commit_unknown")) {
      if (primary.state === "commit_unknown") {
        return {
          kind: "commit_unknown",
          operationId: operation.operationId,
          ticketId: operation.ticketId,
          commentId: operation.commentId,
          message: operation.errorMessage ?? vscode.l10n.t("A previous remote write outcome is unknown. Please resolve or reconcile before retrying."),
        };
      }
      return {
        kind: "failed_before_commit",
        error: new Error(isRejectedTicketCreate(primary)
          ? vscode.l10n.t("Failed to create issue (HTTP {0}).", 403)
          : primary.failure?.detail ?? "Primary remote mutation has previously failed. Explicit recovery required."),
        ticketId: operation.ticketId,
        commentId: operation.commentId,
      };
    }

    const failedSecondary = activeEffects.find(
      (e) => !isPrimaryEffectKind(e.kind) && e.state === "failed"
    );
    if (failedSecondary) {
      return {
        kind: "failed_before_commit",
        error: new Error(failedSecondary.failure?.detail ?? `Secondary effect ${failedSecondary.effectId} has failed. Explicit recovery required.`),
        ticketId: operation.ticketId,
        commentId: operation.commentId,
      };
    }

    // R-04 / INV-04: failed / commit_unknown な Durable Effect を持つ operation は通常の sync() から自動再送できない (explicit recovery のみ)
    if (operation.phase === "commit_unknown" || operation.phase === "remote_write_started") {
      return {
        kind: "commit_unknown",
        operationId: operation.operationId,
        ticketId: operation.ticketId,
        commentId: operation.commentId,
        message: operation.errorMessage ?? vscode.l10n.t("A previous remote write outcome is unknown. Please resolve or reconcile before retrying."),
      };
    }

    // INV-02: Single-flight
    const flightKey = `${scope}:${operation.operationId}`;
    const activeFlight = this.inFlight.get(flightKey);
    if (activeFlight) {
      return activeFlight;
    }

    const runner = options.runInConnectionScope ?? runWithConnectionScope;
    const endActiveSync = beginActiveSync(scope, operation.operationId);
    const flightPromise = runner(scope, async () => {
      try {
        return await this.executeSyncLifecycle(operation, context, options);
      } finally {
        this.inFlight.delete(flightKey);
        endActiveSync();
      }
    });

    this.inFlight.set(flightKey, flightPromise);
    return flightPromise;
  }

  private async executeSyncLifecycle(
    initialOp: UnifiedSyncOperation,
    context: SyncContext,
    options: SyncCoordinatorOptions,
  ): Promise<SyncOutcome> {
    const scope = context.connectionScope;
    const handler = this.handlers[initialOp.kind];
    if (!handler) {
      return {
        kind: "failed_before_commit",
        error: new Error(`No handler registered for operation kind ${initialOp.kind}`),
      };
    }

    const handlerCtx: OperationHandlerContext = { connectionScope: scope };
    const repository = withAttemptGenerationFence(
      options.deps?.repository ?? this.repository,
      getAttemptGeneration(initialOp),
    );
    const depsWithRepo = { ...options.deps, repository };
    let currentOp = initialOp;

    const getOpKey = (op: UnifiedSyncOperation): SyncOperationKey =>
      op.key ?? initialOp.key ?? (op.kind === "ticket_create"
        ? { kind: "newTicket", queueId: op.operationId, documentUri: op.documentUri }
        : { kind: "ticket", ticketId: op.ticketId ?? 0 });

    // 0. Phase チェック
    if (currentOp.phase === "completed") {
      const unresolved = getEffectsForRevision(currentOp).some(
        (effect) => effect.state !== "committed" && effect.state !== "compensated",
      );
      let completion: Parameters<SyncOperationRepository["completeOperation"]>[3];
      if (!unresolved && currentOp.nextIntent) {
        // 後続編集の基準を古いbaseへ戻さず、read-backした値で昇格する。
        const reconciled = await handler.reconcileRemote(currentOp, handlerCtx, depsWithRepo);
        if (!reconciled.ok) {
          return {
            kind: "remote_committed", ticketId: getOutcomeTicketId(currentOp),
            commentId: currentOp.commentId, pending: "remote_reconcile", message: reconciled.message,
          };
        }
        completion = { canonical: reconciled.canonical, remoteUpdatedAt: reconciled.remoteUpdatedAt ?? currentOp.remoteUpdatedAt };
      }
      if (!unresolved && await repository.completeOperation(
        getOpKey(currentOp), scope, currentOp.intentRevision ?? currentOp.revision ?? 1,
        completion,
        getAttemptGeneration(currentOp),
      )) {
        return { kind: "no_change", ticketId: getOutcomeTicketId(currentOp), commentId: currentOp.commentId };
      }
      return {
        kind: "remote_committed",
        ticketId: getOutcomeTicketId(currentOp),
        commentId: currentOp.commentId,
        pending: "local_finalize",
        message: "Failed to complete operation persistence",
      };
    }

    // Step A: Preparation & Remote Write (queued / preparing の場合のみ)
    let prepResult: any = undefined;
    if (currentOp.phase === "queued" || currentOp.phase === "preparing") {
      // 1. begin_preparation (queued の場合のみ)
      if (currentOp.phase === "queued") {
        const prepOp = await repository.transitionOperation(
          getOpKey(currentOp),
          { kind: "begin_preparation" },
          scope,
        );
        if (!prepOp) {
          return { kind: "failed_before_commit", error: new Error("Failed to transition to preparing") };
        }
        currentOp = prepOp;
      }

      // 2. handler.prepare
      prepResult = await handler.prepare(currentOp, handlerCtx, depsWithRepo);
      if (!prepResult.ok) {
        if (prepResult.outcome.kind === "no_change" && (currentOp.effects?.length ?? 0) === 0) {
          // 送信不要でも永続キューを完了させる。後続編集の昇格と世代フェンスは通常完了と共通。
          const completed = await repository.completeOperation(
            getOpKey(currentOp),
            scope,
            currentOp.intentRevision ?? currentOp.revision ?? 1,
            undefined,
            getAttemptGeneration(currentOp),
          );
          if (completed) { return prepResult.outcome; }
          return {
            kind: "failed_before_commit",
            ticketId: currentOp.ticketId,
            commentId: currentOp.commentId,
            error: new Error("Failed to complete operation persistence"),
          };
        }
        if (currentOp.phase === "preparing") {
          const error: unknown = prepResult.outcome.error;
          const status = extractHttpStatusCode(error);
          const message = currentOp.kind === "ticket_create" && prepResult.outcome.kind === "failed_before_commit"
            ? error instanceof CreateOperationHttpError ? error.message
              : status ? vscode.l10n.t("Ticket creation preparation failed (HTTP {0}).", status)
                : vscode.l10n.t("Ticket creation preparation failed.")
            : undefined;
          await repository.transitionOperation(
            getOpKey(currentOp),
            { kind: "abort_before_remote_write", message },
            scope,
          );
          if (message && status && !(error instanceof CreateOperationHttpError)) {
            return { kind: "failed_before_commit", error: new Error(message) };
          }
        }
        return prepResult.outcome;
      }

      // 3. Secondary Effects (attachment upload 等)
      if (handler.executeSecondaryEffects && (currentOp.phase === "queued" || currentOp.phase === "preparing")) {
        const secResult = await handler.executeSecondaryEffects(currentOp, prepResult.prepared, handlerCtx, depsWithRepo);
        if (!secResult.ok) {
          if (secResult.outcome) {
            return secResult.outcome;
          }
          const failedSec = secResult;
          if (!secResult.commitUnknown) {
            try {
              await repository.transitionOperation(
                getOpKey(currentOp),
                { kind: "abort_before_remote_write" },
                scope,
              );
            } catch {
              // ignore persistence failure
            }
          }
          return {
            kind: "failed_before_commit",
            error: failedSec.error,
            ticketId: currentOp.ticketId,
            commentId: currentOp.commentId,
          };
        }
      }

      // 4. executeRemoteWrite (Primary Remote mutation start is owned atomically by handler via transitionPrimaryRemoteWrite)
      const remoteResult = await handler.executeRemoteWrite(currentOp, prepResult.prepared, handlerCtx, depsWithRepo);
      if (!remoteResult.ok) {
        const fresh = repository.getOperation(getOpKey(currentOp), scope);
        const primaryEffect = fresh?.effects?.find(
          (e) =>
            e.effectId === "ticket-create" ||
            e.effectId === "ticket-update" ||
            e.effectId === "comment-create" ||
            e.effectId === "comment-update" ||
            isPrimaryEffectKind(e.kind),
        );
        const isPrimaryCommitted =
          (primaryEffect?.state as string) === "committed" ||
          (fresh?.kind === "ticket_update" && ((primaryEffect?.state as string) === "committed" || (fresh.phase as any) === "remote_committed"));

        if (isPrimaryCommitted || remoteResult.outcome?.kind === "remote_committed") {
          const committedId =
            primaryEffect?.remoteId ??
            fresh?.createdRemoteId ??
            (remoteResult.outcome as any)?.ticketId ??
            currentOp.ticketId ??
            0;
          await repository.transitionOperation(
            getOpKey(currentOp),
            {
              kind: "record_remote_commit",
              createdRemoteId: committedId > 0 ? committedId : undefined,
            },
            scope,
          );
          return {
            kind: "remote_committed",
            ticketId: getOutcomeTicketId(currentOp, committedId > 0 ? committedId : undefined),
            commentId: currentOp.commentId,
            pending: "remote_reconcile",
            message: remoteResult.error?.message ?? "Secondary child/attachment effects require explicit recovery",
          };
        }

        if (remoteResult.commitUnknown) {
          return {
            kind: "commit_unknown",
            operationId: currentOp.operationId,
            ticketId: currentOp.ticketId,
            commentId: currentOp.commentId,
            message: remoteResult.error.message,
            error: remoteResult.error,
          };
        }

        return {
          kind: "failed_before_commit",
          error: remoteResult.error,
          ticketId: currentOp.ticketId,
          commentId: currentOp.commentId,
        };
      }

      // 6. record_remote_commit
      let committedOp = repository.getOperation(getOpKey(currentOp), scope);
      if (!committedOp || committedOp.phase !== "remote_committed") {
        committedOp = await repository.transitionOperation(
          getOpKey(currentOp),
          {
            kind: "record_remote_commit",
            createdRemoteId: remoteResult.createdRemoteId,
            projectId: remoteResult.projectId,
            remoteUpdatedAt: remoteResult.remoteUpdatedAt,
          },
          scope,
        );
      }
      if (!committedOp) {
        return {
          kind: "remote_committed",
          ticketId: getOutcomeTicketId(currentOp, remoteResult.createdRemoteId),
          commentId: currentOp.commentId,
          pending: "remote_reconcile",
          message: "Remote committed but failed to record checkpoint",
        };
      }
      currentOp = committedOp;
    }

    // Step B: Reconciliation & Read-back
    let reconcileCanonical: any = undefined;
    if (currentOp.phase === "remote_committed" || currentOp.phase === "reconciliation_pending") {
      const hasUnresolvedChildEffects = (currentOp.effects ?? []).some(
        (e) =>
          (e.kind === "child_create" || (typeof e.effectId === "string" && e.effectId.startsWith("child-create"))) &&
          (e.state === "commit_unknown" || e.state === "compensation_unknown" || e.state === "compensation_started" || e.state === "failed"),
      );
      if (hasUnresolvedChildEffects) {
        return {
          kind: "remote_committed",
          ticketId: getOutcomeTicketId(currentOp),
          pending: "remote_reconcile",
          message: "Unresolved child effects require explicit recovery",
        };
      }

      const isRecovery = currentOp.phase === "reconciliation_pending";
      const reconcilOp = await repository.transitionOperation(
        getOpKey(currentOp),
        { kind: "mark_reconciliation_pending" },
        scope,
      );
      if (reconcilOp) {
        currentOp = reconcilOp;
      }

      const reconcileResult = await handler.reconcileRemote(currentOp, handlerCtx, depsWithRepo);
      if (!reconcileResult.ok) {
        return {
          kind: "remote_committed",
          ticketId: getOutcomeTicketId(currentOp),
          commentId: currentOp.commentId,
          pending: "remote_reconcile",
          message: reconcileResult.message,
        };
      }
      reconcileCanonical = reconcileResult.canonical;

      // 8. mark_local_finalize_pending or record_reconciled_identity
      const finalizeOp = await repository.transitionOperation(
        getOpKey(currentOp),
        reconcileResult.ok && reconcileResult.remoteId
          ? {
              kind: "record_reconciled_identity",
              remoteId: reconcileResult.remoteId,
              projectId: reconcileResult.projectId,
              remoteUpdatedAt: reconcileResult.remoteUpdatedAt,
              canonical: reconcileCanonical,
            }
          : { kind: "mark_local_finalize_pending", canonical: reconcileCanonical },
        scope,
      );
      if (!finalizeOp) {
        // INV-N10: Reconciliation→Finalize間のcheckpointが失敗したら completed を返さない
        return {
          kind: "remote_committed",
          ticketId: getOutcomeTicketId(currentOp),
          commentId: currentOp.commentId,
          pending: "remote_reconcile",
          message: "Failed to persist reconciliation checkpoint (record_reconciled_identity or mark_local_finalize_pending)",
        };
      }
      currentOp = finalizeOp;
    }

    // Step C: Local Finalize (local_finalize_pending からの再開または後続)
    if (currentOp.phase === "local_finalize_pending") {
      const canonical = reconcileCanonical ?? (currentOp as any).canonical;
      const finalizeResult = await handler.finalizeLocal(currentOp, canonical, handlerCtx, depsWithRepo);
      if (!finalizeResult.ok) {
        return {
          kind: "remote_committed",
          ticketId: getOutcomeTicketId(currentOp),
          commentId: currentOp.commentId,
          pending: "local_finalize",
          message: finalizeResult.message,
        };
      }

      // 9. complete (INV-11, INV-N07)
      const compRes = await repository.completeOperation(
        getOpKey(currentOp),
        scope,
        currentOp.intentRevision ?? currentOp.revision ?? 1,
        { canonical, remoteUpdatedAt: currentOp.remoteUpdatedAt },
        getAttemptGeneration(currentOp),
      );
      if (!compRes) {
        return {
          kind: "remote_committed",
          ticketId: getOutcomeTicketId(currentOp),
          commentId: currentOp.commentId,
          pending: "local_finalize",
          message: "Failed to complete operation persistence",
        };
      }

      return {
        kind: "completed",
        ticketId: getOutcomeTicketId(currentOp),
        commentId: currentOp.commentId,
      };
    }

    // INV-N10: どのphaseにも到達しなかった場合はsafe-sideへ倒す（completed は絶対に返さない）
    return {
      kind: "remote_committed",
      ticketId: getOutcomeTicketId(currentOp),
      commentId: currentOp.commentId,
      pending: "remote_reconcile",
      message: `Unexpected phase after sync lifecycle: ${currentOp.phase}`,
    };
  }

  public resolveCommitUnknown(input: CommitUnknownRecoveryInput): Promise<SyncOutcome> {
    return resolveCommitUnknown(input, {
      ...this.recovery,
      resolveEffect: (effectInput) => this.resolveEffect(effectInput),
      executeSyncLifecycle: (operation, context, options) => this.executeSyncLifecycle(operation, context, options),
    });
  }

  public resolveLocalFinalize(input: SyncRecoveryInput): Promise<SyncOutcome> {
    return resolveLocalFinalize(input, this.recovery);
  }

  public resolveEffect(input: SyncEffectRecoveryInput): Promise<SyncOutcome> {
    return resolveEffect(input, this.recovery);
  }

  public async syncAll(context: SyncContext, options: SyncCoordinatorOptions = {}): Promise<SyncAllCoordinatorOutcome> {
    const scope = context.connectionScope;
    const ops = this.repository.listOperations(scope);
    const plan: SyncOperationKey[] = ops.map((o) => o.key ?? { kind: "ticket", ticketId: o.ticketId ?? 0 });
    const results: Array<{ key: SyncOperationKey; outcome: SyncOutcome }> = [];
    const remaining: SyncOperationKey[] = [];
    let cancelled = false;
    let stopReason: SyncAllStopReason = "completed";

    for (let i = 0; i < plan.length; i++) {
      const key = plan[i];
      if (options.shouldContinue && !options.shouldContinue()) {
        cancelled = true;
        stopReason = "user_cancelled";
        remaining.push(...plan.slice(i));
        break;
      }
      try {
        const outcome = await this.sync(key, context, options);
        results.push({ key, outcome });
        if (outcome.kind === "completed" || outcome.kind === "no_change") {
          // terminal success: continue to next item
          continue;
        } else if (
          outcome.kind === "remote_committed" ||
          outcome.kind === "commit_unknown" ||
          outcome.kind === "conflict" ||
          outcome.kind === "queued"
        ) {
          stopReason = "blocked_by_recovery";
          remaining.push(...plan.slice(i + 1));
          break;
        } else if (outcome.kind === "failed_before_commit") {
          stopReason = "failed";
          remaining.push(...plan.slice(i + 1));
          break;
        } else {
          stopReason = "blocked_by_recovery";
          remaining.push(...plan.slice(i + 1));
          break;
        }
      } catch (err) {
        results.push({ key, outcome: { kind: "failed_before_commit", error: err as Error } });
        stopReason = "failed";
        remaining.push(...plan.slice(i + 1));
        break;
      }
    }

    return {
      plan,
      results,
      remaining,
      cancelled,
      stopReason,
    };
  }
}

export const createSyncCoordinator = (deps: SyncCoordinatorDependencies = {}): SyncCoordinator =>
  new SyncCoordinator(deps);
