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
  const lower = message.toLowerCase();

  // 1. トランスポートレベルのタイムアウト・ソケット切断・ネットワーク切断は常に unknown
  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("socket") ||
    lower.includes("network")
  ) {
    return true;
  }

  // 2. HTTP ステータスコード判定
  let statusCode: number | undefined;
  const match =
    message.match(/\((\d{3})\)/) ??
    message.match(/HTTP\s*(\d{3})/i) ??
    message.match(/status\s*code\s*(\d{3})/i) ??
    message.match(/\b(400|401|403|404|408|409|422|500|502|503|504)\b/);
  if (match) {
    statusCode = Number(match[1]);
  } else if (error && typeof error === "object" && "status" in error && typeof (error as any).status === "number") {
    statusCode = (error as any).status;
  }

  if (statusCode === 408 || statusCode === 504) {
    return true;
  }

  // 3. 4xx および 5xx で明示的レスポンスがある場合は known failure (commit_unknown = false)
  if (statusCode !== undefined && statusCode >= 400 && statusCode <= 599) {
    return false;
  }

  if (lower.includes("400") || lower.includes("401") || lower.includes("403") || lower.includes("404") || lower.includes("409") || lower.includes("422") || lower.includes("validation")) {
    return false;
  }

  return true;
};
