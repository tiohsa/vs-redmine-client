import * as path from "path";
import * as vscode from "vscode";
import { getProjectSelection } from "../config/projectSelection";
import { getDefaultProjectId } from "../config/settings";
import { getTicketEditorDefaults } from "../views/ticketEditorDefaultsStore";
import { buildRedmineTicketFrontmatterContent } from "../views/redmineTicketFrontmatterTemplate";
import { applyEditorContent } from "../views/ticketPreview";
import { showError, showSuccess, showWarning } from "../utils/notifications";

export type InsertFrontmatterDeps = {
  getActiveEditor: () => vscode.TextEditor | undefined;
  getProjectSelection: typeof getProjectSelection;
  getDefaultProjectId: typeof getDefaultProjectId;
  getTicketEditorDefaults: typeof getTicketEditorDefaults;
  buildFrontmatterContent: typeof buildRedmineTicketFrontmatterContent;
  applyContent: typeof applyEditorContent;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showSuccess: (message: string) => void;
  confirmReplacement: (message: string) => Promise<boolean>;
};

const defaultDeps: InsertFrontmatterDeps = {
  getActiveEditor: () => vscode.window.activeTextEditor,
  getProjectSelection,
  getDefaultProjectId,
  getTicketEditorDefaults,
  buildFrontmatterContent: buildRedmineTicketFrontmatterContent,
  applyContent: applyEditorContent,
  showError,
  showWarning,
  showSuccess,
  confirmReplacement: async (message) => {
    const replaceOption = vscode.l10n.t("Replace");
    const response = await vscode.window.showWarningMessage(
      vscode.l10n.t(message),
      { modal: true },
      replaceOption
    );
    return response === replaceOption;
  },
};

const isMarkdownEditor = (editor: vscode.TextEditor): boolean =>
  editor.document.languageId === "markdown" ||
  path.extname(editor.document.uri.path).toLowerCase() === ".md";

/**
 * Markdownファイルに対してRedmineチケット用のFrontmatterを挿入するコマンドハンドラー。
 */
export const insertRedmineTicketFrontmatter = async (
  deps: InsertFrontmatterDeps = defaultDeps
): Promise<void> => {
  const editor = deps.getActiveEditor();
  if (!editor) {
    deps.showError(vscode.l10n.t("Open a Markdown file before inserting Redmine ticket frontmatter."));
    return;
  }
  if (!isMarkdownEditor(editor)) {
    deps.showError(vscode.l10n.t("Open a Markdown file before inserting Redmine ticket frontmatter."));
    return;
  }

  // 1. プロジェクトIDを解決
  const selection = deps.getProjectSelection();
  let projectId: number | undefined;
  if (selection.id !== undefined) {
    projectId = selection.id;
  } else {
    const defaultProj = deps.getDefaultProjectId();
    if (defaultProj) {
      const parsed = Number(defaultProj);
      if (!Number.isNaN(parsed)) {
        projectId = parsed;
      }
    }
  }

  // 2. デフォルト値を解決 (tracker, priority, status)
  const defaults = deps.getTicketEditorDefaults();
  const tracker = (defaults.metadata.tracker && defaults.metadata.tracker.trim()) || "Task";
  const priority = (defaults.metadata.priority && defaults.metadata.priority.trim()) || "Normal";
  const status = (defaults.metadata.status && defaults.metadata.status.trim()) || "New";

  const content = editor.document.getText();
  const result = deps.buildFrontmatterContent({
    content,
    projectId,
    tracker,
    priority,
    status,
  });

  if (result.status === "blocked") {
    // blockedのメッセージをローカライズ
    const linkedMatch = /^This file is already linked to Redmine ticket #([^\s]+)\.$/.exec(result.message);
    if (linkedMatch) {
      deps.showError(vscode.l10n.t("This file is already linked to Redmine ticket #{0}.", linkedMatch[1]));
    } else {
      deps.showError(vscode.l10n.t(result.message));
    }
    return;
  }

  if (result.status === "replaceRequired") {
    const confirmed = await deps.confirmReplacement(result.message);
    if (!confirmed) {
      return;
    }
    await deps.applyContent(editor, result.content);
    deps.showSuccess(vscode.l10n.t("Redmine ticket frontmatter inserted."));
    return;
  }

  if (result.status === "inserted") {
    await deps.applyContent(editor, result.content);
    deps.showSuccess(vscode.l10n.t("Redmine ticket frontmatter inserted."));
    return;
  }
};
