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
import { defaultDeps as defaultTicketDeps } from "../../views/ticketSync/ticketSyncDeps";
import { getIssueDetail } from "../../redmine/issues";
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
  runInConnectionScope?: <T>(scope: string, operation: () => Promise<T>) => Promise<T>;
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

    // 1. 親がコミット済みで、未解決・不確実な child effect が存在する場合のみ remote_committed を返す
    const hasUnresolvedChildEffect = (operation.effects ?? []).some(
      (e) => (e.kind === "child_create" || (typeof e.effectId === "string" && e.effectId.startsWith("child-create"))) &&
        (e.state === "commit_unknown" || e.state === "compensation_unknown" || e.state === "compensation_started" || (e.state === "committed" && (operation.effects ?? []).some((o) => o.effectId.startsWith("child-create") && o.state === "failed"))),
    );
    const primary = (operation.effects ?? []).find((e) => e.kind === "ticket_create" || e.kind === "ticket_update" || (typeof e.effectId === "string" && (e.effectId.startsWith("ticket-") || e.effectId.startsWith("comment-"))));
    const isParentCommitted = operation.kind === "ticket_update"
      ? (primary?.state !== "commit_unknown" && hasUnresolvedChildEffect)
      : (primary?.state === "committed" || operation.createdRemoteId !== undefined);

    if (hasUnresolvedChildEffect && isParentCommitted) {
      const committedParentId = operation.createdRemoteId ?? (operation.effects?.find((e) => e.effectId === "ticket-create" && e.state === "committed")?.remoteId) ?? operation.ticketId ?? 0;
      return {
        kind: "remote_committed",
        ticketId: committedParentId,
        commentId: operation.commentId,
        pending: "remote_reconcile",
        message: "Secondary child effects remain unresolved or uncertain",
      };
    }

    // INV-04: 純粋な commit_unknown / remote_write_started は通常の sync() から自動再送できない
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
    const depsWithRepo = { repository: this.repository, ...options.deps };
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
        const prepOp = await this.repository.transitionOperation(
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
        await this.repository.transitionOperation(
          getOpKey(currentOp),
          { kind: "abort_before_remote_write" },
          scope,
        );
        return prepResult.outcome;
      }

      // 3. Secondary Effects (attachment upload 等)
      if (handler.executeSecondaryEffects) {
        const secResult = await handler.executeSecondaryEffects(currentOp, prepResult.prepared, handlerCtx, depsWithRepo);
        if (!secResult.ok) {
          const failedSec = secResult;
          const freshOp = this.repository.getOperation(getOpKey(currentOp), scope);
          const hasCommittedOrUnknownEffects = (freshOp?.effects ?? []).some(
            (e) => e.state === "committed" || e.state === "commit_unknown" || e.state === "compensation_unknown" || e.state === "compensation_started",
          );
          if (hasCommittedOrUnknownEffects) {
            const committedParentId = freshOp?.createdRemoteId ?? (freshOp?.effects?.find((e) => e.effectId === "ticket-create" && e.state === "committed")?.remoteId) ?? currentOp.ticketId ?? 0;
            try {
              await this.repository.transitionOperation(
                getOpKey(currentOp),
                { kind: "record_remote_commit", createdRemoteId: committedParentId > 0 ? committedParentId : undefined },
                scope,
              );
            } catch {
              // ignore persistence failure
            }
            return {
              kind: "remote_committed",
              ticketId: committedParentId,
              pending: "remote_reconcile",
              message: failedSec.error.message,
            };
          }
          if (failedSec.commitUnknown) {
            try {
              await this.repository.transitionOperation(
                getOpKey(currentOp),
                { kind: "mark_commit_unknown", message: failedSec.error.message },
                scope,
              );
            } catch {
              // ignore persistence failure
            }
            return {
              kind: "commit_unknown",
              operationId: currentOp.operationId,
              ticketId: currentOp.ticketId,
              commentId: currentOp.commentId,
              message: failedSec.error.message,
            };
          }
          try {
            await this.repository.transitionOperation(
              getOpKey(currentOp),
              { kind: "abort_before_remote_write" },
              scope,
            );
          } catch {
            // ignore persistence failure
          }
          return {
            kind: "failed_before_commit",
            error: failedSec.error,
            ticketId: currentOp.ticketId,
            commentId: currentOp.commentId,
          };
        }
      }

      // 4. start_normal_remote_write (INV-01: durable checkpoint before mutation)
      const writeStartOp = await this.repository.transitionOperation(
        getOpKey(currentOp),
        { kind: "start_normal_remote_write" },
        scope,
      );
      if (!writeStartOp) {
        return { kind: "failed_before_commit", error: new Error("Failed to transition to remote_write_started") };
      }
      currentOp = writeStartOp;

      // 5. executeRemoteWrite
      const remoteResult = await handler.executeRemoteWrite(currentOp, prepResult.prepared, handlerCtx, depsWithRepo);
      if (!remoteResult.ok) {
        const latestOp = this.repository.getOperation(getOpKey(currentOp), scope) ?? currentOp;
        const hasUnresolvedChild = (latestOp.effects ?? []).some((e) =>
          (e.kind === "child_create" || (typeof e.effectId === "string" && e.effectId.startsWith("child-create"))) &&
          (e.state === "committed" || e.state === "commit_unknown" || e.state === "compensation_unknown" || e.state === "compensation_started")
        );
        const isParentCreateCommitted = currentOp.kind === "ticket_create" && (latestOp.createdRemoteId !== undefined || (latestOp.effects ?? []).some((e) => e.effectId === "ticket-create" && e.state === "committed"));
        const committedParentId = latestOp.createdRemoteId ?? (latestOp.effects?.find((e) => e.effectId === "ticket-create" && e.state === "committed")?.remoteId) ?? 0;

        if (isParentCreateCommitted && hasUnresolvedChild && committedParentId > 0) {
          await this.repository.transitionOperation(
            getOpKey(currentOp),
            { kind: "record_remote_commit", createdRemoteId: committedParentId },
            scope,
          );
          return {
            kind: "remote_committed",
            ticketId: committedParentId,
            pending: "remote_reconcile",
            message: remoteResult.error?.message,
          };
        }

        if (remoteResult.commitUnknown) {
          await this.repository.transitionOperation(
            getOpKey(currentOp),
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
          getOpKey(currentOp),
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
        getOpKey(currentOp),
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

    // Step B: Reconciliation & Read-back
    let reconcileCanonical: any = undefined;
    if (currentOp.phase === "remote_committed" || currentOp.phase === "reconciliation_pending") {
      const hasUnresolvedChildEffects = (currentOp.effects ?? []).some((e) =>
        (e.kind === "child_create" || (typeof e.effectId === "string" && e.effectId.startsWith("child-create"))) && (
          e.state === "commit_unknown" ||
          e.state === "compensation_unknown" ||
          e.state === "compensation_started" ||
          e.state === "failed" ||
          (e.state === "committed" && (currentOp.effects ?? []).some((other) => (other.kind === "child_create" || (typeof other.effectId === "string" && other.effectId.startsWith("child-create"))) && other.state !== "committed" && other.state !== "compensated"))
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

      const isRecovery = currentOp.phase === "reconciliation_pending";
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
      if (finalizeOp) {
        currentOp = finalizeOp;
      }
    }

    // Step C: Local Finalize (local_finalize_pending からの再開または後続)
    if (currentOp.phase === "local_finalize_pending") {
      const canonical = reconcileCanonical ?? (currentOp as any).canonical;
      const finalizeResult = await handler.finalizeLocal(currentOp, canonical, handlerCtx, options.deps);
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
    resolution?: { kind: "reconcile_remote" } | { kind: "link_remote_comment"; commentId: number; explicitLink?: boolean } | { kind: "link_remote_ticket"; ticketId: number; explicitLink?: boolean } | { kind: "retry_remote_write" };
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

    const runner = (input as any).runInConnectionScope ?? runWithConnectionScope;
    const flightPromise = runner(scope, async (): Promise<SyncOutcome> => {
      const freshOp = this.repository.getOperation(input.key, scope);
      if (!freshOp || freshOp.phase !== "commit_unknown") {
        return {
          kind: "commit_unknown",
          operationId: freshOp?.operationId ?? op.operationId,
          ticketId: freshOp?.ticketId ?? op.ticketId,
          commentId: freshOp?.commentId ?? op.commentId,
          message: freshOp?.errorMessage ?? "Operation is no longer in commit_unknown phase",
        };
      }

      const handler = this.handlers[freshOp.kind];
      const handlerCtx: OperationHandlerContext = { connectionScope: scope };

      if (input.resolution?.kind === "retry_remote_write") {
        const prepResult = await handler.prepare(freshOp, handlerCtx, input.deps);
        if (!prepResult.ok) {
          return {
            kind: "commit_unknown",
            operationId: freshOp.operationId,
            ticketId: freshOp.ticketId,
            commentId: freshOp.commentId,
            message: "Preflight preparation failed",
          };
        }

        const writeStartOp = await this.repository.transitionOperation(
          input.key,
          { kind: "start_explicit_retry_remote_write" },
          scope,
          { operationId: freshOp.operationId, sourcePhase: "commit_unknown", revision: freshOp.intentRevision ?? freshOp.revision },
        );
        if (!writeStartOp) {
          return {
            kind: "commit_unknown",
            operationId: freshOp.operationId,
            ticketId: freshOp.ticketId,
            commentId: freshOp.commentId,
            message: "Failed to transition to remote_write_started due to conflict",
          };
        }

        const remoteResult = await handler.executeRemoteWrite(writeStartOp, prepResult.prepared, handlerCtx, input.deps);
        if (!remoteResult.ok) {
          await this.repository.transitionOperation(
            input.key,
            { kind: "mark_commit_unknown", message: remoteResult.error.message },
            scope,
          );
          return {
            kind: "commit_unknown",
            operationId: writeStartOp.operationId,
            ticketId: writeStartOp.ticketId,
            commentId: writeStartOp.commentId,
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

        const transitioned = await this.repository.transitionOperation(
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
        const fin = await handler.finalizeLocal(transitioned, detail, handlerCtx, input.deps);
        if (fin.ok) {
          await this.repository.transitionOperation(input.key, { kind: "complete" }, scope);
          await this.repository.completeOperation(input.key, scope, undefined, { canonical: detail, remoteUpdatedAt: transitioned.remoteUpdatedAt });
          return {
            kind: "completed",
            ticketId: transitioned.createdRemoteId ?? transitioned.ticketId ?? 0,
            commentId: isComment ? remoteId : undefined,
          };
        }
        return { kind: "remote_committed", ticketId: transitioned.createdRemoteId ?? 0, commentId: isComment ? remoteId : undefined, pending: "local_finalize", message: fin.message };
      }

      if ((input.resolution as any)?.kind === "assume_remote_commit" || (input.resolution as any)?.kind === "assume_update_committed") {
        const assumed = await this.repository.transitionOperation(
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
        const reconciled = await handler.reconcileRemote(assumed, handlerCtx, input.deps);
        const fin = await handler.finalizeLocal(assumed, reconciled.ok ? reconciled.canonical : undefined, handlerCtx, input.deps);
        if (fin.ok) {
          await this.repository.transitionOperation(input.key, { kind: "complete" }, scope);
          await this.repository.completeOperation(input.key, scope, undefined, { canonical: reconciled.ok ? reconciled.canonical : undefined, remoteUpdatedAt: assumed.remoteUpdatedAt });
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
          message: fin.message,
        };
      }

      // reconcile_remote
      const reconciled = await handler.reconcileRemote(freshOp, handlerCtx, input.deps);
      if (reconciled.ok && reconciled.remoteId) {
        const transitioned = await this.repository.transitionOperation(
          input.key,
          { kind: "record_reconciled_identity", remoteId: reconciled.remoteId, projectId: reconciled.projectId, remoteUpdatedAt: reconciled.remoteUpdatedAt },
          scope,
          { operationId: freshOp.operationId, sourcePhase: "commit_unknown", revision: freshOp.intentRevision ?? freshOp.revision },
        );
        if (!transitioned) {
          return { kind: "failed_before_commit", error: new Error("Failed to record reconciled identity") };
        }
        const fin = await handler.finalizeLocal(transitioned, reconciled.canonical, handlerCtx, input.deps);
        if (fin.ok) {
          await this.repository.transitionOperation(input.key, { kind: "complete" }, scope);
          await this.repository.completeOperation(input.key, scope, undefined, { canonical: reconciled.canonical, remoteUpdatedAt: transitioned.remoteUpdatedAt });
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
