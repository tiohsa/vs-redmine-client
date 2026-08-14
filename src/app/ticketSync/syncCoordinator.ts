import * as vscode from "vscode";
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
} from "./syncRepository";
import {
  GenericSyncPhase,
  SyncOperationKey,
  SyncOutcome,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import type { SyncContext } from "./ports";

export interface SyncCoordinatorOptions {
  deps?: OperationHandlerDeps;
  applyContent?: (editor: vscode.TextEditor, content: string) => Promise<void>;
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

  public async sync(
    key: SyncOperationKey,
    context: SyncContext,
    options: SyncCoordinatorOptions = {},
  ): Promise<SyncOutcome> {
    const scope = context.connectionScope;
    const operation = this.repository.getOperation(key, scope);
    if (!operation) {
      return { kind: "no_change", ticketId: key.kind === "ticket" ? key.ticketId : 0 };
    }

    // INV-05: ConnectionScope 検証
    if (operation.connectionScope && operation.connectionScope !== scope) {
      const error = new Error(`Connection scope mismatch: expected ${operation.connectionScope}, got ${scope}`);
      return { kind: "failed_before_commit", error };
    }

    // INV-04: commit_unknown は通常の sync() から自動再送できない
    if (operation.phase === "commit_unknown") {
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

    const flightPromise = runWithConnectionScope(scope, async () => {
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

    // 1. begin_preparation
    let currentOp = await this.repository.transitionOperation(
      initialOp.key ?? { kind: "ticket", ticketId: initialOp.ticketId ?? 0 },
      { kind: "begin_preparation" },
      scope,
    );
    if (!currentOp) {
      currentOp = initialOp;
    }

    // 2. handler.prepare
    const prepResult = await handler.prepare(currentOp, handlerCtx, options.deps);
    if (!prepResult.ok) {
      await this.repository.transitionOperation(
        currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
        { kind: "abort_before_remote_write" },
        scope,
      );
      return prepResult.outcome;
    }

    // 3. Secondary Effects (attachment upload 等)
    if (handler.executeSecondaryEffects) {
      const secResult = await handler.executeSecondaryEffects(currentOp, prepResult.prepared, handlerCtx, options.deps);
      if (!secResult.ok) {
        if (secResult.commitUnknown) {
          await this.repository.transitionOperation(
            currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
            { kind: "mark_commit_unknown", message: secResult.error.message },
            scope,
          );
          return {
            kind: "commit_unknown",
            operationId: currentOp.operationId,
            ticketId: currentOp.ticketId,
            commentId: currentOp.commentId,
            message: secResult.error.message,
          };
        }
        await this.repository.transitionOperation(
          currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
          { kind: "abort_before_remote_write" },
          scope,
        );
        return {
          kind: "failed_before_commit",
          error: secResult.error,
          ticketId: currentOp.ticketId,
          commentId: currentOp.commentId,
        };
      }
    }

    // 4. start_normal_remote_write (INV-01: durable checkpoint before mutation)
    currentOp = await this.repository.transitionOperation(
      currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
      { kind: "start_normal_remote_write" },
      scope,
    );
    if (!currentOp) {
      return { kind: "failed_before_commit", error: new Error("Failed to transition to remote_write_started") };
    }

    // 5. executeRemoteWrite
    const remoteResult = await handler.executeRemoteWrite(currentOp, prepResult.prepared, handlerCtx, options.deps);
    if (!remoteResult.ok) {
      if (remoteResult.commitUnknown) {
        await this.repository.transitionOperation(
          currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
          { kind: "mark_commit_unknown", message: remoteResult.error.message },
          scope,
        );
        return {
          kind: "commit_unknown",
          operationId: currentOp.operationId,
          ticketId: currentOp.ticketId,
          commentId: currentOp.commentId,
          message: remoteResult.error.message,
        };
      }
      await this.repository.transitionOperation(
        currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
        { kind: "abort_known_remote_failure" },
        scope,
      );
      return remoteResult.outcome ?? {
        kind: "failed_before_commit",
        error: remoteResult.error,
        ticketId: currentOp.ticketId,
        commentId: currentOp.commentId,
      };
    }

    // 6. record_remote_commit
    const committedOp = await this.repository.transitionOperation(
      currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
      {
        kind: "record_remote_commit",
        createdRemoteId: remoteResult.createdRemoteId,
        projectId: remoteResult.projectId,
        remoteUpdatedAt: remoteResult.remoteUpdatedAt,
      },
      scope,
    );
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

    // 7. mark_reconciliation_pending & reconcileRemote
    const reconcilOp = await this.repository.transitionOperation(
      currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
      { kind: "mark_reconciliation_pending" },
      scope,
    );
    if (reconcilOp) {
      currentOp = reconcilOp;
    }
    const reconcileResult = await handler.reconcileRemote(currentOp, handlerCtx, options.deps);
    if (!reconcileResult.ok) {
      return {
        kind: "remote_committed",
        ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
        commentId: currentOp.commentId,
        pending: "remote_reconcile",
        message: reconcileResult.message,
      };
    }

    // 8. mark_local_finalize_pending & finalizeLocal
    const finalizeOp = await this.repository.transitionOperation(
      currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
      { kind: "mark_local_finalize_pending" },
      scope,
    );
    if (finalizeOp) {
      currentOp = finalizeOp;
    }
    const finalizeResult = await handler.finalizeLocal(currentOp, reconcileResult.canonical, handlerCtx, options.deps);
    if (!finalizeResult.ok) {
      return {
        kind: "remote_committed",
        ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
        commentId: currentOp.commentId,
        pending: "local_finalize",
        message: finalizeResult.message,
      };
    }

    // 9. complete (INV-11)
    await this.repository.transitionOperation(
      currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
      { kind: "complete" },
      scope,
    );
    await this.repository.completeOperation(
      currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
      scope,
    );

    return {
      kind: "completed",
      ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
      commentId: currentOp.commentId,
    };
  }

  public async resolveCommitUnknown(input: {
    key: SyncOperationKey;
    context: SyncContext;
    resolution?: { kind: "reconcile_remote" } | { kind: "link_remote_comment"; commentId: number } | { kind: "link_remote_ticket"; ticketId: number };
  }): Promise<SyncOutcome> {
    const scope = input.context.connectionScope;
    const op = this.repository.getOperation(input.key, scope);
    if (!op || op.phase !== "commit_unknown") {
      return { kind: "no_change", ticketId: op?.ticketId ?? 0 };
    }

    const handler = this.handlers[op.kind];
    const handlerCtx: OperationHandlerContext = { connectionScope: scope };

    if (input.resolution?.kind === "link_remote_ticket" || input.resolution?.kind === "link_remote_comment") {
      const remoteId = input.resolution.kind === "link_remote_ticket" ? input.resolution.ticketId : input.resolution.commentId;
      const transitioned = await this.repository.transitionOperation(
        input.key,
        { kind: "record_reconciled_identity", remoteId },
        scope,
      );
      if (!transitioned) {
        return { kind: "failed_before_commit", error: new Error("Failed to record reconciled identity") };
      }
      const fin = await handler.finalizeLocal(transitioned, undefined, handlerCtx);
      if (fin.ok) {
        await this.repository.transitionOperation(input.key, { kind: "complete" }, scope);
        await this.repository.completeOperation(input.key, scope);
        return { kind: "completed", ticketId: transitioned.createdRemoteId ?? transitioned.ticketId ?? 0 };
      }
      return { kind: "remote_committed", ticketId: transitioned.createdRemoteId ?? 0, pending: "local_finalize", message: fin.message };
    }

    // reconcile_remote
    const reconciled = await handler.reconcileRemote(op, handlerCtx);
    if (reconciled.ok && reconciled.remoteId) {
      const transitioned = await this.repository.transitionOperation(
        input.key,
        { kind: "record_reconciled_identity", remoteId: reconciled.remoteId, projectId: reconciled.projectId, remoteUpdatedAt: reconciled.remoteUpdatedAt },
        scope,
      );
      if (!transitioned) {
        return { kind: "failed_before_commit", error: new Error("Failed to record reconciled identity") };
      }
      const fin = await handler.finalizeLocal(transitioned, reconciled.canonical, handlerCtx);
      if (fin.ok) {
        await this.repository.transitionOperation(input.key, { kind: "complete" }, scope);
        await this.repository.completeOperation(input.key, scope);
        return { kind: "completed", ticketId: transitioned.createdRemoteId ?? transitioned.ticketId ?? 0 };
      }
      return { kind: "remote_committed", ticketId: transitioned.createdRemoteId ?? 0, pending: "local_finalize", message: fin.message };
    }

    return {
      kind: "commit_unknown",
      operationId: op.operationId,
      ticketId: op.ticketId,
      commentId: op.commentId,
      message: reconciled.ok ? "Reconciliation failed" : reconciled.message,
    };
  }

  public async syncAll(context: SyncContext, options: SyncCoordinatorOptions = {}): Promise<SyncAllCoordinatorOutcome> {
    const scope = context.connectionScope;
    const ops = this.repository.listOperations(scope);
    const plan: SyncOperationKey[] = ops.map((o) => o.key ?? { kind: "ticket", ticketId: o.ticketId ?? 0 });
    const results: Array<{ key: SyncOperationKey; outcome: SyncOutcome }> = [];
    const remaining: SyncOperationKey[] = [];
    let cancelled = false;

    for (const key of plan) {
      if (cancelled) {
        remaining.push(key);
        continue;
      }
      try {
        const outcome = await this.sync(key, context, options);
        results.push({ key, outcome });
        if (outcome.kind === "commit_unknown" || outcome.kind === "failed_before_commit") {
          // エラーまたは未知時は後続の処理をキャンセル
          cancelled = true;
        }
      } catch (err) {
        results.push({ key, outcome: { kind: "failed_before_commit", error: err as Error } });
        cancelled = true;
      }
    }

    return {
      plan,
      results,
      remaining,
      cancelled,
    };
  }
}

export const createSyncCoordinator = (deps: SyncCoordinatorDependencies = {}): SyncCoordinator =>
  new SyncCoordinator(deps);
