export type TicketSaveStatus =
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
}

export type TicketDraftStatus = "clean" | "dirty" | "conflict";

export interface TicketDraftState {
  ticketId: number;
  baseSubject: string;
  baseDescription: string;
  lastKnownRemoteUpdatedAt?: string;
  lastSyncedAt?: number;
  status: TicketDraftStatus;
}
