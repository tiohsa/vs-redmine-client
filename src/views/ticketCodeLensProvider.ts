import * as path from "path";
import * as vscode from "vscode";
import { listIssuePriorities, listIssueStatuses, listTrackers } from "../redmine/issues";
import { getProjectTrackers } from "../redmine/projects";
import {
  isNewTicketDraftFilename,
  parseEditorFilename,
  parseNewCommentDraftFilename,
} from "./editorFilename";
import { getEditorContentTypeForDocument, getTicketIdForDocument } from "./ticketEditorRegistry";
import { isCommentUpdateFilename } from "./commentUpdateFile";

export type TicketQuickPickField =
  | "tracker"
  | "status"
  | "priority"
  | "doneRatio"
  | "startDate"
  | "dueDate";

export const EDIT_FIELD_VIA_QUICK_PICK_COMMAND = "redmine-client.editFieldViaQuickPick";

const REDMINE_TICKET_FILENAME_PATTERN = /^redmine-client-.*\.md$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const FIELD_TO_YAML_KEY: Record<TicketQuickPickField, string> = {
  tracker: "tracker",
  status: "status",
  priority: "priority",
  doneRatio: "done_ratio",
  startDate: "start_date",
  dueDate: "due_date",
};

const YAML_KEY_TO_FIELD: Record<string, TicketQuickPickField> = {
  tracker: "tracker",
  status: "status",
  priority: "priority",
  done_ratio: "doneRatio",
  start_date: "startDate",
  due_date: "dueDate",
};

export interface ParsedFieldLine {
  line: number;
  prefix: string;
  value: string;
}

export interface ParsedTicketCodeLensInfo {
  issueLine: number;
  issueBlockEndLine: number;
  frontmatterEndLine: number;
  projectId?: number;
  issueId?: number;
  fields: Partial<Record<TicketQuickPickField, string>>;
  fieldLines: Partial<Record<TicketQuickPickField, ParsedFieldLine>>;
}

export const parseTicketFrontmatterForCodeLens = (
  text: string,
): ParsedTicketCodeLensInfo | undefined => {
  const lines = text.split(/\r?\n/);
  if (lines.length < 3 || lines[0].trim() !== "---") {
    return undefined;
  }

  let frontmatterEndLine = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      frontmatterEndLine = i;
      break;
    }
  }
  if (frontmatterEndLine === -1) {
    return undefined;
  }

  let issueLine = -1;
  let projectId: number | undefined;
  let issueId: number | undefined;
  const fields: Partial<Record<TicketQuickPickField, string>> = {};
  const fieldLines: Partial<Record<TicketQuickPickField, ParsedFieldLine>> = {};

  for (let i = 1; i < frontmatterEndLine; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (issueLine === -1) {
      if (trimmed === "issue:") {
        issueLine = i;
        continue;
      }
      const projectMatch = trimmed.match(/^project_id:\s*(\d+)$/);
      if (projectMatch) {
        projectId = Number(projectMatch[1]);
      }
      const issueMatch = trimmed.match(/^issue_id:\s*(\d+)$/);
      if (issueMatch) {
        issueId = Number(issueMatch[1]);
      }
      continue;
    }

    const fieldMatch = line.match(/^( {2}([a-z_]+):\s*)(.*)$/);
    if (!fieldMatch) {
      continue;
    }
    const yamlKey = fieldMatch[2];
    const field = YAML_KEY_TO_FIELD[yamlKey];
    if (!field) {
      continue;
    }
    const rawValue = fieldMatch[3];
    const commentIndex = rawValue.indexOf(" #");
    const cleanValue = (commentIndex === -1 ? rawValue : rawValue.slice(0, commentIndex)).trim();
    fields[field] = cleanValue;
    fieldLines[field] = {
      line: i,
      prefix: fieldMatch[1],
      value: cleanValue,
    };
  }

  if (issueLine === -1) {
    return undefined;
  }

  let issueBlockEndLine = issueLine;
  for (let i = issueLine + 1; i < frontmatterEndLine; i++) {
    if (lines[i].startsWith("  ")) {
      issueBlockEndLine = i;
    } else if (lines[i].trim().length > 0) {
      break;
    }
  }

  return {
    issueLine,
    issueBlockEndLine,
    frontmatterEndLine,
    projectId,
    issueId,
    fields,
    fieldLines,
  };
};

export const isCodeLensTargetFilename = (filename: string): boolean => {
  if (
    parseNewCommentDraftFilename(filename) !== undefined ||
    isCommentUpdateFilename(filename) ||
    /^redmine-client-comment-/i.test(filename)
  ) {
    return false;
  }
  if (REDMINE_TICKET_FILENAME_PATTERN.test(filename)) {
    return true;
  }
  const parsed = parseEditorFilename(filename);
  if (parsed?.type === "ticket") {
    return true;
  }
  return isNewTicketDraftFilename(filename);
};

export const isCodeLensTargetDocument = (document: vscode.TextDocument): boolean => {
  if (document.languageId !== "markdown") {
    return false;
  }
  const ticketId = getTicketIdForDocument(document);
  if (ticketId !== undefined && getEditorContentTypeForDocument(document) === "ticket") {
    return true;
  }
  const filename = path.basename(document.uri.path);
  return isCodeLensTargetFilename(filename);
};

export const buildYamlFieldLine = (
  field: TicketQuickPickField,
  value: string,
  existingPrefix?: string,
): string => {
  const key = FIELD_TO_YAML_KEY[field];
  if (existingPrefix) {
    if (value.length === 0) {
      return `  ${key}:`;
    }
    const prefix = existingPrefix.endsWith(" ") ? existingPrefix : `${existingPrefix} `;
    return `${prefix}${value}`;
  }
  if (value.length === 0) {
    return `  ${key}:`;
  }
  return `  ${key}: ${value}`;
};

export class TicketCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!isCodeLensTargetDocument(document)) {
      return [];
    }
    const parsed = parseTicketFrontmatterForCodeLens(document.getText());
    if (!parsed) {
      return [];
    }

    const range = new vscode.Range(parsed.issueLine, 0, parsed.issueLine, 0);
    const notSet = vscode.l10n.t("Not set");
    const tracker = parsed.fields.tracker || notSet;
    const status = parsed.fields.status || notSet;
    const priority = parsed.fields.priority || notSet;
    const doneRatio = parsed.fields.doneRatio && parsed.fields.doneRatio.length > 0
      ? parsed.fields.doneRatio
      : "0";
    const startDate = parsed.fields.startDate || notSet;
    const dueDate = parsed.fields.dueDate || notSet;

    return [
      new vscode.CodeLens(range, {
        title: vscode.l10n.t("Tracker: {0}", tracker),
        command: EDIT_FIELD_VIA_QUICK_PICK_COMMAND,
        arguments: [document.uri, "tracker" satisfies TicketQuickPickField],
      }),
      new vscode.CodeLens(range, {
        title: vscode.l10n.t("Status: {0}", status),
        command: EDIT_FIELD_VIA_QUICK_PICK_COMMAND,
        arguments: [document.uri, "status" satisfies TicketQuickPickField],
      }),
      new vscode.CodeLens(range, {
        title: vscode.l10n.t("Priority: {0}", priority),
        command: EDIT_FIELD_VIA_QUICK_PICK_COMMAND,
        arguments: [document.uri, "priority" satisfies TicketQuickPickField],
      }),
      new vscode.CodeLens(range, {
        title: vscode.l10n.t("Progress: {0}%", doneRatio),
        command: EDIT_FIELD_VIA_QUICK_PICK_COMMAND,
        arguments: [document.uri, "doneRatio" satisfies TicketQuickPickField],
      }),
      new vscode.CodeLens(range, {
        title: vscode.l10n.t("Start date: {0}", startDate),
        command: EDIT_FIELD_VIA_QUICK_PICK_COMMAND,
        arguments: [document.uri, "startDate" satisfies TicketQuickPickField],
      }),
      new vscode.CodeLens(range, {
        title: vscode.l10n.t("Due date: {0}", dueDate),
        command: EDIT_FIELD_VIA_QUICK_PICK_COMMAND,
        arguments: [document.uri, "dueDate" satisfies TicketQuickPickField],
      }),
    ];
  }
}

const formatIsoDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (base: Date, days: number): string => {
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return formatIsoDate(next);
};

export const applyTicketFieldEdit = async (
  document: vscode.TextDocument,
  field: TicketQuickPickField,
  newValue: string,
): Promise<boolean> => {
  const parsed = parseTicketFrontmatterForCodeLens(document.getText());
  if (!parsed) {
    return false;
  }

  const edit = new vscode.WorkspaceEdit();
  const existing = parsed.fieldLines[field];
  if (existing) {
    const lineRange = document.lineAt(existing.line).range;
    edit.replace(
      document.uri,
      lineRange,
      buildYamlFieldLine(field, newValue, existing.prefix),
    );
  } else {
    const insertLine = parsed.issueBlockEndLine;
    const endPos = document.lineAt(insertLine).range.end;
    edit.insert(document.uri, endPos, `\n${buildYamlFieldLine(field, newValue)}`);
  }

  return vscode.workspace.applyEdit(edit);
};

interface FieldQuickPickDeps {
  listTrackers: typeof listTrackers;
  getProjectTrackers: typeof getProjectTrackers;
  listIssueStatuses: typeof listIssueStatuses;
  listIssuePriorities: typeof listIssuePriorities;
}

const defaultDeps: FieldQuickPickDeps = {
  listTrackers,
  getProjectTrackers,
  listIssueStatuses,
  listIssuePriorities,
};

const pickOptionValue = async (
  placeHolder: string,
  options: Array<{ label: string; value: string; description?: string }>,
): Promise<string | undefined> => {
  const picked = await vscode.window.showQuickPick(options, { placeHolder });
  return picked?.value;
};

const pickDateFieldValue = async (
  currentValue: string | undefined,
  selectPlaceHolder: string,
  inputPrompt: string,
): Promise<string | undefined> => {
  const now = new Date();
  const today = formatIsoDate(now);
  const tomorrow = addDays(now, 1);
  const nextWeek = addDays(now, 7);
  const twoWeeks = addDays(now, 14);
  const choice = await pickOptionValue(selectPlaceHolder, [
    { label: today, value: today, description: vscode.l10n.t("Today") },
    { label: tomorrow, value: tomorrow, description: vscode.l10n.t("Tomorrow") },
    { label: nextWeek, value: nextWeek, description: vscode.l10n.t("Next week") },
    { label: twoWeeks, value: twoWeeks, description: vscode.l10n.t("In 2 weeks") },
    { label: vscode.l10n.t("Enter date (YYYY-MM-DD)…"), value: "__custom__" },
    { label: vscode.l10n.t("Clear (Not set)"), value: "" },
  ]);
  if (choice === undefined) {
    return undefined;
  }
  if (choice !== "__custom__") {
    return choice;
  }
  const input = await vscode.window.showInputBox({
    prompt: inputPrompt,
    value: currentValue || today,
    validateInput: (val) =>
      val.trim().length === 0 || DATE_PATTERN.test(val.trim())
        ? undefined
        : vscode.l10n.t("Date must be in YYYY-MM-DD format."),
  });
  return input === undefined ? undefined : input.trim();
};

export const editTicketFieldViaQuickPick = async (
  uriOrField?: vscode.Uri | string,
  fieldArg?: TicketQuickPickField,
  deps: Partial<FieldQuickPickDeps> = {},
): Promise<void> => {
  const resolvedDeps: FieldQuickPickDeps = { ...defaultDeps, ...deps };
  let document: vscode.TextDocument | undefined;
  let field: TicketQuickPickField | undefined = fieldArg;

  if (uriOrField instanceof vscode.Uri) {
    document = await vscode.workspace.openTextDocument(uriOrField);
  } else if (typeof uriOrField === "string") {
    if (Object.prototype.hasOwnProperty.call(FIELD_TO_YAML_KEY, uriOrField)) {
      field = uriOrField as TicketQuickPickField;
      document = vscode.window.activeTextEditor?.document;
    } else {
      document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriOrField));
    }
  } else {
    document = vscode.window.activeTextEditor?.document;
  }

  if (!document) {
    vscode.window.showErrorMessage(vscode.l10n.t("No active editor found."));
    return;
  }

  const parsed = parseTicketFrontmatterForCodeLens(document.getText());
  if (!parsed) {
    vscode.window.showErrorMessage(vscode.l10n.t("Redmine metadata block is missing."));
    return;
  }

  if (!field) {
    const fieldChoice = await pickOptionValue(vscode.l10n.t("Select…"), [
      { label: vscode.l10n.t("Tracker"), value: "tracker" },
      { label: vscode.l10n.t("Status"), value: "status" },
      { label: vscode.l10n.t("Priority"), value: "priority" },
      { label: vscode.l10n.t("Progress: {0}%", parsed.fields.doneRatio ?? "0"), value: "doneRatio" },
      { label: vscode.l10n.t("Start date"), value: "startDate" },
      { label: vscode.l10n.t("Due date"), value: "dueDate" },
    ]);
    if (!fieldChoice) {
      return;
    }
    field = fieldChoice as TicketQuickPickField;
  }

  let selectedValue: string | undefined;

  if (field === "tracker") {
    const trackers = parsed.projectId
      ? await resolvedDeps.getProjectTrackers(parsed.projectId).catch(() => resolvedDeps.listTrackers())
      : await resolvedDeps.listTrackers();
    selectedValue = await pickOptionValue(
      vscode.l10n.t("Select tracker"),
      trackers.map((item) => ({ label: item.name, value: item.name })),
    );
  } else if (field === "status") {
    const statuses = await resolvedDeps.listIssueStatuses();
    selectedValue = await pickOptionValue(
      vscode.l10n.t("Select status"),
      statuses.map((item) => ({ label: item.name, value: item.name })),
    );
  } else if (field === "priority") {
    const priorities = await resolvedDeps.listIssuePriorities();
    selectedValue = await pickOptionValue(
      vscode.l10n.t("Select priority"),
      priorities.map((item) => ({ label: item.name, value: item.name })),
    );
  } else if (field === "doneRatio") {
    const ratios = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    selectedValue = await pickOptionValue(
      vscode.l10n.t("Select progress (%)"),
      ratios.map((ratio) => ({ label: `${ratio}%`, value: String(ratio) })),
    );
  } else if (field === "startDate") {
    selectedValue = await pickDateFieldValue(
      parsed.fields.startDate,
      vscode.l10n.t("Select start date"),
      vscode.l10n.t("Enter start date in YYYY-MM-DD format"),
    );
  } else if (field === "dueDate") {
    selectedValue = await pickDateFieldValue(
      parsed.fields.dueDate,
      vscode.l10n.t("Select due date"),
      vscode.l10n.t("Enter due date in YYYY-MM-DD format"),
    );
  }

  if (selectedValue === undefined) {
    return;
  }

  await applyTicketFieldEdit(document, field, selectedValue);
};
