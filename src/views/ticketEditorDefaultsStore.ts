import { EditorDefaultField } from "../config/settings";
import { IssueMetadata } from "./ticketMetadataTypes";
import { TicketEditorDefaults } from "./ticketEditorTypes";

const EMPTY_METADATA: IssueMetadata = {
  tracker: "",
  priority: "",
  status: "",
  due_date: "",
};

const buildEmptyDefaults = (): TicketEditorDefaults => ({
  subject: "",
  description: "",
  metadata: { ...EMPTY_METADATA },
});

const cloneDefaults = (value: TicketEditorDefaults): TicketEditorDefaults => ({
  subject: value.subject,
  description: value.description,
  metadata: { ...value.metadata },
});

let defaults = buildEmptyDefaults();

const setMetadataValue = (
  metadata: IssueMetadata,
  field: EditorDefaultField,
  value: string,
): IssueMetadata => {
  switch (field) {
    case "tracker":
      return { ...metadata, tracker: value };
    case "priority":
      return { ...metadata, priority: value };
    case "status":
      return { ...metadata, status: value };
    case "due_date":
      return { ...metadata, due_date: value };
    default:
      return { ...metadata };
  }
};

export const getTicketEditorDefaults = (): TicketEditorDefaults =>
  cloneDefaults(defaults);

export const setTicketEditorDefaults = (next: TicketEditorDefaults): void => {
  defaults = cloneDefaults(next);
};

export const resetTicketEditorDefaults = (): TicketEditorDefaults => {
  defaults = buildEmptyDefaults();
  return getTicketEditorDefaults();
};

export const updateTicketEditorDefaultField = (
  field: EditorDefaultField,
  value: string,
): TicketEditorDefaults => {
  const current = getTicketEditorDefaults();
  let next = current;
  switch (field) {
    case "subject":
      next = { ...current, subject: value };
      break;
    case "description":
      next = { ...current, description: value };
      break;
    case "tracker":
    case "priority":
    case "status":
    case "due_date":
      next = {
        ...current,
        metadata: setMetadataValue(current.metadata, field, value),
      };
      break;
  }

  setTicketEditorDefaults(next);
  return getTicketEditorDefaults();
};

export const resetTicketEditorDefaultFields = (
  fields: EditorDefaultField[],
): TicketEditorDefaults => {
  const current = getTicketEditorDefaults();
  let next = current;

  fields.forEach((field) => {
    switch (field) {
      case "subject":
        next = { ...next, subject: "" };
        break;
      case "description":
        next = { ...next, description: "" };
        break;
      case "tracker":
      case "priority":
      case "status":
      case "due_date":
        next = { ...next, metadata: setMetadataValue(next.metadata, field, "") };
        break;
    }
  });

  setTicketEditorDefaults(next);
  return getTicketEditorDefaults();
};
