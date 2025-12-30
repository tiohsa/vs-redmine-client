import { CommentSaveResult } from "./commentSaveTypes";
import { buildUploadWarningMessage } from "./saveUploadNotifications";

export type CommentSaveNotification = {
  type: "info" | "warning" | "error";
  message: string;
};

export const getCommentSaveNotification = (
  result: CommentSaveResult,
): CommentSaveNotification | undefined => {
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
    case "success":
      return { type: "info", message: "Comment updated." };
    case "created":
      return { type: "info", message: "Comment added." };
    case "created_unresolved":
      return { type: "warning", message: result.message };
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
      return { type: "error", message: "Access denied for this comment." };
    case "not_found":
      return { type: "error", message: "Comment not found in Redmine." };
    case "failed":
      return { type: "error", message: result.message };
    default:
      return { type: "error", message: result.message };
  }
};
