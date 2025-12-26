import * as fs from "fs";
import * as vscode from "vscode";
import { getNewTicketDraftUri, registerNewTicketDraft } from "../views/ticketEditorRegistry";
import { buildUniqueUntitledPath } from "../views/untitledPath";

const DRAFT_FILENAME = "todoex-new-ticket.md";

const findOpenDocument = (uri: vscode.Uri): vscode.TextDocument | undefined =>
  vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  );

const getWorkspacePath = (): string | undefined =>
  vscode.workspace.workspaceFolders?.[0]?.uri.path;

export const buildNewTicketDraftUri = (
  workspacePath?: string,
  existsSync: (candidate: string) => boolean = fs.existsSync,
): vscode.Uri => {
  if (!workspacePath) {
    return vscode.Uri.parse(`untitled:${DRAFT_FILENAME}`);
  }

  const targetPath = buildUniqueUntitledPath(workspacePath, DRAFT_FILENAME, existsSync);
  return vscode.Uri.parse(`untitled:${targetPath}`);
};

export const createTicketFromList = async (): Promise<void> => {
  const knownUri =
    getNewTicketDraftUri() ?? buildNewTicketDraftUri(getWorkspacePath());
  const existing = findOpenDocument(knownUri);
  const document = existing ?? (await vscode.workspace.openTextDocument(knownUri));
  const editor = await vscode.window.showTextDocument(document, { preview: false });

  registerNewTicketDraft(editor);
};
