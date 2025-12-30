import { IssueMetadata } from "./ticketMetadataTypes";
import { UploadSummary } from "./saveUploadTypes";

export type TicketSaveStatus =
  | "created"
  | "success"
  | "no_change"
  | "conflict"
  | "unreachable"
  | "forbidden"
  | "not_found"
  | "failed";

export interface TicketSaveResult {
  status: TicketSaveStatus;
  message: string;
  uploadSummary?: UploadSummary;
}

export type TicketDraftStatus = "clean" | "dirty" | "conflict";

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
  status: TicketDraftStatus;
}
