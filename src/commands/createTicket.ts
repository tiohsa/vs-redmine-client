import * as vscode from "vscode";
import { getDefaultProjectId } from "../config/settings";
import { uploadClipboardImage, uploadFileAttachment } from "../redmine/attachments";
import { createIssue, IssueUploadInput } from "../redmine/issues";
import { convertMermaidBlocks } from "../utils/mermaid";
import { showError, showInfo } from "../utils/notifications";

const promptForSubject = async (): Promise<string | undefined> =>
  vscode.window.showInputBox({
    prompt: vscode.l10n.t("Enter ticket subject"),
    placeHolder: vscode.l10n.t("Short summary"),
  });

const promptForAttachments = async (): Promise<IssueUploadInput[]> => {
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

    const uploads = await Promise.all(
      files.map((file) => uploadFileAttachment(file.fsPath)),
    );

    return uploads.map((upload) => ({
      token: upload.token,
      filename: upload.filename,
      content_type: upload.contentType,
    }));
  }

  const upload = await uploadClipboardImage();
  return [
    {
      token: upload.token,
      filename: upload.filename,
      content_type: upload.contentType,
    },
  ];
};

export const createTicketFromEditor = async (): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    showError(vscode.l10n.t("No active editor found."));
    return;
  }

  const projectIdRaw = getDefaultProjectId();
  const projectId = Number(projectIdRaw);
  if (!projectIdRaw || Number.isNaN(projectId)) {
    showError(vscode.l10n.t("Set a default project ID before creating tickets."));
    return;
  }

  const subject = await promptForSubject();
  if (!subject) {
    return;
  }

  const description = convertMermaidBlocks(editor.document.getText());
  const uploads = await promptForAttachments();

  try {
    await createIssue({
      projectId,
      subject,
      description,
      uploads,
    });
    showInfo(vscode.l10n.t("Ticket created successfully."));
  } catch (error) {
    showError((error as Error).message);
  }
};
