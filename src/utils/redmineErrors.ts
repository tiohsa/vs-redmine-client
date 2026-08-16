export type RedmineErrorType =
  | "auth_failure"
  | "permission_denied"
  | "validation_error"
  | "network_failure"
  | "server_error"
  | "conflict"
  | "unexpected";

import * as vscode from "vscode";

const getErrorMessages = (): Record<RedmineErrorType, string> => ({
  auth_failure: vscode.l10n.t("Authentication failed. Check your API key."),
  permission_denied: vscode.l10n.t("You do not have access to this ticket."),
  validation_error: vscode.l10n.t("Invalid input. Please check the values."),
  network_failure: vscode.l10n.t("Could not connect to Redmine. Check your network."),
  server_error: vscode.l10n.t("Redmine server error occurred."),
  conflict: vscode.l10n.t("Remote changes detected. Fetch the latest data before saving."),
  unexpected: vscode.l10n.t("An unexpected error occurred."),
});

export const classifyError = (error: unknown, statusCode?: number): RedmineErrorType => {
  const code = statusCode ?? extractStatusCode(error);
  if (code === 401) { return "auth_failure"; }
  if (code === 403) { return "permission_denied"; }
  if (code === 409) { return "conflict"; }
  if (code === 422) { return "validation_error"; }
  if (code !== undefined && code >= 500) { return "server_error"; }

  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|network/i.test(message)) {
    return "network_failure";
  }
  return "unexpected";
};

export const getUserMessage = (type: RedmineErrorType): string =>
  getErrorMessages()[type];

import type { FailureDisposition } from "../app/syncEffects";

export const extractStatusCode = (error: unknown): number | undefined => {
  if (error && typeof error === "object") {
    if ("status" in error && typeof (error as any).status === "number") {
      return (error as any).status;
    }
    if ("statusCode" in error && typeof (error as any).statusCode === "number") {
      return (error as any).statusCode;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/(?:HTTP|status|code|\()?\s*(\d{3})\b/i);
  return match ? Number(match[1]) : undefined;
};

export const classifyFailureDisposition = (error: unknown): FailureDisposition => {
  const code = extractStatusCode(error);
  if (code !== undefined) {
    if (code >= 400 && code < 500) {
      return "non_retriable";
    }
    if (code >= 500) {
      return "retryable";
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|network|socket/i.test(message)) {
    return "retryable";
  }
  if (/validation|invalid|unprocessable|422|400|403|404|401/i.test(message)) {
    return "non_retriable";
  }
  return "retryable";
};
