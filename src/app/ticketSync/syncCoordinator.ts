import * as vscode from "vscode";
import { runWithConnectionScope } from "../../redmine/client";
import {
  CommentCreateHandler,
  CommentUpdateHandler,
  defaultCommentDeps,
  EffectResolution,
  OperationHandler,
  OperationHandlerContext,
  OperationHandlerDeps,
  TicketCreateHandler,
  TicketUpdateHandler,
} from "./operationHandlers";
import { defaultDeps as defaultTicketDeps } from "../../views/ticketSync/ticketSyncDeps";
import { getIssueDetail } from "../../redmine/issues";
import { reconcileCommentCommitUnknown } from "../../views/commentSaveSync";
import {
  createSyncOperationRepository,
  SyncOperationRepository,
  withAttemptGenerationFence,
} from "./syncRepository";
import {
  GenericSyncPhase,
  SyncOperationKey,
  SyncOutcome,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import {
  canRetryEffect,
  DurableSyncEffectState,
  getAttemptGeneration,
  getEffectsForRevision,
  getOperationRecoveryMode,
  getPrimaryEffectForRevision,
  getRecoveryItemsForOperation,
  isPrimaryEffectKind,
  isPrimaryRecoveryRequired,
  RecoveryItem,
} from "../syncEffects";
import type { SyncContext } from "./ports";

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

  public constructor(deps: SyncCoordinatorDependencies = {}) {
    this.repository = deps.repository ?? createSyncOperationRepository();
    this.handlers = {
      ticket_create: deps.handlers?.ticketCreate ?? new TicketCreateHandler(),
      ticket_update: deps.handlers?.ticketUpdate ?? new TicketUpdateHandler(),
      comment_create: deps.handlers?.commentCreate ?? new CommentCreateHandler(),
      comment_update: deps.handlers?.commentUpdate ?? new CommentUpdateHandler(),
    };
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
      const committedParentId = operation.createdRemoteId ?? primary?.remoteId ?? operation.ticketId ?? 0;
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
        error: new Error(primary.failure?.detail ?? "Primary remote mutation has previously failed. Explicit recovery required."),
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
    const flightPromise = runner(scope, async () => {
      try {
        return await this.executeSyncLifecycle(operation, context, options);
      } finally {
        this.inFlight.delete(flightKey);
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
      return { kind: "no_change", ticketId: currentOp.ticketId ?? 0 };
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
        if (currentOp.phase === "preparing") {
          await repository.transitionOperation(
            getOpKey(currentOp),
            { kind: "abort_before_remote_write" },
            scope,
          );
        }
        return prepResult.outcome;
      }

      // 3. Secondary Effects (attachment upload 等)
      if (handler.executeSecondaryEffects && (currentOp.phase === "queued" || currentOp.phase === "preparing")) {
        const secResult = await handler.executeSecondaryEffects(currentOp, prepResult.prepared, handlerCtx, depsWithRepo);
        if (!secResult.ok) {
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
            ticketId: committedId > 0 ? committedId : (currentOp.ticketId ?? 0),
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
          ticketId: remoteResult.createdRemoteId ?? currentOp.ticketId ?? 0,
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
          ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
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
          ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
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
          ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
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
          ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
          commentId: currentOp.commentId,
          pending: "local_finalize",
          message: finalizeResult.message,
        };
      }

      // 9. complete (INV-11, INV-N07)
      const compRes = await repository.completeOperation(
        getOpKey(currentOp),
        scope,
        undefined,
        { canonical, remoteUpdatedAt: currentOp.remoteUpdatedAt },
      );
      if (!compRes) {
        return {
          kind: "remote_committed",
          ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
          commentId: currentOp.commentId,
          pending: "local_finalize",
          message: "Failed to complete operation persistence",
        };
      }

      return {
        kind: "completed",
        ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
        commentId: currentOp.commentId,
      };
    }

    // INV-N10: どのphaseにも到達しなかった場合はsafe-sideへ倒す（completed は絶対に返さない）
    return {
      kind: "remote_committed",
      ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
      commentId: currentOp.commentId,
      pending: "remote_reconcile",
      message: `Unexpected phase after sync lifecycle: ${currentOp.phase}`,
    };
  }

  public async resolveCommitUnknown(input: {
    key: SyncOperationKey;
    context: SyncContext;
    attemptGeneration?: number;
    resolution?:
      | { kind: "reconcile_remote" }
      | { kind: "link_remote_comment"; commentId: number; explicitLink?: boolean }
      | { kind: "link_remote_ticket"; ticketId: number; explicitLink?: boolean }
      | { kind: "link_created_ticket"; ticketId: number; explicitLink?: boolean }
      | { kind: "assume_update_committed" }
      | { kind: "retry_remote_write" }
      | { kind: "reconcile_compensation" };
    deps?: OperationHandlerDeps;
  }): Promise<SyncOutcome> {
    const scope = input.context.connectionScope;
    const op = this.repository.getOperation(input.key, scope);
    const currentRevision = op?.intentRevision ?? op?.revision ?? 1;
    const currentAttemptGeneration = getAttemptGeneration(op);
    if (
      op &&
      input.attemptGeneration !== undefined &&
      currentAttemptGeneration !== getAttemptGeneration({ attemptGeneration: input.attemptGeneration })
    ) {
      return {
        kind: "failed_before_commit",
        error: new Error(`Operation attempt generation mismatch: expected ${currentAttemptGeneration}, got ${input.attemptGeneration}`),
      };
    }
    const primaryEffect = op ? getPrimaryEffectForRevision(op, currentRevision) : undefined;
    const isRecoverable = op && isPrimaryRecoveryRequired(op, primaryEffect);
    if (!op || !isRecoverable) {
      return {
        kind: "commit_unknown",
        operationId: op?.operationId ?? "",
        ticketId: op?.ticketId,
        commentId: op?.commentId,
        message: op?.errorMessage ?? "Operation is not in commit_unknown or failed state",
      };
    }

    const resKind = input.resolution?.kind ?? "reconcile";
    const flightKey = `${scope}:resolve:${op.operationId}:${currentRevision}:${currentAttemptGeneration}:${resKind}`;
    const activeFlight = this.inFlight.get(flightKey);
    if (activeFlight) {
      return activeFlight;
    }

    const runner = (input as any).runInConnectionScope ?? runWithConnectionScope;
    const flightPromise = runner(scope, async (): Promise<SyncOutcome> => {
      const freshOp = this.repository.getOperation(input.key, scope);
      const freshRevision = freshOp?.intentRevision ?? freshOp?.revision ?? 1;
      const freshAttemptGeneration = getAttemptGeneration(freshOp);
      const freshPrimaryEffect = freshOp ? getPrimaryEffectForRevision(freshOp, freshRevision) : undefined;
      const isFreshRecoverable = freshOp && isPrimaryRecoveryRequired(freshOp, freshPrimaryEffect);
      if (!freshOp || !isFreshRecoverable) {
        return {
          kind: "commit_unknown",
          operationId: freshOp?.operationId ?? op.operationId,
          ticketId: freshOp?.ticketId ?? op.ticketId,
          commentId: freshOp?.commentId ?? op.commentId,
          message: freshOp?.errorMessage ?? "Operation is no longer in recoverable state",
        };
      }

      if (
        freshAttemptGeneration !== currentAttemptGeneration ||
        (input.attemptGeneration !== undefined &&
          freshAttemptGeneration !== getAttemptGeneration({ attemptGeneration: input.attemptGeneration }))
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
        return this.resolveEffect({
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

      const handler = this.handlers[freshOp.kind];
      const handlerCtx: OperationHandlerContext = { connectionScope: scope };
      const repository = withAttemptGenerationFence(this.repository, freshAttemptGeneration);
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

      if (input.resolution?.kind === "retry_remote_write") {
        // INV-N03, INV-N04: 未解決の Prerequisite Effect (attachment, image) があれば Primary retry を拒絶
        const activeEffects = getEffectsForRevision(freshOp, freshRevision);
        const hasUnresolvedPrereq = activeEffects.some(
          (e) =>
            (e.kind === "attachment_upload" || e.kind === "image_upload" || (typeof e.effectId === "string" && (e.effectId.startsWith("attachment") || e.effectId.startsWith("image")))) &&
            (e.state === "started" || e.state === "commit_unknown" || e.state === "compensation_started" || e.state === "compensation_unknown" || e.state === "planned"),
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

        // Primary が既に committed なら Primary remote write は再実行しない
        const primaryEffect = getPrimaryEffectForRevision(freshOp, freshRevision);
        // INV-N12: compensated は committed として誤判定しない
        // primaryEffect.state が "committed" の場合、"compensated" には同時になれないため、
        // legacy fallback (effects未記録) のみ createdRemoteId を使う
        const isPrimaryCommitted =
          primaryEffect?.state === "committed" ||
          (primaryEffect === undefined && freshOp.createdRemoteId !== undefined && freshOp.createdRemoteId > 0);
        if (isPrimaryCommitted) {
          return {
            kind: "remote_committed",
            ticketId: freshOp.createdRemoteId ?? freshOp.ticketId ?? 0,
            commentId: freshOp.commentId,
            pending: "remote_reconcile",
            message: "Primary mutation is already committed. Use effect-specific recovery for remaining secondary effects.",
          };
        }

        // D-04 / R-04: Legacy uncertain + identity不足、または non_retriable failure、または missing disposition は retry 拒絶
        if (primaryEffect && !canRetryEffect(primaryEffect)) {
          return {
            kind: "failed_before_commit",
            ticketId: freshOp.ticketId,
            commentId: freshOp.commentId,
            error: new Error(primaryEffect.failure?.detail ?? "Cannot retry mutation without verifiable request identity or retryable disposition."),
          };
        }

        const prepResult = await handler.prepare(freshOp, handlerCtx, depsWithRepo);
        if (!prepResult.ok) {
          return {
            kind: "commit_unknown",
            operationId: freshOp.operationId,
            ticketId: freshOp.ticketId,
            commentId: freshOp.commentId,
            message: "Preflight preparation failed",
          };
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

        const reconciled = await handler.reconcileRemote(committedOp, handlerCtx, depsWithRepo);
        if (!reconciled.ok) {
          return {
            kind: "remote_committed",
            ticketId: committedOp.createdRemoteId ?? committedOp.ticketId ?? 0,
            pending: "remote_reconcile",
            message: reconciled.message,
          };
        }

        const fin = await handler.finalizeLocal(committedOp, reconciled.canonical, handlerCtx, depsWithRepo);
        if (fin.ok) {
          const compOp = await repository.completeOperation(input.key, scope, undefined, { canonical: reconciled.canonical, remoteUpdatedAt: committedOp.remoteUpdatedAt });
          if (compOp) {
            return {
              kind: "completed",
              ticketId: committedOp.createdRemoteId ?? committedOp.ticketId ?? 0,
              commentId: committedOp.commentId,
            };
          }
          return {
            kind: "remote_committed",
            ticketId: committedOp.createdRemoteId ?? committedOp.ticketId ?? 0,
            pending: "local_finalize",
            message: "Failed to persist complete state",
          };
        }
        return {
          kind: "remote_committed",
          ticketId: committedOp.createdRemoteId ?? 0,
          pending: "local_finalize",
          message: fin.message,
        };
      }

      if (input.resolution?.kind === "link_remote_ticket" || input.resolution?.kind === "link_remote_comment") {
        const isComment = input.resolution.kind === "link_remote_comment";
        const remoteId = input.resolution.kind === "link_remote_comment" ? input.resolution.commentId : input.resolution.ticketId;

        let detail: any = undefined;
        if (isComment) {
          const commentDeps = { ...defaultCommentDeps, ...input.deps?.comment };
          const verified = await reconcileCommentCommitUnknown(
            {
              ticketId: freshOp.ticketId ?? (freshOp.intent as any)?.ticketId ?? 0,
              commentId: freshOp.commentId,
              body: (freshOp.intent as any)?.body ?? "",
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

        const transitioned = await repository.transitionOperation(
          input.key,
          { kind: "record_reconciled_identity", remoteId },
          scope,
          { operationId: freshOp.operationId, sourcePhase: "commit_unknown", revision: freshOp.intentRevision ?? freshOp.revision },
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
          const compOp = await repository.completeOperation(input.key, scope, undefined, { canonical: detail, remoteUpdatedAt: transitioned.remoteUpdatedAt });
          if (compOp) {
            return {
              kind: "completed",
              ticketId: transitioned.createdRemoteId ?? transitioned.ticketId ?? 0,
              commentId: isComment ? remoteId : undefined,
            };
          }
          return { kind: "remote_committed", ticketId: transitioned.createdRemoteId ?? 0, commentId: isComment ? remoteId : undefined, pending: "local_finalize", message: "Failed to persist complete state" };
        }
        return { kind: "remote_committed", ticketId: transitioned.createdRemoteId ?? 0, commentId: isComment ? remoteId : undefined, pending: "local_finalize", message: fin.message };
      }

      if ((input.resolution as any)?.kind === "assume_remote_commit" || (input.resolution as any)?.kind === "assume_update_committed") {
        const assumed = await repository.transitionOperation(
          input.key,
          { kind: "assume_remote_commit" },
          scope,
          { operationId: freshOp.operationId, sourcePhase: "commit_unknown", revision: freshOp.intentRevision ?? freshOp.revision },
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
        const fin = await handler.finalizeLocal(assumed, reconciled.ok ? reconciled.canonical : undefined, handlerCtx, depsWithRepo);
        if (fin.ok) {
          const compOp = await repository.completeOperation(input.key, scope, undefined, { canonical: reconciled.ok ? reconciled.canonical : undefined, remoteUpdatedAt: assumed.remoteUpdatedAt });
          if (compOp) {
            return {
              kind: "completed",
              ticketId: assumed.createdRemoteId ?? assumed.ticketId ?? 0,
              commentId: assumed.commentId,
            };
          }
          return {
            kind: "remote_committed",
            ticketId: assumed.createdRemoteId ?? assumed.ticketId ?? 0,
            pending: "local_finalize",
            message: "Failed to persist complete state",
          };
        }
        return {
          kind: "remote_committed",
          ticketId: assumed.createdRemoteId ?? assumed.ticketId ?? 0,
          pending: "local_finalize",
          message: fin.message,
        };
      }

      // reconcile_remote
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
          const compOp = await repository.completeOperation(input.key, scope, undefined, { canonical: reconciled.canonical, remoteUpdatedAt: transitioned.remoteUpdatedAt });
          if (compOp) {
            return {
              kind: "completed",
              ticketId: transitioned.createdRemoteId ?? transitioned.ticketId ?? 0,
              commentId: transitioned.createdRemoteId ?? transitioned.commentId,
            };
          }
          return {
            kind: "remote_committed",
            ticketId: transitioned.createdRemoteId ?? 0,
            commentId: transitioned.createdRemoteId ?? transitioned.commentId,
            pending: "local_finalize",
            message: "Failed to persist complete state",
          };
        }
        return {
          kind: "remote_committed",
          ticketId: transitioned.createdRemoteId ?? 0,
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

    this.inFlight.set(flightKey, flightPromise);
    try {
      return await flightPromise;
    } finally {
      this.inFlight.delete(flightKey);
    }
  }

  /**
   * INV-N13: Secondary Effect recovery — effectId単位でPrimary mutationとは独立してrecoveryを実行する。
   *
   * resolution:
   *   retry_effect      — commit_unknown/failed なEffectを再試行（attachmentはupload再実行、childはcreateIssue再実行）
   *   assume_committed  — EffectをcommittedとみなしてremoteId/tokenをセット
   *   link_remote_child — 子チケットのRemote IDを指定して検証付きでlink
   *   mark_failed       — Effectをfailedとしてマーク
   */
  public async resolveEffect(input: {
    key: SyncOperationKey;
    operationId: string;
    operationRevision: number;
    attemptGeneration?: number;
    effectId: string;
    expectedEffectState: DurableSyncEffectState;
    context: SyncContext;
    resolution: EffectResolution;
    deps?: OperationHandlerDeps;
  }): Promise<SyncOutcome> {
    const scope = input.context.connectionScope;
    const op = this.repository.getOperation(input.key, scope);
    if (!op) {
      return {
        kind: "failed_before_commit",
        error: new Error(`Operation not found for effect resolution: key=${JSON.stringify(input.key)}, effectId=${input.effectId}`),
      };
    }

    // 1. ConnectionScope fence
    if (op.connectionScope && op.connectionScope !== scope) {
      return {
        kind: "failed_before_commit",
        error: new Error(`Connection scope mismatch: expected "${op.connectionScope}", got "${scope}"`),
      };
    }

    // 2. OperationId fence
    if (op.operationId !== input.operationId) {
      return {
        kind: "failed_before_commit",
        error: new Error(`Operation ID mismatch: expected "${op.operationId}", got "${input.operationId}"`),
      };
    }

    // 3. Revision fence
    const currentRevision = op.intentRevision ?? op.revision ?? 1;
    if (currentRevision !== input.operationRevision) {
      return {
        kind: "failed_before_commit",
        error: new Error(`Operation revision mismatch: expected ${currentRevision}, got ${input.operationRevision}`),
      };
    }

    const currentAttemptGeneration = getAttemptGeneration(op);
    if (
      input.attemptGeneration !== undefined &&
      currentAttemptGeneration !== getAttemptGeneration({ attemptGeneration: input.attemptGeneration })
    ) {
      return {
        kind: "failed_before_commit",
        error: new Error(`Operation attempt generation mismatch: expected ${currentAttemptGeneration}, got ${input.attemptGeneration}`),
      };
    }

    // 4. Effect existence & state fence
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

    // 5. Primary generic recovery rejection (D-04, 13, R22)
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

    // 6. Operation Recovery Safety Gate (R-01, R-03, DR-01)
    const opRecoveryMode = getOperationRecoveryMode(op);
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

    // 7. Single-flight concurrency control (R23)
    const flightKey = `${scope}:resolveEffect:${op.operationId}:${input.operationRevision}:${currentAttemptGeneration}:${input.effectId}`;
    if (this.inFlight.has(flightKey)) {
      return this.inFlight.get(flightKey)!;
    }

    const flightPromise: Promise<SyncOutcome> = (async (): Promise<SyncOutcome> => {
      const handler = this.handlers[op.kind];
      const handlerCtx: OperationHandlerContext = { connectionScope: scope };
      const repository = withAttemptGenerationFence(this.repository, currentAttemptGeneration);
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
    })();

    this.inFlight.set(flightKey, flightPromise);
    try {
      return await flightPromise;
    } finally {
      this.inFlight.delete(flightKey);
    }
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
