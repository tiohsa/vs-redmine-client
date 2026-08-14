import * as vscode from "vscode";
import { runWithConnectionScope } from "../../redmine/client";
import {
  CommentCreateHandler,
  CommentUpdateHandler,
  defaultCommentDeps,
  OperationHandler,
  OperationHandlerContext,
  OperationHandlerDeps,
  TicketCreateHandler,
  TicketUpdateHandler,
} from "./operationHandlers";
import { reconcileCommentCommitUnknown } from "../../views/commentSaveSync";
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
    let currentOp = initialOp;

    // 0. Phase チェック
    if (currentOp.phase === "completed") {
      return { kind: "no_change", ticketId: currentOp.ticketId ?? 0 };
    }

    if (currentOp.phase === "commit_unknown" || currentOp.phase === "remote_write_started") {
      const allEffects: any[] = currentOp.effects ?? (currentOp.payload as any)?.effects ?? [];
      const primary = allEffects.find((e) => e.kind === "ticket_create" || e.kind === "ticket_update" || (typeof e.effectId === "string" && e.effectId.startsWith("ticket-")));
      const hasUnresolvedChild = allEffects.some((e) =>
        (e.kind === "child_create" || e.kind === "child-create" || (typeof e.effectId === "string" && e.effectId.startsWith("child-create"))) &&
        (e.state === "committed" || e.state === "commit_unknown" || e.state === "compensation_unknown" || e.state === "compensation_started")
      );
      const isParentCommitted = currentOp.kind === "ticket_update"
        ? primary?.state !== "commit_unknown"
        : (primary?.state === "committed" || currentOp.createdRemoteId !== undefined);

      if (hasUnresolvedChild && isParentCommitted) {
        return {
          kind: "remote_committed",
          ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
          pending: "remote_reconcile",
          message: currentOp.errorMessage ?? "Unresolved child effects require explicit recovery",
        };
      }
      return {
        kind: "commit_unknown",
        operationId: currentOp.operationId,
        ticketId: currentOp.ticketId,
        commentId: currentOp.commentId,
        message: currentOp.errorMessage ?? vscode.l10n.t("A previous remote write outcome is unknown. Please resolve or reconcile before retrying."),
      };
    }

    // Step A: Preparation & Remote Write (queued / preparing の場合のみ)
    let prepResult: any = undefined;
    if (currentOp.phase === "queued" || currentOp.phase === "preparing") {
      // 1. begin_preparation (queued の場合のみ)
      if (currentOp.phase === "queued") {
        const prepOp = await this.repository.transitionOperation(
          currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
          { kind: "begin_preparation" },
          scope,
        );
        if (!prepOp) {
          return { kind: "failed_before_commit", error: new Error("Failed to transition to preparing") };
        }
        currentOp = prepOp;
      }

      // 2. handler.prepare
      prepResult = await handler.prepare(currentOp, handlerCtx, options.deps);
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
          const freshOp = this.repository.getOperation(currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 }, scope);
          const hasCommittedOrUnknownEffects = (freshOp?.effects ?? []).some(
            (e) => e.state === "committed" || e.state === "commit_unknown" || e.state === "compensation_unknown" || e.state === "compensation_started",
          );
          if (hasCommittedOrUnknownEffects) {
            await this.repository.transitionOperation(
              currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
              { kind: "record_remote_commit" },
              scope,
            );
            return {
              kind: "remote_committed",
              ticketId: currentOp.ticketId ?? 0,
              pending: "remote_reconcile",
              message: secResult.error.message,
            };
          }
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
      const writeStartOp = await this.repository.transitionOperation(
        currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
        { kind: "start_normal_remote_write" },
        scope,
      );
      if (!writeStartOp) {
        return { kind: "failed_before_commit", error: new Error("Failed to transition to remote_write_started") };
      }
      currentOp = writeStartOp;

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

        const latestOp = this.repository.getOperation(currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 }, scope) ?? currentOp;
        const hasUnresolvedChild = (latestOp.effects ?? []).some((e) =>
          e.kind === "child_create" && (e.state === "committed" || e.state === "commit_unknown" || e.state === "compensation_unknown" || e.state === "compensation_started")
        );
        if (hasUnresolvedChild) {
          await this.repository.transitionOperation(
            currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
            { kind: "record_remote_commit" },
            scope,
          );
          return {
            kind: "remote_committed",
            ticketId: latestOp.createdRemoteId ?? latestOp.ticketId ?? 0,
            pending: "remote_reconcile",
            message: remoteResult.error?.message,
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
    }

    // Step B: Reconciliation (remote_committed / reconciliation_pending からの再開または後続)
    let reconcileCanonical: any = undefined;
    if (currentOp.phase === "remote_committed" || currentOp.phase === "reconciliation_pending") {
      const hasUnresolvedChildEffects = (currentOp.effects ?? []).some((e) =>
        e.kind === "child_create" && (
          e.state === "commit_unknown" ||
          e.state === "compensation_unknown" ||
          e.state === "compensation_started" ||
          e.state === "failed" ||
          (e.state === "committed" && (currentOp.effects ?? []).some((other) => other.kind === "child_create" && other.state !== "committed" && other.state !== "compensated"))
        )
      );
      if (hasUnresolvedChildEffects) {
        return {
          kind: "remote_committed",
          ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
          pending: "remote_reconcile",
          message: "Unresolved child effects require explicit recovery",
        };
      }

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
      reconcileCanonical = reconcileResult.canonical;

      // 8. mark_local_finalize_pending or record_reconciled_identity
      const finalizeOp = await this.repository.transitionOperation(
        currentOp.key ?? { kind: "ticket", ticketId: currentOp.ticketId ?? 0 },
        reconcileResult.remoteId
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
      if (finalizeOp) {
        currentOp = finalizeOp;
      }
    }

    // Step C: Local Finalize (local_finalize_pending からの再開または後続)
    if (currentOp.phase === "local_finalize_pending") {
      const finalizeResult = await handler.finalizeLocal(currentOp, reconcileCanonical, handlerCtx, options.deps);
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
        undefined,
        { canonical: reconcileCanonical, remoteUpdatedAt: currentOp.remoteUpdatedAt },
      );

      return {
        kind: "completed",
        ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
        commentId: currentOp.commentId,
      };
    }

    return {
      kind: "completed",
      ticketId: currentOp.createdRemoteId ?? currentOp.ticketId ?? 0,
      commentId: currentOp.commentId,
    };
  }

  public async resolveCommitUnknown(input: {
    key: SyncOperationKey;
    context: SyncContext;
    resolution?: { kind: "reconcile_remote" } | { kind: "link_remote_comment"; commentId: number } | { kind: "link_remote_ticket"; ticketId: number } | { kind: "retry_remote_write" };
    deps?: OperationHandlerDeps;
  }): Promise<SyncOutcome> {
    const scope = input.context.connectionScope;
    const op = this.repository.getOperation(input.key, scope);
    if (!op || op.phase !== "commit_unknown") {
      return {
        kind: "commit_unknown",
        operationId: op?.operationId ?? "",
        ticketId: op?.ticketId,
        commentId: op?.commentId,
        message: op?.errorMessage ?? "Operation is not in commit_unknown phase",
      };
    }

    const resKind = input.resolution?.kind ?? "reconcile";
    const flightKey = `${scope}:resolve:${op.operationId}:${resKind}`;
    const activeFlight = this.inFlight.get(flightKey);
    if (activeFlight) {
      return activeFlight;
    }

    const flightPromise = (async (): Promise<SyncOutcome> => {
      const handler = this.handlers[op.kind];
      const handlerCtx: OperationHandlerContext = { connectionScope: scope };

      if (input.resolution?.kind === "retry_remote_write") {
        const prepResult = await handler.prepare(op, handlerCtx, input.deps);
        if (!prepResult.ok) {
          return {
            kind: "commit_unknown",
            operationId: op.operationId,
            ticketId: op.ticketId,
            commentId: op.commentId,
            message: "Preflight preparation failed",
          };
        }

        const writeStartOp = await this.repository.transitionOperation(
          input.key,
          { kind: "start_explicit_retry_remote_write" },
          scope,
          { operationId: op.operationId, sourcePhase: op.phase, revision: op.intentRevision ?? op.revision },
        );
        if (!writeStartOp) {
          return {
            kind: "commit_unknown",
            operationId: op.operationId,
            ticketId: op.ticketId,
            commentId: op.commentId,
            message: "Failed to transition to remote_write_started",
          };
        }

        const remoteResult = await handler.executeRemoteWrite(op, prepResult.prepared, handlerCtx, input.deps);
        if (!remoteResult.ok) {
          await this.repository.transitionOperation(
            input.key,
            { kind: "mark_commit_unknown", message: remoteResult.error.message },
            scope,
          );
          return {
            kind: "commit_unknown",
            operationId: op.operationId,
            ticketId: op.ticketId,
            commentId: op.commentId,
            message: remoteResult.error.message,
          };
        }

        const committedOp = await this.repository.transitionOperation(
          input.key,
          {
            kind: "record_remote_commit",
            createdRemoteId: remoteResult.createdRemoteId,
            projectId: remoteResult.projectId,
            remoteUpdatedAt: remoteResult.remoteUpdatedAt,
          },
          scope,
          { operationId: op.operationId, sourcePhase: "remote_write_started", revision: writeStartOp.intentRevision ?? writeStartOp.revision },
        );
        if (!committedOp) {
          return {
            kind: "remote_committed",
            ticketId: remoteResult.createdRemoteId ?? op.ticketId ?? 0,
            pending: "remote_reconcile",
          };
        }

        const reconciled = await handler.reconcileRemote(committedOp, handlerCtx, input.deps);
        if (!reconciled.ok) {
          return {
            kind: "remote_committed",
            ticketId: committedOp.createdRemoteId ?? committedOp.ticketId ?? 0,
            pending: "remote_reconcile",
            message: reconciled.message,
          };
        }

        const fin = await handler.finalizeLocal(committedOp, reconciled.canonical, handlerCtx, input.deps);
        if (fin.ok) {
          await this.repository.transitionOperation(input.key, { kind: "complete" }, scope);
          await this.repository.completeOperation(input.key, scope, undefined, { canonical: reconciled.canonical, remoteUpdatedAt: committedOp.remoteUpdatedAt });
          return {
            kind: "completed",
            ticketId: committedOp.createdRemoteId ?? committedOp.ticketId ?? 0,
            commentId: committedOp.commentId,
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

        if (isComment) {
          const commentDeps = { ...defaultCommentDeps, ...input.deps?.comment };
          const verified = await reconcileCommentCommitUnknown(
            {
              ticketId: op.ticketId ?? (op.intent as any)?.ticketId ?? 0,
              commentId: op.commentId,
              body: (op.intent as any)?.body ?? "",
              documentUri: op.documentUri,
              operationId: op.operationId,
              phase: op.phase as any,
              revision: op.revision,
            },
            commentDeps,
            remoteId,
          );
          if (!verified.ok) {
            return {
              kind: "commit_unknown",
              operationId: op.operationId,
              ticketId: op.ticketId,
              commentId: op.commentId,
              message: verified.message,
            };
          }
        }

        const transitioned = await this.repository.transitionOperation(
          input.key,
          { kind: "record_reconciled_identity", remoteId },
          scope,
          { operationId: op.operationId, sourcePhase: op.phase, revision: op.intentRevision ?? op.revision },
        );
        if (!transitioned) {
          return {
            kind: "commit_unknown",
            operationId: op.operationId,
            ticketId: op.ticketId,
            commentId: op.commentId,
            message: "Failed to record reconciled identity due to conflict",
          };
        }
        const fin = await handler.finalizeLocal(transitioned, undefined, handlerCtx, input.deps);
        if (fin.ok) {
          await this.repository.transitionOperation(input.key, { kind: "complete" }, scope);
          await this.repository.completeOperation(input.key, scope);
          return {
            kind: "completed",
            ticketId: transitioned.createdRemoteId ?? transitioned.ticketId ?? 0,
            commentId: isComment ? remoteId : undefined,
          };
        }
        return { kind: "remote_committed", ticketId: transitioned.createdRemoteId ?? 0, commentId: isComment ? remoteId : undefined, pending: "local_finalize", message: fin.message };
      }

      // reconcile_remote
      const reconciled = await handler.reconcileRemote(op, handlerCtx, input.deps);
      if (reconciled.ok && reconciled.remoteId) {
        const transitioned = await this.repository.transitionOperation(
          input.key,
          { kind: "record_reconciled_identity", remoteId: reconciled.remoteId, projectId: reconciled.projectId, remoteUpdatedAt: reconciled.remoteUpdatedAt },
          scope,
          { operationId: op.operationId, sourcePhase: "commit_unknown", revision: op.intentRevision ?? op.revision },
        );
        if (!transitioned) {
          return { kind: "failed_before_commit", error: new Error("Failed to record reconciled identity") };
        }
        const fin = await handler.finalizeLocal(transitioned, reconciled.canonical, handlerCtx, input.deps);
        if (fin.ok) {
          await this.repository.transitionOperation(input.key, { kind: "complete" }, scope);
          await this.repository.completeOperation(input.key, scope);
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
          message: fin.message,
        };
      }

      return {
        kind: "commit_unknown",
        operationId: op.operationId,
        ticketId: op.ticketId,
        commentId: op.commentId,
        message: reconciled.ok ? "Reconciliation failed" : reconciled.message,
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
