import * as path from "path";
import * as vscode from "vscode";
import { resolveEditorBaseDir } from "../utils/editorBaseDir";
import { showError, showSuccess, showWarning } from "../utils/notifications";
import { applyEditorContent } from "../views/ticketPreview";
import { registerTicketDocument } from "../views/ticketEditorRegistry";
import {
  createTicketFromMarkdownContent,
  previewMarkdownTicketCreation,
  type MarkdownTicketCreatePreview,
  type MarkdownTicketCreateResult,
} from "../views/markdownTicketCreateService";

type CreateTicketFromMarkdownHeaderDeps = {
  getActiveEditor: () => vscode.TextEditor | undefined;
  previewCreation: (content: string) => MarkdownTicketCreatePreview;
  confirmCreation: (preview: MarkdownTicketCreatePreview) => Promise<boolean>;
  createTicket: typeof createTicketFromMarkdownContent;
  applyContent: typeof applyEditorContent;
  registerTicketDocument: (
    issueId: number,
    document: vscode.TextDocument,
    contentType?: "ticket",
    projectId?: number,
  ) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showSuccess: (message: string) => void;
  resolveBaseDir: (editor: vscode.TextEditor) => string | undefined;
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
  createTicket: createTicketFromMarkdownContent,
  applyContent: applyEditorContent,
  registerTicketDocument,
  showError,
  showWarning,
  showSuccess,
  resolveBaseDir: (editor) => resolveEditorBaseDir({ editor }),
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
  deps: CreateTicketFromMarkdownHeaderDeps = defaultDeps,
): Promise<void> => {
  const editor = deps.getActiveEditor();
  if (!editor) {
    deps.showError(vscode.l10n.t("No active editor found."));
    return;
  }
  if (!isMarkdownEditor(editor)) {
    deps.showError(vscode.l10n.t("Open a Markdown file before creating a Redmine ticket."));
    return;
  }

  const content = editor.document.getText();
  let preview: MarkdownTicketCreatePreview;
  try {
    preview = deps.previewCreation(content);
  } catch (error) {
    deps.showError(
      error instanceof Error
        ? localizeCreationError(error.message)
        : vscode.l10n.t("Invalid metadata."),
    );
    return;
  }

  if (!await deps.confirmCreation(preview)) {
    return;
  }

  let result: MarkdownTicketCreateResult;
  try {
    result = await deps.createTicket({
      content,
      projectId: preview.projectId,
      baseDir: deps.resolveBaseDir(editor),
    });
  } catch (error) {
    deps.showError(error instanceof Error ? error.message : vscode.l10n.t("An unexpected error occurred."));
    return;
  }
  if (result.status === "failed") {
    deps.showError(localizeCreationError(result.message));
    return;
  }
  if (result.status === "header-update-failed") {
    deps.showWarning(createFailureWarning(result.issueId));
    return;
  }

  try {
    await deps.applyContent(editor, result.updatedContent);
    if (editor.document.isDirty) {
      const saved = await editor.document.save();
      if (!saved) {
        throw new Error("Markdown save failed.");
      }
    }
  } catch {
    deps.showWarning(createFailureWarning(result.issueId));
    return;
  }

  deps.registerTicketDocument(result.issueId, editor.document, "ticket", result.preview.projectId);
  deps.showSuccess(vscode.l10n.t("Redmine ticket created (#{0}).", result.issueId));
};
