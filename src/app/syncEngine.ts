import {
  createSyncCoordinator,
  SyncCoordinator,
} from "./ticketSync/syncCoordinator";
import {
  createTicketSyncService,
  type TicketSyncService,
} from "./ticketSync/ticketSyncService";
import type { SyncContext } from "./ticketSync/ports";
import type { TicketSyncOutcome, TicketSyncQueueKey } from "./ticketSync/ticketSyncOutcome";
import type { CommentSaveDependencies } from "../views/commentSaveSync";
import type { SyncOutcome } from "./ticketSync/syncOperationTypes";

export type SyncEngineKey =
  | TicketSyncQueueKey
  | { kind: "comment"; ticketId: number; commentId?: number; documentUri?: string };

export type CommentSyncOutcome =
  | { kind: "completed"; ticketId: number; commentId?: number }
  | { kind: "no_change"; ticketId: number; commentId?: number }
  | { kind: "conflict"; ticketId: number; message: string }
  | { kind: "failed_before_commit"; ticketId: number; error: Error };

export type SyncEngineOutcome = TicketSyncOutcome | CommentSyncOutcome | SyncOutcome;

export type SyncAllEngineOutcome = {
  plan: SyncEngineKey[];
  results: Array<{ key: SyncEngineKey; outcome: SyncEngineOutcome }>;
  remaining: SyncEngineKey[];
  cancelled: boolean;
};

export interface SyncEngineDependencies {
  tickets?: Pick<TicketSyncService, "syncQueueItem" | "syncAll" | "resolveCommitUnknown">;
  comments?: Partial<CommentSaveDependencies>;
  coordinator?: SyncCoordinator;
}

export class SyncEngine {
  private readonly coordinator: SyncCoordinator;
  private readonly tickets: Pick<TicketSyncService, "syncQueueItem" | "syncAll" | "resolveCommitUnknown">;
  private readonly comments: Partial<CommentSaveDependencies>;

  public constructor(deps: SyncEngineDependencies = {}) {
    this.coordinator = deps.coordinator ?? createSyncCoordinator();
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
    return this.coordinator.resolveCommitUnknown({
      key: input.key,
      context: input.context,
      resolution: input.resolution,
      deps: {
        comment: this.comments,
      },
    });
  }

  public async syncOne(
    key: SyncEngineKey,
    context: SyncContext,
  ): Promise<SyncEngineOutcome> {
    if (key.kind === "ticket" || key.kind === "newTicket") {
      return this.tickets.syncQueueItem(key as any, context);
    }
    return this.coordinator.sync(key as any, context, {
      deps: {
        comment: this.comments,
      },
    }) as any;
  }

  public async syncAll(context: SyncContext): Promise<SyncAllEngineOutcome> {
    const outcome = await this.coordinator.syncAll(context, {
      deps: {
        comment: this.comments,
      },
    });
    return {
      plan: outcome.plan as any,
      results: outcome.results as any,
      remaining: outcome.remaining as any,
      cancelled: outcome.cancelled,
    };
  }
}

export const createSyncEngine = (deps: SyncEngineDependencies = {}): SyncEngine =>
  new SyncEngine(deps);
