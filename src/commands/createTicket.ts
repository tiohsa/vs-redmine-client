import * as vscode from "vscode";
import { getDefaultProjectId } from "../config/settings";
import type { IssueUploadInput } from "../redmine/issues";
import { convertMermaidBlocks } from "../utils/mermaid";
import { showError, showInfo, showWarning } from "../utils/notifications";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { createTicketSyncService, type TicketSyncService } from "../app/ticketSync";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { getTicketEditorDefaults } from "../views/ticketEditorDefaultsStore";
import { applyEditorContent } from "../views/ticketPreview";
import type { IssueAttachmentSource } from "../app/ticketSync/syncOperationTypes";

const promptForSubject = async (): Promise<string | undefined> =>
  vscode.window.showInputBox({
    prompt: vscode.l10n.t("Enter ticket subject"),
    placeHolder: vscode.l10n.t("Short summary"),
  });

const promptForAttachments = async (): Promise<IssueAttachmentSource[]> => {
  const choice = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t("Attach files"), value: "files" },
      { label: vscode.l10n.t("Attach clipboard image"), value: "clipboard" },
      { label: vscode.l10n.t("Skip attachments"), value: "skip" },
    ],
    { placeHolder: vscode.l10n.t("Choose attachment source") },
  );

  if (!choice || choice.value === "skip") {
    return [];
  }

  if (choice.value === "files") {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: { Images: ["png", "jpg", "jpeg", "gif"] },
    });

    if (!files || files.length === 0) {
      return [];
    }

    return files.map((file) => ({
      kind: "file" as const,
      filePath: file.fsPath,
    }));
  }

  return [
    {
      kind: "clipboard" as const,
    },
  ];
};

export interface CreateTicketDependencies {
  createTicketSyncService?: () => Pick<TicketSyncService, "syncEditor">;
  getActiveEditor?: () => vscode.TextEditor | undefined;
  promptSubject?: () => Promise<string | undefined>;
  promptAttachments?: () => Promise<Array<IssueAttachmentSource | IssueUploadInput>>;
  getDefaultProjectId?: () => string;
}

export const createTicketFromEditor = async (
  deps: CreateTicketDependencies = {},
): Promise<void> => {
  const editor = deps.getActiveEditor?.() ?? vscode.window.activeTextEditor;
  if (!editor) {
    showError(vscode.l10n.t("No active editor found."));
    return;
  }

  const projectIdRaw = (deps.getDefaultProjectId ?? getDefaultProjectId)();
  const projectId = Number(projectIdRaw);
  if (!projectIdRaw || Number.isNaN(projectId)) {
    showError(vscode.l10n.t("Set a default project ID before creating tickets."));
    return;
  }

  const subject = await (deps.promptSubject ?? promptForSubject)();
  if (!subject) {
    return;
  }

  const description = convertMermaidBlocks(editor.document.getText());
  const attachments = await (deps.promptAttachments ?? promptForAttachments)();

  const editorDefaults = getTicketEditorDefaults();
  const formattedContent = buildTicketEditorContent({
    subject,
    description,
    metadata: editorDefaults.metadata,
    controlFields: {
      mode: "new-ticket",
      issue_id: null,
      project_id: projectId,
    },
  });

  await applyEditorContent(editor, formattedContent);

  const operationScope = getCurrentConnectionScope();
  const syncService = deps.createTicketSyncService?.() ?? createTicketSyncService();

  try {
    const outcome = await syncService.syncEditor({
      context: { connectionScope: operationScope },
      editor,
      ticketId: 0,
      newTicket: true,
      manual: false,
      projectId,
      uploads: attachments as any,
      attachments: attachments as any,
    });

    if (outcome.kind === "completed") {
      showInfo(vscode.l10n.t("Ticket created successfully."));
    } else if (outcome.kind === "remote_committed") {
      showWarning(outcome.message ?? vscode.l10n.t("Ticket was created, but local finalization is pending."));
    } else if (outcome.kind === "commit_unknown") {
      showWarning(outcome.message);
    } else if (outcome.kind === "failed_before_commit") {
      showError(outcome.error.message);
    } else {
      showError(vscode.l10n.t("Ticket creation did not complete."));
    }
  } catch (error) {
    showError((error as Error).message);
  }
};

