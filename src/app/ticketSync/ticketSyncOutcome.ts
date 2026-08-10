export type TicketSyncOutcome =
  | {
      kind: "completed";
      ticketId: number;
      saveResult?: import("../../views/ticketSaveTypes").TicketSaveResult;
    }
  | {
      kind: "remote_committed";
      ticketId: number;
      pending: "remote_reconcile" | "local_finalize";
      message?: string;
    }
  | { kind: "queued" }
  | {
      kind: "commit_unknown";
      operationId: string;
      ticketId?: number;
      message: string;
    }
  | {
      kind: "no_change";
      ticketId: number;
      saveResult?: import("../../views/ticketSaveTypes").TicketSaveResult;
    }
  | {
      kind: "conflict";
      ticketId: number;
      message?: string;
      conflictContext?: import("../../views/ticketSaveTypes").ConflictContext;
    }
  | {
      kind: "failed_before_commit";
      error: Error;
      saveResult?: import("../../views/ticketSaveTypes").TicketSaveResult;
    };

export type TicketSyncQueueKey =
  | { kind: "ticket"; ticketId: number }
  | { kind: "newTicket"; queueId?: string; documentUri?: string };

export type SyncAllItemOutcome = {
  key: TicketSyncQueueKey;
  outcome: TicketSyncOutcome;
};

export type SyncAllOutcome = {
  results: SyncAllItemOutcome[];
  cancelled: boolean;
};
