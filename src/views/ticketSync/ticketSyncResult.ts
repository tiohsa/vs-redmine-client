import { extractHttpStatusCode } from "../../redmine/httpError";
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
  const statusCode = extractHttpStatusCode(error);

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
  const statusCode = extractHttpStatusCode(error);
  if (statusCode !== undefined) {
    // 書き込み後にproxyがエラー応答した場合、未実行とは断定できない。
    return statusCode === 408 || statusCode === 502 || statusCode === 503 || statusCode === 504;
  }
  // HTTP応答のない例外では書き込み結果を証明できない。
  return true;
};
