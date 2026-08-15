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

export const isRemoteCommitUnknownError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\((\d{3})\)/) ?? message.match(/HTTP\s*(\d{3})/i) ?? message.match(/status\s*code\s*(\d{3})/i);
  if (match) {
    const statusCode = Number(match[1]);
    return statusCode === 408 || statusCode === 429 || statusCode >= 500;
  }
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("econnrefused") || lower.includes("econnreset") || lower.includes("etimedout") || lower.includes("network") || lower.includes("socket")) {
    return true;
  }
  if (lower.includes("400") || lower.includes("401") || lower.includes("403") || lower.includes("404") || lower.includes("422") || lower.includes("validation")) {
    return false;
  }
  return true;
};
