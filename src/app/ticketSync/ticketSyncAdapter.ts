import type { TicketSaveResult } from "../../views/ticketSaveTypes";
import { buildResult } from "../../views/ticketSync/ticketSyncResult";
import type { TicketSyncOutcome } from "./ticketSyncOutcome";

export const ticketSyncOutcomeToSaveResult = (
  outcome: TicketSyncOutcome,
  creating: boolean,
): TicketSaveResult => {
  switch (outcome.kind) {
    case "completed":
      return outcome.saveResult ?? buildResult(
        creating ? "created" : "success",
        creating ? "Ticket created." : "Redmine updated.",
      );
    case "no_change":
      return outcome.saveResult ?? buildResult("no_change", "No changes to save.");
    case "queued":
      return buildResult("queued", "Saved for offline sync.");
    case "conflict":
      return buildResult(
        "conflict",
        outcome.message ?? "Remote changes detected.",
        { conflictContext: outcome.conflictContext },
      );
    case "remote_committed":
      return buildResult(
        "failed",
        outcome.message ?? `Remote commit completed; ${outcome.pending} is pending.`,
      );
    case "failed_before_commit":
      return outcome.saveResult ?? buildResult("failed", outcome.error.message);
  }
};
