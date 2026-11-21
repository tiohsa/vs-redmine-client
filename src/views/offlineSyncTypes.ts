import type { DurableSyncEffect } from "../app/syncEffects";
import type { TicketUpdateIntent } from "../app/ticketSync/syncOperationTypes";
import type { TicketEditorLayout, TicketEditorMetadataBlock } from "./ticketEditorContent";
import type { IssueMetadata } from "./ticketMetadataTypes";
import type { FrontmatterControlFields } from "./ticketMetadataControlFields";

export type TicketUpdateSyncPhase =
  | "queued"
  | "preparing"
  | "remote_write_started"
  | "commit_unknown"
  | "remote_committed"
  | "reconciliation_pending"
  | "local_finalize_pending"
  | "completed";

export type NewTicketSyncPhase =
  | "queued"
  | "preparing"
  | "remote_write_started"
  | "commit_unknown"
  | "remote_created"
  | "reconciliation_pending"
  | "local_finalize_pending"
  | "completed";

export type TicketUpdateIntentSnapshot = {
  revision: number;
  subject: string;
  description: string;
  metadata: IssueMetadata;
  content?: string;
  layout?: TicketEditorLayout;
  metadataBlock?: TicketEditorMetadataBlock;
  controlFields?: FrontmatterControlFields;
  baseDir?: string;
  documentUri?: string;
} & Pick<TicketUpdateIntent, "attachments" | "uploadTokens" | "childTickets">;

export type OfflineTicketUpdate = {
  ticketId: number;
  baseSubject: string;
  baseDescription: string;
  baseMetadata: IssueMetadata;
  lastKnownRemoteUpdatedAt?: string;
  subject: string;
  description: string;
  metadata: IssueMetadata;
  content?: string;
  layout?: TicketEditorLayout;
  metadataBlock?: TicketEditorMetadataBlock;
  controlFields?: FrontmatterControlFields;
  baseDir?: string;
  documentUri?: string;
  operationId?: string;
  connectionScope?: string;
  phase?: TicketUpdateSyncPhase;
  attemptGeneration?: number;
  remoteUpdatedAt?: string;
  createdChildIds?: number[];
  revision?: number;
  intentRevision?: number;
  nextIntent?: TicketUpdateIntentSnapshot;
  createdAt?: number;
  effects?: DurableSyncEffect[];
  disposition?: SyncDisposition;
} & Pick<TicketUpdateIntent, "attachments" | "uploadTokens" | "childTickets">;

export type OfflineCommentUpdate = {
  ticketId: number;
  commentId?: number;
  createdRemoteId?: number;
  baseBody?: string;
  lastKnownRemoteUpdatedAt?: string;
  body: string;
  baseDir?: string;
  documentUri?: string;
  sourceNotesHash?: string;
  createdAt?: number;
  operationId?: string;
  connectionScope?: string;
  phase?: TicketUpdateSyncPhase;
  attemptGeneration?: number;
  revision?: number;
  intentRevision?: number;
  effects?: DurableSyncEffect[];
  disposition?: SyncDisposition;
  remoteProjectId?: number;
  finalizeDraft?: boolean;
  nextIntent?: CommentIntentSnapshot;
};

export type CommentIntentSnapshot = {
  revision: number;
  body: string;
  baseDir?: string;
  documentUri?: string;
};

export type SyncOperationKind =
  | "ticketCreate"
  | "ticketUpdate"
  | "commentCreate"
  | "commentUpdate";

export type SyncOperation = {
  operationId: string;
  kind: SyncOperationKind;
  connectionScope: string;
  revision: number;
  intentRevision?: number;
  attemptGeneration?: number;
  phase: NewTicketSyncPhase | TicketUpdateSyncPhase | "queued";
  documentUri?: string;
  createdAt: number;
  effects: DurableSyncEffect[];
  disposition?: SyncDisposition;
  payload: OfflineNewTicket | OfflineTicketUpdate | OfflineCommentUpdate;
};

export type NewTicketIntentSnapshot = {
  revision: number;
  content: string;
  projectId?: number;
  documentUri?: string;
  baseDir?: string;
};

export type OfflineNewTicket = {
  queueId: string;
  operationId?: string;
  content: string;
  projectId?: number;
  documentUri?: string;
  baseDir?: string;
  createdIssueId?: number;
  status?: "queued" | "created_rewrite_failed";
  phase?: NewTicketSyncPhase;
  preparationFailure?: string;
  connectionScope?: string;
  attemptGeneration?: number;
  remoteUpdatedAt?: string;
  createdChildIds?: number[];
  revision?: number;
  nextIntent?: NewTicketIntentSnapshot;
  createdAt?: number;
  effects?: DurableSyncEffect[];
  disposition?: SyncDisposition;
};

export type SyncDisposition = { kind: "abandoned"; abandonedAt: number };

export type TicketEditAuthorization = {
  ticketId: number;
  documentUri: string;
  editSessionId: string;
};

export type OfflineSyncQueue = {
  tickets: Map<number, OfflineTicketUpdate>;
  abandonedTickets?: OfflineTicketUpdate[];
  ticketEditAuthorizations?: TicketEditAuthorization[];
  comments: OfflineCommentUpdate[];
  newTickets: OfflineNewTicket[];
};

export type OfflineDiscardResult =
  | "discarded"
  | "discarded_next"
  | "recovery_required"
  | "not_found"
  | "stale";

export type OfflineDiscardKey =
  | { kind: "ticket"; ticketId: number; operationId?: string; abandonedAt?: number }
  | { kind: "newTicket"; queueId?: string; documentUri?: string }
  | { kind: "comment"; ticketId: number; commentId?: number; documentUri?: string; operationId?: string };

export type OfflineDiscardPlan = {
  readonly key: OfflineDiscardKey;
  readonly scope: string;
  readonly mode: OfflineDiscardMode;
  readonly expectation: StoredOfflineOperation | undefined;
};

export type OfflineAbandonPlan = Pick<OfflineDiscardPlan, "key" | "scope" | "expectation">;
export type OfflineAbandonResult = "abandoned" | "not_found" | "stale" | "busy" | "persistence_failed";
export type OfflineForgetAbandonedPlan = Pick<OfflineDiscardPlan, "key" | "scope" | "expectation">;
export type OfflineForgetAbandonedResult = "removed" | "not_found" | "stale" | "busy" | "persistence_failed";
export type OfflineForgetAllAbandonedPlan = {
  readonly scope: string;
  readonly items: readonly OfflineForgetAbandonedPlan[];
};

export type QueuedTicketCancellationExpectation = {
  operationId?: string;
  revision: number;
  intentRevision: number;
  content?: string;
  connectionScope?: string;
};

export type QueuedTicketCancelResult =
  | "cancelled"
  | "not_found"
  | "stale"
  | "recovery_required";

export type OfflineSyncLifecycle = "queued" | "recovery_pending" | "commit_unknown";

export type OfflineDiscardMode = "active" | "nextIntent" | "none";

export interface OfflineSyncPolicy {
  lifecycle: OfflineSyncLifecycle;
  canDiscard: boolean;
  discardMode: OfflineDiscardMode;
}

export type NewTicketLifecycleAction =
  | { kind: "begin_preparation" }
  | { kind: "abort_before_remote_write" }
  | { kind: "start_normal_remote_write" }
  | { kind: "start_explicit_retry_remote_write" }
  | { kind: "mark_commit_unknown" }
  | { kind: "record_remote_created"; ticketId: number }
  | { kind: "link_created_ticket"; ticketId: number }
  | { kind: "mark_reconciliation_pending"; remoteUpdatedAt?: string }
  | { kind: "mark_local_finalize_pending"; remoteUpdatedAt?: string }
  | { kind: "mark_compensation_pending" }
  | { kind: "complete_compensation" };

export type TicketUpdateLifecycleAction =
  | { kind: "begin_preparation" }
  | { kind: "abort_before_remote_write" }
  | { kind: "start_normal_remote_write" }
  | { kind: "start_explicit_retry_remote_write" }
  | { kind: "mark_commit_unknown" }
  | { kind: "record_remote_commit"; createdChildIds?: number[] }
  | { kind: "assume_update_committed" }
  | { kind: "mark_reconciliation_pending"; remoteUpdatedAt?: string }
  | { kind: "mark_local_finalize_pending"; remoteUpdatedAt?: string }
  | { kind: "mark_compensation_pending" };

export type CommentLifecycleAction =
  | { kind: "begin_preparation" }
  | { kind: "abort_before_remote_write" }
  | { kind: "start_normal_remote_write" }
  | { kind: "mark_commit_unknown" }
  | { kind: "assume_remote_commit"; commentId: number; projectId: number }
  | { kind: "abort_known_remote_failure" }
  | { kind: "record_remote_commit"; commentId?: number; projectId?: number }
  | { kind: "record_reconciled_identity"; commentId: number; projectId?: number }
  | { kind: "mark_reconciliation_pending" }
  | { kind: "mark_local_finalize_pending" };

export type LifecycleTransitionExpectation<Phase extends string> = {
  operationId: string;
  revision: number;
  attemptGeneration?: number;
  sourcePhase: Phase;
};

export type StoredOfflineOperation = OfflineNewTicket | OfflineTicketUpdate | OfflineCommentUpdate;

export type ResolvedStoredOperation =
  | { kind: "ticket"; value: OfflineTicketUpdate }
  | { kind: "newTicket"; value: OfflineNewTicket }
  | { kind: "comment"; value: OfflineCommentUpdate };

export type CommentQueueKey = { ticketId: number; commentId?: number; documentUri?: string; operationId?: string };
