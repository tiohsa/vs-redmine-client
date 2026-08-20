import type { IssueUploadInput } from "../../redmine/issues";
import type { FrontmatterControlFields } from "../../views/ticketMetadataControlFields";
import type { IssueMetadata } from "../../views/ticketMetadataTypes";
import type {
  TicketEditorLayout,
  TicketEditorMetadataBlock,
} from "../../views/ticketEditorContent";
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
  | { kind: "start_explicit_retry_remote_write" }
  | { kind: "record_remote_commit"; createdRemoteId?: number; projectId?: number; remoteUpdatedAt?: string }
  | { kind: "mark_commit_unknown"; message?: string }
  | { kind: "mark_reconciliation_pending"; message?: string }
  | { kind: "mark_local_finalize_pending"; canonical?: any }
  | { kind: "complete" }
  | { kind: "abort_before_remote_write" }
  | { kind: "abort_known_remote_failure" }
  | { kind: "assume_remote_commit"; remoteId?: number; projectId?: number; remoteUpdatedAt?: string }
  | { kind: "record_reconciled_identity"; remoteId: number; projectId?: number; remoteUpdatedAt?: string; canonical?: any };

export interface LifecycleExpectation {
  operationId: string;
  revision: number;
  sourcePhase: GenericSyncPhase;
}

export type SyncOperationKey =
  | { kind: "ticket"; ticketId: number }
  | { kind: "newTicket"; queueId?: string; documentUri?: string }
  | { kind: "comment"; ticketId: number; commentId?: number; documentUri?: string };

export type IssueAttachmentSource =
  | { kind: "file"; filePath: string; filename?: string; contentType?: string }
  | { kind: "clipboard"; filename?: string; contentType?: string }
  | { kind: "token"; token: string; filename?: string; contentType?: string };

export interface TicketCreateIntent {
  projectId: number;
  subject: string;
  description: string;
  metadata: IssueMetadata;
  content?: string;
  revision?: number;
  attachments?: IssueAttachmentSource[];
  uploadTokens?: IssueUploadInput[];
  childTickets?: Array<{ subject: string; description?: string; tracker?: string; priority?: string }>;
  layout?: TicketEditorLayout;
  metadataBlock?: TicketEditorMetadataBlock;
  controlFields?: FrontmatterControlFields;
  baseDir?: string;
  documentUri?: string;
}

export interface TicketUpdateIntent {
  ticketId: number;
  baseSubject: string;
  baseDescription: string;
  baseMetadata: IssueMetadata;
  subject: string;
  description: string;
  metadata: IssueMetadata;
  content?: string;
  revision?: number;
  attachments?: IssueAttachmentSource[];
  uploadTokens?: IssueUploadInput[];
  childTickets?: Array<{ subject: string; description?: string; tracker?: string; priority?: string }>;
  layout?: TicketEditorLayout;
  metadataBlock?: TicketEditorMetadataBlock;
  controlFields?: FrontmatterControlFields;
  baseDir?: string;
  documentUri?: string;
  lastKnownRemoteUpdatedAt?: string;
}

export interface CommentCreateIntent {
  ticketId: number;
  body: string;
  attachments?: IssueAttachmentSource[];
  uploadTokens?: IssueUploadInput[];
  baseDir?: string;
  documentUri?: string;
  sourceNotesHash?: string;
  finalizeDraft?: boolean;
}

export interface CommentUpdateIntent {
  ticketId: number;
  commentId: number;
  baseBody?: string;
  body: string;
  attachments?: IssueAttachmentSource[];
  uploadTokens?: IssueUploadInput[];
  baseDir?: string;
  documentUri?: string;
  sourceNotesHash?: string;
  lastKnownRemoteUpdatedAt?: string;
}

export type SyncIntent =
  | TicketCreateIntent
  | TicketUpdateIntent
  | CommentCreateIntent
  | CommentUpdateIntent;

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

export type VerifiedRemote<TCanonical = any> =
  | {
      verified: true;
      remoteId?: number;
      projectId?: number;
      remoteUpdatedAt?: string;
      canonical: TCanonical;
    }
  | {
      verified: false;
      reason: string;
    };

export interface FinalizeInput<TCanonical = any> {
  documentUri?: string;
  syncedBody?: string;
  expectedBody?: string;
  remoteUpdatedAt?: string;
  canonical?: TCanonical;
}

export interface UnifiedSyncOperation<I extends SyncIntent = SyncIntent> {
  operationId: string;
  kind: SyncOperationKind;
  key?: SyncOperationKey;
  connectionScope: string;
  phase: GenericSyncPhase;
  revision: number;
  intentRevision?: number;
  version?: number;
  persistenceVersion: number;
  intent?: I;
  nextIntent?: I;
  ticketId?: number;
  commentId?: number;
  projectId?: number;
  documentUri?: string;
  createdRemoteId?: number;
  remoteUpdatedAt?: string;
  createdChildIds?: number[];
  effects?: DurableSyncEffect[];
  createdAt?: number | string;
  updatedAt?: number | string;
  errorMessage?: string;
}

