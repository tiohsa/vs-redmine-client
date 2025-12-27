import { EditorDefaultField } from "../config/settings";
import { TicketEditorDefaults } from "./ticketEditorTypes";

const hasNewline = (value: string): boolean => /[\r\n]/.test(value);

export const validateEditorDefaultValue = (
  field: EditorDefaultField,
  value: string,
): string | undefined => {
  switch (field) {
    case "subject":
      if (hasNewline(value)) {
        return "Subject must be a single line.";
      }
      return undefined;
    case "tracker":
    case "priority":
    case "status":
      if (hasNewline(value)) {
        return "Metadata values must be a single line.";
      }
      return undefined;
    case "due_date":
      if (value.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return "due_date must be YYYY-MM-DD.";
      }
      return undefined;
    case "description":
    default:
      return undefined;
  }
};

export const validateTicketEditorDefaults = (
  defaults: TicketEditorDefaults,
): string | undefined => {
  const subjectError = validateEditorDefaultValue("subject", defaults.subject);
  if (subjectError) {
    return subjectError;
  }

  const trackerError = validateEditorDefaultValue("tracker", defaults.metadata.tracker);
  if (trackerError) {
    return trackerError;
  }

  const priorityError = validateEditorDefaultValue(
    "priority",
    defaults.metadata.priority,
  );
  if (priorityError) {
    return priorityError;
  }

  const statusError = validateEditorDefaultValue("status", defaults.metadata.status);
  if (statusError) {
    return statusError;
  }

  const dueDateError = validateEditorDefaultValue(
    "due_date",
    defaults.metadata.due_date,
  );
  if (dueDateError) {
    return dueDateError;
  }

  return undefined;
};
