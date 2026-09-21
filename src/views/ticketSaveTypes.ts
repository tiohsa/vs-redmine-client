import { IssueMetadata } from "./ticketMetadataTypes";
import { UploadSummary } from "./saveUploadTypes";

export type TicketSaveStatus =
  | "created"
  | "success"
  | "queued"
  | "merged"
  | "no_change"
  | "conflict"
  | "unreachable"
  | "forbidden"
  | "not_found"
  | "failed";

export interface ConflictContext {
  /** Conflict data must stay bound to the Redmine connection that produced it. */
  connectionScope?: string;
  ticketId: number;
  baseSubject: string;
  baseDescription: string;
  localSubject: string;
  localDescription: string;
  remoteSubject: string;
  remoteDescription: string;
  remoteMetadata: IssueMetadata;
  remoteUpdatedAt: string;
}

export interface TicketSaveResult {
  status: TicketSaveStatus;
  message: string;
  uploadSummary?: UploadSummary;
  conflictContext?: ConflictContext;
  remoteWriteAttempted?: boolean;
  remoteCommitUnknown?: boolean;
}

export type TicketMode = "new-ticket" | "ticket-update" | "comment";

export type LegacyTicketDraftStatus = "clean" | "dirty" | "conflict";
export type TicketDraftStatus =
  | LegacyTicketDraftStatus
  | "Draft"
  | "Dirty"
  | "Queued"
  | "Syncing"
  | "Synced"
  | "Failed"
  | "Conflict";

export interface TicketDraftState {
  ticketId: number;
  baseSubject: string;
  baseDescription: string;
  baseMetadata: IssueMetadata;
  draftSubject?: string;
  draftDescription?: string;
  draftMetadata?: IssueMetadata;
  lastKnownRemoteUpdatedAt?: string;
  lastSyncedAt?: number;
  lockVersion?: number;
  status: TicketDraftStatus;
}
