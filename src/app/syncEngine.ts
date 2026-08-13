import * as vscode from "vscode";
import {
  completeOfflineCommentAsync,
  getOfflineCommentUpdate,
  getOfflineSyncQueue,
  type OfflineCommentUpdate,
  transitionOfflineCommentLifecycleAsync,
} from "../views/offlineSyncStore";
import {
  applyQueuedCommentUpdate,
  finalizeNewCommentDraftDocument,
  reconcileCommentCommitUnknown,
  type CommentSaveDependencies,
} from "../views/commentSaveSync";
import {
  finalizeNewCommentDraftFileAfterSync,
  updateCommentUpdateFileAfterSync,
} from "../views/commentUpdateFile";
import {
  createTicketSyncService,
  type TicketSyncService,
} from "./ticketSync/ticketSyncService";
import type { SyncContext } from "./ticketSync/ports";
import type { TicketSyncOutcome, TicketSyncQueueKey } from "./ticketSync/ticketSyncOutcome";

export type SyncEngineKey =
  | TicketSyncQueueKey
  | { kind: "comment"; ticketId: number; commentId?: number; documentUri?: string };

export type CommentSyncOutcome =
  | { kind: "completed"; ticketId: number; commentId?: number }
  | { kind: "no_change"; ticketId: number; commentId?: number }
  | { kind: "conflict"; ticketId: number; message: string }
  | { kind: "failed_before_commit"; ticketId: number; error: Error };

export type SyncEngineOutcome = TicketSyncOutcome | CommentSyncOutcome;

export type SyncAllEngineOutcome = {
  plan: SyncEngineKey[];
  results: Array<{ key: SyncEngineKey; outcome: SyncEngineOutcome }>;
  remaining: SyncEngineKey[];
  cancelled: boolean;
};

export interface SyncEngineDependencies {
  tickets?: Pick<TicketSyncService, "syncQueueItem" | "syncAll" | "resolveCommitUnknown">;
  comments?: Partial<CommentSaveDependencies>;
}

const commentExpectation = (operation: OfflineCommentUpdate) => {
  if (!operation.operationId || operation.revision === undefined || !operation.phase) {
    throw new Error("Comment operation is missing normalized lifecycle fields.");
  }
  return {
    operationId: operation.operationId,
    revision: operation.revision,
    sourcePhase: operation.phase,
  };
};

const findComment = (
  key: Extract<SyncEngineKey, { kind: "comment" }>,
  scope: string,
): OfflineCommentUpdate | undefined => {
  const comments = getOfflineSyncQueue(scope).comments;
  if (key.commentId !== undefined) {
    return comments.find((comment) =>
      comment.ticketId === key.ticketId && comment.commentId === key.commentId,
    );
  }
  return comments.find((comment) =>
    comment.ticketId === key.ticketId &&
    comment.documentUri === key.documentUri,
  );
};

const commentFlights = new Map<string, Promise<SyncEngineOutcome>>();

export class SyncEngine {
  private readonly tickets: Pick<TicketSyncService, "syncQueueItem" | "syncAll" | "resolveCommitUnknown">;
  private readonly comments: Partial<CommentSaveDependencies>;

  public constructor(deps: SyncEngineDependencies = {}) {
    this.tickets = deps.tickets ?? createTicketSyncService();
    this.comments = deps.comments ?? {};
  }

  public ticketService(): Pick<TicketSyncService, "syncQueueItem" | "syncAll" | "resolveCommitUnknown"> {
    return this.tickets;
  }

  public async resolveCommentCommitUnknown(input: {
    key: Extract<SyncEngineKey, { kind: "comment" }>;
    context: SyncContext;
    resolution?: { kind: "reconcile_remote" } | { kind: "link_remote_comment"; commentId: number };
  }): Promise<SyncEngineOutcome> {
    const update = findComment(input.key, input.context.connectionScope);
    if (!update || ![
      "commit_unknown",
      "remote_committed",
      "reconciliation_pending",
    ].includes(update.phase ?? "")) {
      return {
        kind: "failed_before_commit",
        ticketId: input.key.ticketId,
        error: new Error("Comment operation is no longer eligible for reconciliation."),
      };
    }
    if (update.connectionScope && update.connectionScope !== input.context.connectionScope) {
      return {
        kind: "failed_before_commit",
        ticketId: update.ticketId,
        error: new Error("Connection scope mismatch."),
      };
    }
    const identity = await reconcileCommentCommitUnknown(
      update,
      this.comments,
      input.resolution?.kind === "link_remote_comment"
        ? input.resolution.commentId
        : undefined,
    );
    if (!identity.ok) {
      if (update.phase !== "commit_unknown") {
        return {
          kind: "remote_committed",
          ticketId: update.ticketId,
          pending: "remote_reconcile",
          message: identity.message,
        };
      }
      return {
        kind: "commit_unknown",
        operationId: update.operationId!,
        ticketId: update.ticketId,
        message: identity.message,
      };
    }
    const transitioned = await transitionOfflineCommentLifecycleAsync(
      {
        ticketId: update.ticketId,
        commentId: update.commentId,
        documentUri: update.documentUri,
      },
      update.phase === "commit_unknown"
        ? {
          kind: "assume_remote_commit",
          commentId: identity.commentId,
          projectId: identity.projectId,
        }
        : {
          kind: "record_reconciled_identity",
          commentId: identity.commentId,
          projectId: identity.projectId,
        },
      input.context.connectionScope,
      commentExpectation(update),
    );
    if (!transitioned) {
      return {
        kind: "commit_unknown",
        operationId: update.operationId!,
        ticketId: update.ticketId,
        message: "Comment reconciliation lost its revision fence; no state was changed.",
      };
    }
    return this.syncOne(input.key, input.context);
  }

  public async syncOne(key: SyncEngineKey, context: SyncContext): Promise<SyncEngineOutcome> {
    if (key.kind !== "comment") {
      return this.tickets.syncQueueItem(key, context);
    }

    const update = findComment(key, context.connectionScope);
    const operationKey = [
      context.connectionScope,
      update?.operationId ?? `${key.ticketId}:${key.commentId ?? key.documentUri}`,
    ].join("::");
    const existing = commentFlights.get(operationKey);
    if (existing) {
      return existing;
    }
    const flight = this.syncComment(key, context);
    commentFlights.set(operationKey, flight);
    try {
      return await flight;
    } finally {
      if (commentFlights.get(operationKey) === flight) {
        commentFlights.delete(operationKey);
      }
    }
  }

  private async syncComment(
    key: Extract<SyncEngineKey, { kind: "comment" }>,
    context: SyncContext,
  ): Promise<SyncEngineOutcome> {
    const update = findComment(key, context.connectionScope);
    if (!update) {
      return {
        kind: "failed_before_commit",
        ticketId: key.ticketId,
        error: new Error("Queue entry for this comment update not found."),
      };
    }
    if (update.connectionScope && update.connectionScope !== context.connectionScope) {
      return {
        kind: "failed_before_commit",
        ticketId: update.ticketId,
        error: new Error("Connection scope mismatch."),
      };
    }
    if (update.phase === "commit_unknown" || update.phase === "remote_write_started") {
      return {
        kind: "commit_unknown",
        operationId: update.operationId!,
        ticketId: update.ticketId,
        message: "The previous comment write may have committed. Automatic retry is disabled.",
      };
    }
    const queueKey = {
      ticketId: update.ticketId,
      commentId: update.commentId,
      documentUri: update.documentUri,
    };
    const requiresDraftFinalization = update.finalizeDraft === true;
    let operation = update;
    if (operation.phase === "queued") {
      const preparing = await transitionOfflineCommentLifecycleAsync(
        queueKey,
        { kind: "begin_preparation" },
        context.connectionScope,
        commentExpectation(operation),
      );
      if (!preparing) {
        return {
          kind: "failed_before_commit",
          ticketId: update.ticketId,
          error: new Error("Comment operation changed before preparation."),
        };
      }
      operation = preparing;
    }
    const reconcileOnly = operation.phase === "remote_committed" ||
      operation.phase === "reconciliation_pending" ||
      operation.phase === "local_finalize_pending";
    const result = await applyQueuedCommentUpdate({
      update: operation,
      deps: this.comments,
      operationScope: context.connectionScope,
      reconcileOnly,
      beforeRemoteWrite: reconcileOnly ? undefined : async () => {
        const started = await transitionOfflineCommentLifecycleAsync(
          queueKey,
          { kind: "start_normal_remote_write" },
          context.connectionScope,
          commentExpectation(operation),
        );
        if (!started) { throw new Error("Comment operation changed before remote write."); }
        operation = started;
      },
      afterRemoteWrite: reconcileOnly ? undefined : async () => {
        const committed = await transitionOfflineCommentLifecycleAsync(
          queueKey,
          { kind: "record_remote_commit" },
          context.connectionScope,
          commentExpectation(operation),
        );
        if (!committed) { throw new Error("Comment remote commit journal failed."); }
        operation = committed;
      },
    });

    if (result.remoteCommitUnknown) {
      const unknown = await transitionOfflineCommentLifecycleAsync(
        queueKey,
        { kind: "mark_commit_unknown" },
        context.connectionScope,
        commentExpectation(operation),
      );
      return {
        kind: "commit_unknown",
        operationId: operation.operationId!,
        ticketId: operation.ticketId,
        message: unknown
          ? "The comment write result is unknown. Automatic retry is disabled."
          : "The comment write may have committed; its recovery checkpoint could not be updated.",
      };
    }

    if (result.remoteCommitted && operation.phase === "remote_write_started") {
      const unknown = await transitionOfflineCommentLifecycleAsync(
        queueKey,
        { kind: "mark_commit_unknown" },
        context.connectionScope,
        commentExpectation(operation),
      );
      return {
        kind: "commit_unknown",
        operationId: operation.operationId!,
        ticketId: operation.ticketId,
        message: unknown
          ? "The comment committed remotely, but its journal checkpoint failed. Automatic retry is disabled."
          : "The committed comment could not be checkpointed. Automatic retry is disabled.",
      };
    }

    if (result.status === "created_unresolved") {
      if (operation.phase === "remote_write_started" && result.remoteCommitted) {
        operation = await transitionOfflineCommentLifecycleAsync(
          queueKey,
          { kind: "record_remote_commit" },
          context.connectionScope,
          commentExpectation(operation),
        ) ?? operation;
      }
      if (operation.phase === "remote_committed") {
        operation = await transitionOfflineCommentLifecycleAsync(
          queueKey,
          { kind: "mark_reconciliation_pending" },
          context.connectionScope,
          commentExpectation(operation),
        ) ?? operation;
      }
      return {
        kind: "remote_committed",
        ticketId: operation.ticketId,
        pending: "remote_reconcile",
        message: result.message,
      };
    }

    if (result.status !== "success" && result.status !== "created" && result.status !== "no_change") {
      if (operation.phase === "preparing" || operation.phase === "remote_write_started") {
        await transitionOfflineCommentLifecycleAsync(
          queueKey,
          { kind: operation.phase === "preparing"
            ? "abort_before_remote_write"
            : "abort_known_remote_failure" },
          context.connectionScope,
          commentExpectation(operation),
        );
      }
      if (result.status === "conflict") {
        return { kind: "conflict", ticketId: update.ticketId, message: result.message };
      }
      return {
        kind: "failed_before_commit",
        ticketId: update.ticketId,
        error: new Error(result.message),
      };
    }

    if (result.status === "no_change" && operation.phase === "preparing") {
      operation = await transitionOfflineCommentLifecycleAsync(
        queueKey,
        { kind: "abort_before_remote_write" },
        context.connectionScope,
        commentExpectation(operation),
      ) ?? operation;
    }

    if (result.status === "created" && result.commentId !== undefined) {
      const identified = await transitionOfflineCommentLifecycleAsync(
        queueKey,
        {
          kind: "record_reconciled_identity",
          commentId: result.commentId,
          projectId: result.projectId,
        },
        context.connectionScope,
        commentExpectation(operation),
      );
      if (identified) { operation = identified; }
    }

    if (operation.phase === "remote_committed" || operation.phase === "reconciliation_pending") {
      operation = await transitionOfflineCommentLifecycleAsync(
        queueKey,
        { kind: "mark_local_finalize_pending" },
        context.connectionScope,
        commentExpectation(operation),
      ) ?? operation;
    }

    if (requiresDraftFinalization && update.documentUri) {
      const commentId = result.status === "created"
        ? result.commentId
        : operation.commentId ?? operation.effects?.find(
          (effect) => effect.kind === "comment_create",
        )?.remoteId;
      const projectId = result.status === "created"
        ? result.projectId
        : operation.remoteProjectId;
      if (!commentId || !projectId) {
        return {
          kind: "remote_committed",
          ticketId: update.ticketId,
          pending: "remote_reconcile",
          message: "The created comment identity is not yet available for local finalization.",
        };
      }
      const finalized = await finalizeNewCommentDraftFileAfterSync({
        documentUri: update.documentUri,
        ticketId: update.ticketId,
        commentId,
        projectId,
        expectedDocumentBody: operation.nextIntent?.body ?? update.body,
        syncedBody: update.body,
      });
      if (finalized !== "applied") {
        return {
          kind: "remote_committed",
          ticketId: update.ticketId,
          pending: "local_finalize",
          message: finalized === "stale_source"
            ? "The comment draft changed during synchronization and was not overwritten."
            : "The created comment draft could not be finalized locally.",
        };
      }
      const document = vscode.workspace.textDocuments.find(
        (candidate) => candidate.uri.toString() === update.documentUri,
      );
      if (!document) {
        return {
          kind: "remote_committed",
          ticketId: update.ticketId,
          pending: "local_finalize",
          message: "The finalized comment document is no longer open.",
        };
      }
      finalizeNewCommentDraftDocument({
        document,
        ticketId: update.ticketId,
        projectId,
        commentId,
        body: update.body,
        operationScope: context.connectionScope,
      });
    }
    if (result.status === "success" && update.sourceNotesHash && update.documentUri) {
      const finalized = await updateCommentUpdateFileAfterSync(
        update.documentUri,
        update.body,
        update.body,
      );
      if (finalized !== "applied") {
        return {
          kind: "remote_committed",
          ticketId: update.ticketId,
          pending: "local_finalize",
          message: finalized === "stale_source"
            ? "The comment file changed during synchronization and was not overwritten."
            : "The comment file could not be finalized locally.",
        };
      }
    }
    const completed = await completeOfflineCommentAsync(
      queueKey,
      context.connectionScope,
      operation.revision!,
    );
    if (!completed) {
      return {
        kind: "remote_committed",
        ticketId: update.ticketId,
        pending: "local_finalize",
        message: "A newer local comment revision arrived during finalization.",
      };
    }
    return result.status === "no_change"
      ? { kind: "no_change", ticketId: update.ticketId, commentId: update.commentId }
      : {
        kind: "completed",
        ticketId: update.ticketId,
        commentId: result.status === "created" ? result.commentId : update.commentId,
      };
  }

  public async syncAll(
    context: SyncContext,
    options: { shouldContinue?: () => boolean } = {},
  ): Promise<SyncAllEngineOutcome> {
    const comments = getOfflineSyncQueue(context.connectionScope).comments;
    const commentKeys: SyncEngineKey[] = comments.map((comment) => ({
      kind: "comment",
      ticketId: comment.ticketId,
      commentId: comment.commentId,
      documentUri: comment.documentUri,
    }));
    const ticketResult = await this.tickets.syncAll(context, options);
    const results: Array<{ key: SyncEngineKey; outcome: SyncEngineOutcome }> = [...ticketResult.results];
    const plan: SyncEngineKey[] = [...ticketResult.plan, ...commentKeys];
    if (ticketResult.cancelled) {
      return {
        plan,
        results,
        remaining: [...ticketResult.remaining, ...commentKeys],
        cancelled: true,
      };
    }
    for (let index = 0; index < comments.length; index++) {
      const comment = comments[index];
      if (options.shouldContinue && !options.shouldContinue()) {
        return { plan, results, remaining: commentKeys.slice(index), cancelled: true };
      }
      const key = commentKeys[index];
      results.push({ key, outcome: await this.syncOne(key, context) });
    }
    return { plan, results, remaining: [], cancelled: false };
  }
}

export const createSyncEngine = (deps: SyncEngineDependencies = {}): SyncEngine => new SyncEngine(deps);
