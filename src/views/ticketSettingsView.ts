import * as vscode from "vscode";
import { EditorDefaultField } from "../config/settings";
import {
  getTicketEditorDefaults,
  resetTicketEditorDefaultFields,
  updateTicketEditorDefaultField,
} from "./ticketEditorDefaultsStore";
import { validateEditorDefaultValue } from "./ticketEditorDefaultsValidation";
import { TicketSettingsItem, TicketsTreeProvider } from "./ticketsView";

export const EDITOR_DEFAULT_COMMANDS = {
  subject: "todoex.configureEditorDefaultSubject",
  description: "todoex.configureEditorDefaultDescription",
  tracker: "todoex.configureEditorDefaultTracker",
  priority: "todoex.configureEditorDefaultPriority",
  status: "todoex.configureEditorDefaultStatus",
  dueDate: "todoex.configureEditorDefaultDueDate",
  reset: "todoex.resetEditorDefaults",
};

const DEFAULT_FIELD_LABELS: Record<EditorDefaultField, string> = {
  subject: "Subject",
  description: "Description",
  tracker: "Tracker",
  priority: "Priority",
  status: "Status",
  due_date: "Due date",
};

const formatDefaultValue = (value: string, maxLength = 28): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "Blank";
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3)}...`;
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
  `Enter default ${DEFAULT_FIELD_LABELS[field].toLowerCase()} (leave blank for none)`;

const getCommandForField = (field: EditorDefaultField): string => {
  switch (field) {
    case "subject":
      return EDITOR_DEFAULT_COMMANDS.subject;
    case "description":
      return EDITOR_DEFAULT_COMMANDS.description;
    case "tracker":
      return EDITOR_DEFAULT_COMMANDS.tracker;
    case "priority":
      return EDITOR_DEFAULT_COMMANDS.priority;
    case "status":
      return EDITOR_DEFAULT_COMMANDS.status;
    case "due_date":
      return EDITOR_DEFAULT_COMMANDS.dueDate;
  }
};

export const buildEditorDefaultsItems = (): vscode.TreeItem[] => {
  const fields: EditorDefaultField[] = [
    "subject",
    "description",
    "tracker",
    "priority",
    "status",
    "due_date",
  ];

  const items = fields.map(
    (field) =>
      new TicketSettingsItem(
        `Editor default: ${DEFAULT_FIELD_LABELS[field]}`,
        formatDefaultValue(getFieldValue(field)),
        { command: getCommandForField(field), title: `Set default ${field}` },
      ),
  );

  items.push(
    new TicketSettingsItem(
      "Editor defaults: Reset",
      "Clear saved defaults",
      { command: EDITOR_DEFAULT_COMMANDS.reset, title: "Reset editor defaults" },
    ),
  );

  return items;
};

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
    title: "Reset editor defaults",
  });

  if (!picked || picked.length === 0) {
    return;
  }

  resetTicketEditorDefaultFields(picked.map((item) => item.field));
};

export class TicketSettingsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();

  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly ticketsProvider: TicketsTreeProvider) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    return [...buildEditorDefaultsItems(), ...this.ticketsProvider.getSettingsItems()];
  }
}
