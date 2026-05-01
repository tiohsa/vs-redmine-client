import {
  buildMarkdownImageUploadFailureMessage,
  hasMarkdownImageUploadFailure,
  type MarkdownImageUploadSummary,
} from "../../utils/markdownImageUpload";
import type { UploadSummary } from "../saveUploadTypes";
import type { TicketSaveResult } from "../ticketSaveTypes";
import { buildResult } from "./ticketSyncResult";

export const resolveUploadSummary = (
  summary: MarkdownImageUploadSummary,
): UploadSummary | undefined =>
  summary.permissionDenied || summary.failures.length > 0 ? summary : undefined;

export const handleTicketUploadFailure = (
  summary: MarkdownImageUploadSummary,
): TicketSaveResult | undefined => {
  if (!hasMarkdownImageUploadFailure(summary)) {
    return undefined;
  }
  return buildResult(
    "failed",
    buildMarkdownImageUploadFailureMessage(summary),
    { uploadSummary: resolveUploadSummary(summary) },
  );
};
