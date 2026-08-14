import type { ConflictContext, TicketSaveResult } from "../../views/ticketSaveTypes";
import type { DurableSyncEffect } from "../syncEffects";

export type SyncOperationKind =
  | "ticket_create"
  | "ticket_update"
  | "comment_create"
  | "comment_update";

export type GenericSyncPhase =
  | "queued"
  | "preparing"
  | "remote_write_started"
  | "commit_unknown"
  | "remote_committed"
  | "reconciliation_pending"
  | "local_finalize_pending"
  | "completed";

export type GenericLifecycleAction =
  | { kind: "begin_preparation" }
  | { kind: "start_normal_remote_write" }
  | { kind: "record_remote_commit"; createdRemoteId?: number; projectId?: number; remoteUpdatedAt?: string }
  | { kind: "mark_commit_unknown"; message?: string }
  | { kind: "mark_reconciliation_pending"; message?: string }
  | { kind: "mark_local_finalize_pending" }
  | { kind: "complete" }
  | { kind: "abort_before_remote_write" }
  | { kind: "abort_known_remote_failure" }
  | { kind: "retry_commit_unknown" }
  | { kind: "assume_remote_commit"; remoteId?: number; projectId?: number; remoteUpdatedAt?: string }
  | { kind: "record_reconciled_identity"; remoteId: number; projectId?: number; remoteUpdatedAt?: string };

export interface LifecycleExpectation {
  operationId: string;
  revision: number;
  sourcePhase: GenericSyncPhase;
}

export type SyncOperationKey =
  | { kind: "ticket"; ticketId: number }
  | { kind: "newTicket"; queueId?: string; documentUri?: string }
  | { kind: "comment"; ticketId: number; commentId?: number; documentUri?: string };

export type SyncOutcome =
  | {
      kind: "completed";
      ticketId: number;
      commentId?: number;
      saveResult?: TicketSaveResult;
    }
  | {
      kind: "remote_committed";
      ticketId: number;
      commentId?: number;
      pending: "remote_reconcile" | "local_finalize";
      message?: string;
    }
  | {
      kind: "queued";
      ticketId?: number;
      commentId?: number;
    }
  | {
      kind: "commit_unknown";
      operationId: string;
      ticketId?: number;
      commentId?: number;
      message: string;
    }
  | {
      kind: "no_change";
      ticketId: number;
      commentId?: number;
      saveResult?: TicketSaveResult;
    }
  | {
      kind: "conflict";
      ticketId: number;
      commentId?: number;
      message?: string;
      conflictContext?: ConflictContext;
    }
  | {
      kind: "failed_before_commit";
      error: Error;
      ticketId?: number;
      commentId?: number;
      saveResult?: TicketSaveResult;
    };

export interface UnifiedSyncOperation {
  operationId: string;
  kind: SyncOperationKind;
  connectionScope: string;
  phase: GenericSyncPhase;
  revision: number;
  persistenceVersion: number;
  ticketId?: number;
  commentId?: number;
  projectId?: number;
  documentUri?: string;
  createdRemoteId?: number;
  remoteUpdatedAt?: string;
  createdChildIds?: number[];
  effects?: DurableSyncEffect[];
  payload?: any;
  nextIntent?: any;
  createdAt?: number | string;
  updatedAt?: number | string;
}
