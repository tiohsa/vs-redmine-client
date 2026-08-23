import {
  createSyncCoordinator,
  SyncCoordinator,
  type SyncAllStopReason,
} from "./ticketSync/syncCoordinator";
import type { SyncOperationRepository } from "./ticketSync/syncRepository";
import {
  createTicketSyncService,
  type TicketSyncService,
} from "./ticketSync/ticketSyncService";
import type { SyncContext } from "./ticketSync/ports";
import type { TicketSyncOutcome, TicketSyncQueueKey } from "./ticketSync/ticketSyncOutcome";
import type { CommentSaveDependencies } from "../views/commentSaveSync";
import type { SyncOutcome } from "./ticketSync/syncOperationTypes";
import { EffectResolution, TicketCreateHandler, TicketUpdateHandler } from "./ticketSync/operationHandlers";
import { getAttemptGeneration, type DurableSyncEffectState, type RecoveryItem } from "./syncEffects";

export type SyncEngineKey =
  | TicketSyncQueueKey
  | { kind: "comment"; ticketId: number; commentId?: number; documentUri?: string };

export type CommentSyncOutcome =
  | { kind: "completed"; ticketId: number; commentId?: number }
  | { kind: "no_change"; ticketId: number; commentId?: number }
  | { kind: "conflict"; ticketId: number; message: string }
  | { kind: "failed_before_commit"; ticketId: number; error: Error };

export type SyncEngineOutcome = TicketSyncOutcome | CommentSyncOutcome | SyncOutcome;

export interface SyncAllEngineOptions {
  shouldContinue?: () => boolean;
}

export type SyncAllEngineOutcome = {
  plan: SyncEngineKey[];
  results: Array<{ key: SyncEngineKey; outcome: SyncEngineOutcome }>;
  remaining: SyncEngineKey[];
  cancelled: boolean;
  stopReason: SyncAllStopReason;
};

export interface SyncEngineDependencies {
  tickets?: Pick<TicketSyncService, "syncQueueItem" | "syncAll" | "resolveCommitUnknown"> | {
    getIssueDetail?: (id: number) => Promise<any>;
    updateIssue?: (input: any) => Promise<any>;
    createIssue?: (input: any) => Promise<any>;
    getProjectTrackers?: () => Promise<any>;
    listIssueStatuses?: () => Promise<any>;
    listIssuePriorities?: () => Promise<any>;
    [key: string]: any;
  };
  comments?: Partial<CommentSaveDependencies>;
  coordinator?: SyncCoordinator;
  documents?: any;
}

export class SyncEngine {
  private readonly coordinator: SyncCoordinator;
  private readonly tickets: Pick<TicketSyncService, "syncQueueItem" | "syncAll" | "resolveCommitUnknown">;
  private readonly explicitTickets?: Pick<TicketSyncService, "syncQueueItem" | "syncAll" | "resolveCommitUnknown">;
  private readonly comments: Partial<CommentSaveDependencies>;
  private readonly rawTicketDeps?: any;
  private readonly documents?: any;

  public constructor(deps: SyncEngineDependencies = {}) {
    const rawTickets = deps.tickets as any;
    const isServiceLike = rawTickets && typeof rawTickets.syncQueueItem === "function";
    this.documents = deps.documents ?? rawTickets?.rewrite;

    if (rawTickets && !isServiceLike) {
      this.rawTicketDeps = rawTickets;
      this.coordinator = deps.coordinator ?? createSyncCoordinator({
        handlers: {
          ticketCreate: new TicketCreateHandler(),
          ticketUpdate: new TicketUpdateHandler(),
        },
      });
      this.tickets = createTicketSyncService({
        create: rawTickets,
        update: rawTickets,
      });
    } else {
      this.coordinator = deps.coordinator ?? createSyncCoordinator();
      this.explicitTickets = isServiceLike ? rawTickets : undefined;
      this.tickets = (isServiceLike ? rawTickets : undefined) ?? createTicketSyncService();
    }
    this.comments = deps.comments ?? {};
  }

  public ticketService(): Pick<TicketSyncService, "syncQueueItem" | "syncAll" | "resolveCommitUnknown"> {
    return this.tickets;
  }

  public getRepository(): SyncOperationRepository {
    return this.coordinator.getRepository();
  }

  private currentRecoveryIdentity(key: SyncEngineKey, context: SyncContext): {
    operationId: string;
    operationRevision: number;
    attemptGeneration: number;
  } {
    const operation = this.coordinator.getRepository().getOperation(key as any, context.connectionScope);
    return {
      operationId: operation?.operationId ?? "",
      operationRevision: operation?.intentRevision ?? operation?.revision ?? 1,
      attemptGeneration: getAttemptGeneration(operation),
    };
  }

  public async resolveCommentCommitUnknown(input: {
    key: Extract<SyncEngineKey, { kind: "comment" }>;
    context: SyncContext;
    attemptGeneration?: number;
    resolution?: { kind: "reconcile_remote" } | { kind: "link_remote_comment"; commentId: number };
  }): Promise<SyncEngineOutcome> {
    const identity = this.currentRecoveryIdentity(input.key, input.context);
    return this.coordinator.resolveCommitUnknown({
      key: input.key,
      operationId: identity.operationId,
      operationRevision: identity.operationRevision,
      context: input.context,
      attemptGeneration: input.attemptGeneration ?? identity.attemptGeneration,
      resolution: input.resolution,
      deps: {
        comment: this.comments,
      },
    });
  }

  public async resolveTicketCommitUnknown(input: {
    key: Extract<SyncEngineKey, { kind: "ticket" | "newTicket" }>;
    context: SyncContext;
    attemptGeneration?: number;
    resolution?:
      | { kind: "reconcile_remote" }
      | { kind: "link_remote_ticket"; ticketId: number }
      | { kind: "link_created_ticket"; ticketId: number }
      | { kind: "assume_update_committed" }
      | { kind: "retry_remote_write" }
      | { kind: "reconcile_compensation" };
  }): Promise<SyncEngineOutcome> {
    const identity = this.currentRecoveryIdentity(input.key, input.context);
    return this.coordinator.resolveCommitUnknown({
      key: input.key,
      operationId: identity.operationId,
      operationRevision: identity.operationRevision,
      context: input.context,
      attemptGeneration: input.attemptGeneration ?? identity.attemptGeneration,
      resolution: input.resolution,
      deps: {
        ticketCreate: this.rawTicketDeps,
        ticketUpdate: this.rawTicketDeps,
        comment: this.comments,
        documents: this.documents,
      },
    });
  }

  public async resolveEffect(input: {
    key: SyncEngineKey;
    operationId: string;
    operationRevision: number;
    /** Core recovery callbacks must provide the Attempt generation explicitly. */
    attemptGeneration?: number;
    effectId: string;
    expectedEffectState: DurableSyncEffectState;
    context: SyncContext;
    resolution: EffectResolution;
  }): Promise<SyncEngineOutcome> {
    const attemptGeneration = input.attemptGeneration;
    if (typeof attemptGeneration !== "number" || !Number.isInteger(attemptGeneration) || attemptGeneration <= 0) {
      return {
        kind: "failed_before_commit",
        error: new Error("Recovery attemptGeneration is required and must be a positive integer."),
      };
    }
    return this.coordinator.resolveEffect({
      key: input.key as any,
      operationId: input.operationId,
      operationRevision: input.operationRevision,
      attemptGeneration,
      effectId: input.effectId,
      expectedEffectState: input.expectedEffectState,
      context: input.context,
      resolution: input.resolution,
      deps: {
        ticketCreate: this.rawTicketDeps,
        ticketUpdate: this.rawTicketDeps,
        comment: this.comments,
        documents: this.documents,
      },
    }) as any;
  }

  public async syncOne(
    key: SyncEngineKey,
    context: SyncContext,
  ): Promise<SyncEngineOutcome> {
    if (this.explicitTickets && (key.kind === "ticket" || key.kind === "newTicket")) {
      return this.explicitTickets.syncQueueItem(key as any, context);
    }
    return this.coordinator.sync(key as any, context, {
      deps: {
        ticketCreate: this.rawTicketDeps,
        ticketUpdate: this.rawTicketDeps,
        comment: this.comments,
        documents: this.documents,
      },
    }) as any;
  }

  public getRecoveryItems(key: SyncEngineKey, context: SyncContext): RecoveryItem[] {
    return this.coordinator.getRecoveryItems(key as any, context);
  }

  public async syncAll(context: SyncContext, options?: SyncAllEngineOptions): Promise<SyncAllEngineOutcome> {
    const outcome = await this.coordinator.syncAll(context, {
      shouldContinue: options?.shouldContinue,
      deps: {
        comment: this.comments,
        ticketCreate: this.rawTicketDeps,
        ticketUpdate: this.rawTicketDeps,
      },
    });
    return {
      plan: outcome.plan as any,
      results: outcome.results as any,
      remaining: outcome.remaining as any,
      cancelled: outcome.cancelled,
      stopReason: outcome.stopReason,
    };
  }
}

export const createSyncEngine = (deps: SyncEngineDependencies = {}): SyncEngine =>
  new SyncEngine(deps);
