import * as vscode from "vscode";
import { EditorDefaultField } from "../config/settings";
import {
  getTicketEditorDefaults,
  resetTicketEditorDefaultFields,
  updateTicketEditorDefaultField,
} from "./ticketEditorDefaultsStore";
import { validateEditorDefaultValue } from "./ticketEditorDefaultsValidation";

const DEFAULT_FIELD_LABELS: Record<EditorDefaultField, string> = {
  subject: "Subject",
  description: "Description",
  tracker: "Tracker",
  priority: "Priority",
  status: "Status",
  due_date: "Due date",
};

const getFieldValue = (field: EditorDefaultField): string => {
  const defaults = getTicketEditorDefaults();
  switch (field) {
    case "subject":
      return defaults.subject;
    case "description":
      return defaults.description;
    case "tracker":
      return defaults.metadata.tracker;
    case "priority":
      return defaults.metadata.priority;
    case "status":
      return defaults.metadata.status;
    case "due_date":
      return defaults.metadata.due_date;
  }
};

const getFieldPrompt = (field: EditorDefaultField): string =>
  vscode.l10n.t("Enter default {0} (leave blank for none)", DEFAULT_FIELD_LABELS[field].toLowerCase());

export const configureEditorDefaultField = async (
  field: EditorDefaultField,
): Promise<void> => {
  const current = getFieldValue(field);
  const next = await vscode.window.showInputBox({
    prompt: getFieldPrompt(field),
    value: current,
  });

  if (next === undefined) {
    return;
  }

  const normalized = field === "description" ? next : next.trim();
  const error = validateEditorDefaultValue(field, normalized);
  if (error) {
    await vscode.window.showErrorMessage(error);
    return;
  }

  updateTicketEditorDefaultField(field, normalized);
};

export const resetEditorDefaults = async (): Promise<void> => {
  const items = (
    [
      "subject",
      "description",
      "tracker",
      "priority",
      "status",
      "due_date",
    ] as EditorDefaultField[]
  ).map((field) => ({
    label: DEFAULT_FIELD_LABELS[field],
    field,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: vscode.l10n.t("Reset editor defaults"),
  });

  if (!picked || picked.length === 0) {
    return;
  }

  resetTicketEditorDefaultFields(picked.map((item) => item.field));
};
