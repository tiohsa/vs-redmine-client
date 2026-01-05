import { TicketSaveResult } from "./ticketSaveTypes";
import { buildUploadWarningMessage } from "./saveUploadNotifications";

export type TicketSaveNotification = {
  type: "info" | "warning" | "error";
  message: string;
};

export const getSaveNotification = (
  result: TicketSaveResult,
): TicketSaveNotification | undefined => {
  if (
    result.uploadSummary &&
    (result.uploadSummary.permissionDenied || result.uploadSummary.failures.length > 0) &&
    result.status !== "failed" &&
    result.status !== "forbidden" &&
    result.status !== "not_found" &&
    result.status !== "unreachable" &&
    result.status !== "conflict"
  ) {
    return { type: "warning", message: buildUploadWarningMessage(result.uploadSummary) };
  }

  switch (result.status) {
    case "created":
      return { type: "info", message: "Ticket created." };
    case "success":
      return { type: "info", message: result.message || "Redmine updated." };
    case "queued":
      return { type: "info", message: result.message || "Saved for offline sync." };
    case "no_change":
      return undefined;
    case "conflict":
      return {
        type: "warning",
        message: "Remote changes detected. Refresh before saving.",
      };
    case "unreachable":
      return { type: "error", message: "Redmine is unreachable." };
    case "forbidden":
      return { type: "error", message: "Access denied for this ticket." };
    case "not_found":
      return { type: "error", message: "Ticket not found in Redmine." };
    case "failed":
      return { type: "error", message: `Save failed: ${result.message}` };
    default:
      return { type: "error", message: result.message };
  }
};
