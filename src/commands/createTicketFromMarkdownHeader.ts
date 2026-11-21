import * as path from "path";
import * as vscode from "vscode";
import { resolveEditorBaseDir } from "../utils/editorBaseDir";
import { showError, showSuccess, showWarning } from "../utils/notifications";
import {
  previewMarkdownTicketCreation,
  type MarkdownTicketCreatePreview,
} from "../views/markdownTicketCreateService";
import { getCurrentConnectionScope } from "../config/connectionScope";
import {
  createTicketSyncService,
  type TicketSyncOutcome,
} from "../app/ticketSync";

type CreateTicketFromMarkdownHeaderDeps = {
  getActiveEditor: () => vscode.TextEditor | undefined;
  previewCreation: (content: string) => MarkdownTicketCreatePreview;
  confirmCreation: (preview: MarkdownTicketCreatePreview) => Promise<boolean>;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showSuccess: (message: string) => void;
  resolveBaseDir: (editor: vscode.TextEditor) => string | undefined;
  syncTicket: (input: {
    editor: vscode.TextEditor;
    content: string;
    projectId: number;
    baseDir?: string;
    connectionScope: string;
  }) => Promise<TicketSyncOutcome>;
  onTicketCreated?: (ticketId: number, connectionScope: string) => void | Promise<void>;
};

const confirmCreation = async (preview: MarkdownTicketCreatePreview): Promise<boolean> => {
  const message = vscode.l10n.t(
    "Create Redmine ticket?\n\nProject ID: {0}\nSubject: {1}\nTracker: {2}\nPriority: {3}\nStatus: {4}",
    preview.projectId,
    preview.subject,
    preview.tracker,
    preview.priority,
    preview.status,
  );
  return await vscode.window.showWarningMessage(
    message,
    { modal: true },
    vscode.l10n.t("Create"),
    vscode.l10n.t("Cancel"),
  ) === vscode.l10n.t("Create");
};

const defaultDeps: CreateTicketFromMarkdownHeaderDeps = {
  getActiveEditor: () => vscode.window.activeTextEditor,
  previewCreation: previewMarkdownTicketCreation,
  confirmCreation,
  showError,
  showWarning,
  showSuccess,
  resolveBaseDir: (editor) => resolveEditorBaseDir({ editor }),
  syncTicket: ({ editor, projectId, connectionScope }) =>
    createTicketSyncService().syncEditor({
      context: { connectionScope },
      editor,
      ticketId: 0,
      newTicket: true,
      manual: false,
      projectId,
    }),
};

const isMarkdownEditor = (editor: vscode.TextEditor): boolean =>
  editor.document.languageId === "markdown" ||
  path.extname(editor.document.uri.path).toLowerCase() === ".md";

const createFailureWarning = (issueId: number): string =>
  `${vscode.l10n.t("Redmine ticket created (#{0}), but failed to update the Markdown header.", issueId)} ${vscode.l10n.t("Add issue_id: {0} manually to prevent duplicate creation.", issueId)}`;

const localizeCreationError = (message: string): string => {
  const existingIssue = /^Already linked to Redmine ticket #(.*)\.$/.exec(message);
  if (existingIssue) {
    return vscode.l10n.t("Already linked to Redmine ticket #{0}.", existingIssue[1]);
  }
  const unsupportedMode = /^Unsupported mode for ticket creation: (.*)$/.exec(message);
  if (unsupportedMode) {
    return vscode.l10n.t("Unsupported mode for ticket creation: {0}", unsupportedMode[1]);
  }
  return vscode.l10n.t(message);
};

export const createTicketFromMarkdownHeader = async (
  deps: Partial<CreateTicketFromMarkdownHeaderDeps> = {},
): Promise<void> => {
  const resolvedDeps: CreateTicketFromMarkdownHeaderDeps = { ...defaultDeps, ...deps };
  const editor = resolvedDeps.getActiveEditor();
  if (!editor) {
    resolvedDeps.showError(vscode.l10n.t("No active editor found."));
    return;
  }
  if (!isMarkdownEditor(editor)) {
    resolvedDeps.showError(vscode.l10n.t("Open a Markdown file before creating a Redmine ticket."));
    return;
  }

  const content = editor.document.getText();
  const operationScope = getCurrentConnectionScope();
  let preview: MarkdownTicketCreatePreview;
  try {
    preview = resolvedDeps.previewCreation(content);
  } catch (error) {
    resolvedDeps.showError(
      error instanceof Error
        ? localizeCreationError(error.message)
        : vscode.l10n.t("Invalid metadata."),
    );
    return;
  }

  if (!await resolvedDeps.confirmCreation(preview)) {
    return;
  }

  let outcome: TicketSyncOutcome;
  try {
    outcome = await resolvedDeps.syncTicket({
      editor,
      content,
      projectId: preview.projectId,
      baseDir: resolvedDeps.resolveBaseDir(editor),
      connectionScope: operationScope,
    });
  } catch (error) {
    resolvedDeps.showError(error instanceof Error
      ? error.message
      : vscode.l10n.t("An unexpected error occurred."));
    return;
  }
  if (outcome.kind === "completed") {
    if (outcome.ticketId > 0 && resolvedDeps.onTicketCreated) {
      try {
        await resolvedDeps.onTicketCreated(outcome.ticketId, operationScope);
      } catch {
      }
    }
    resolvedDeps.showSuccess(vscode.l10n.t("Redmine ticket created (#{0}).", outcome.ticketId));
  } else if (outcome.kind === "remote_committed") {
    resolvedDeps.showWarning(outcome.message ?? createFailureWarning(outcome.ticketId));
  } else if (outcome.kind === "commit_unknown") {
    resolvedDeps.showWarning(outcome.message);
  } else if (outcome.kind === "failed_before_commit") {
    resolvedDeps.showError(localizeCreationError(outcome.error.message));
  } else {
    resolvedDeps.showError(vscode.l10n.t("Ticket creation did not complete."));
  }
};
