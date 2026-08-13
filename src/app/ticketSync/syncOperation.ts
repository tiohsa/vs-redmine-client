import type {
  NewTicketSyncPhase,
  TicketUpdateSyncPhase,
} from "../../views/offlineSyncStore";

export type { NewTicketSyncPhase, TicketUpdateSyncPhase };

export interface NewTicketSyncOperation {
  operationId: string;
  connectionScope: string;
  documentUri?: string;
  projectId?: number;
  phase: NewTicketSyncPhase;
  createdIssueId?: number;
  remoteUpdatedAt?: string;
  createdChildIds?: number[];
}
