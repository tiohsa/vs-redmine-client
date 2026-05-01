import type { TicketSaveResult } from "../ticketSaveTypes";

export const buildResult = (
  status: TicketSaveResult["status"],
  message: string,
  extras: Partial<TicketSaveResult> = {},
): TicketSaveResult => ({
  status,
  message,
  ...extras,
});

export const mapErrorToResult = (error: unknown): TicketSaveResult => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  const match = message.match(/\((\d{3})\)/);
  const statusCode = match ? Number(match[1]) : undefined;

  if (statusCode === 409) {
    return buildResult("conflict", "Remote changes detected. Refresh before saving.");
  }
  if (statusCode === 404) {
    return buildResult("not_found", "Ticket not found in Redmine.");
  }
  if (statusCode === 403) {
    return buildResult("forbidden", "Access denied for this ticket.");
  }
  if (statusCode && statusCode >= 500) {
    return buildResult("unreachable", "Redmine is unreachable.");
  }

  return buildResult("failed", message);
};
