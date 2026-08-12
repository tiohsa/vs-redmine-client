import * as vscode from "vscode";
import {
  getOfflineSyncQueue,
  removeOfflineCommentEntry,
  type OfflineCommentUpdate,
} from "../views/offlineSyncStore";
import {
  applyQueuedCommentUpdate,
  finalizeNewCommentDraftDocument,
} from "../views/commentSaveSync";
import { updateCommentUpdateFileAfterSync } from "../views/commentUpdateFile";
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

export interface SyncEngineDependencies {
  tickets?: Pick<TicketSyncService, "syncQueueItem" | "syncAll" | "resolveCommitUnknown">;
}

const isCommentSuccess = (status: string): boolean =>
  status === "success" || status === "created" || status === "created_unresolved" || status === "no_change";

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
    comment.commentId === undefined &&
    comment.documentUri === key.documentUri,
  );
};

export class SyncEngine {
  private readonly tickets: Pick<TicketSyncService, "syncQueueItem" | "syncAll" | "resolveCommitUnknown">;

  public constructor(deps: SyncEngineDependencies = {}) {
    this.tickets = deps.tickets ?? createTicketSyncService();
  }

  public ticketService(): Pick<TicketSyncService, "syncQueueItem" | "syncAll" | "resolveCommitUnknown"> {
    return this.tickets;
  }

  public async syncOne(key: SyncEngineKey, context: SyncContext): Promise<SyncEngineOutcome> {
    if (key.kind !== "comment") {
      return this.tickets.syncQueueItem(key, context);
    }

    const update = findComment(key, context.connectionScope);
    if (!update) {
      return {
        kind: "failed_before_commit",
        ticketId: key.ticketId,
        error: new Error("Queue entry for this comment update not found."),
      };
    }
    const result = await applyQueuedCommentUpdate({ update, operationScope: context.connectionScope });
    if (!isCommentSuccess(result.status)) {
      if (result.status === "conflict") {
        return { kind: "conflict", ticketId: update.ticketId, message: result.message };
      }
      return {
        kind: "failed_before_commit",
        ticketId: update.ticketId,
        error: new Error(result.message),
      };
    }

    if (result.status === "created" && update.documentUri && result.commentId && result.projectId) {
      const document = vscode.workspace.textDocuments.find(
        (candidate) => candidate.uri.toString() === update.documentUri,
      );
      if (document) {
        finalizeNewCommentDraftDocument({
          document,
          ticketId: update.ticketId,
          projectId: result.projectId,
          commentId: result.commentId,
          operationScope: context.connectionScope,
        });
      }
    }
    if (result.status === "success" && update.sourceNotesHash && update.documentUri) {
      await updateCommentUpdateFileAfterSync(update.documentUri, update.body);
    }
    removeOfflineCommentEntry(
      { commentId: update.commentId, documentUri: update.documentUri },
      context.connectionScope,
    );
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
  ): Promise<{ results: Array<{ key: SyncEngineKey; outcome: SyncEngineOutcome }>; cancelled: boolean }> {
    const ticketResult = await this.tickets.syncAll(context, options);
    const results: Array<{ key: SyncEngineKey; outcome: SyncEngineOutcome }> = [...ticketResult.results];
    if (ticketResult.cancelled) {
      return { results, cancelled: true };
    }
    const comments = getOfflineSyncQueue(context.connectionScope).comments;
    for (const comment of comments) {
      if (options.shouldContinue && !options.shouldContinue()) {
        return { results, cancelled: true };
      }
      const key: SyncEngineKey = {
        kind: "comment",
        ticketId: comment.ticketId,
        commentId: comment.commentId,
        documentUri: comment.documentUri,
      };
      results.push({ key, outcome: await this.syncOne(key, context) });
    }
    return { results, cancelled: false };
  }
}

export const createSyncEngine = (deps: SyncEngineDependencies = {}): SyncEngine => new SyncEngine(deps);
