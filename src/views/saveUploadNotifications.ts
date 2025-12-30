import { UploadSummary } from "./saveUploadTypes";

const formatFailures = (failures: UploadSummary["failures"]): string => {
  if (failures.length === 0) {
    return "";
  }
  const details = failures.slice(0, 3).map((entry) => entry.path).join(", ");
  const suffix = failures.length > 3 ? ` and ${failures.length - 3} more` : "";
  return `Failed images: ${details}${suffix}.`;
};

export const buildUploadWarningMessage = (summary: UploadSummary): string => {
  if (summary.permissionDenied) {
    return "Attachments skipped: missing attachment permission.";
  }
  if (summary.failures.length > 0) {
    return `Saved with upload failures. ${formatFailures(summary.failures)}`.trim();
  }
  return "";
};
