import { extractHttpStatusCode } from "../redmine/httpError";
import * as vscode from "vscode";
import { CommentSaveResult } from "./commentSaveTypes";

export const buildResult = (
  status: CommentSaveResult["status"],
  message: string,
  extras: Partial<CommentSaveResult> = {},
): CommentSaveResult => ({
  status,
  message,
  ...extras,
});

export const shouldRefreshComments = (status: CommentSaveResult["status"]): boolean =>
  status === "created" || status === "created_unresolved" || status === "success";

export const mapErrorToResult = (error: unknown): CommentSaveResult => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  const statusCode = extractHttpStatusCode(error);

  if (statusCode === 409) {
    return buildResult("conflict", "Remote changes detected. Refresh before saving.");
  }
  if (statusCode === 404) {
    return buildResult("not_found", "Comment not found in Redmine.");
  }
  if (statusCode === 403) {
    return buildResult("forbidden", "Access denied for this comment.");
  }
  if (statusCode && statusCode >= 500) {
    return buildResult("unreachable", "Redmine is unreachable.");
  }

  return buildResult("failed", message);
};

export const buildUnresolvedResult = (
  message: string,
  extras: Partial<CommentSaveResult> = {},
): CommentSaveResult => buildResult("created_unresolved", message, extras);

export const mapHashBasedUpdateError = (mapped: CommentSaveResult): CommentSaveResult => {
  if (mapped.status === "failed" && /405/.test(mapped.message)) {
    return buildResult("failed", vscode.l10n.t("This Redmine environment does not support updating comments via the Webview. Use the Redmine web interface to edit."));
  }
  if (mapped.status === "forbidden") {
    return buildResult("forbidden", vscode.l10n.t("You do not have permission to edit this comment. Check Redmine permission settings."));
  }
  if (mapped.status === "not_found") {
    return buildResult("not_found", vscode.l10n.t("Comment not found. It may have been deleted or changed in Redmine."));
  }
  return mapped;
};
