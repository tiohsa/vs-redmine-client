import * as fs from "fs";
import * as vscode from "vscode";
import { getDefaultProjectId } from "../config/settings";
import { getProjectSelection } from "../config/projectSelection";
import {
  getNewTicketDraftUri,
  registerNewTicketDraft,
  setEditorProjectId,
} from "../views/ticketEditorRegistry";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { applyEditorContent } from "../views/ticketPreview";
import { buildUniqueUntitledPath } from "../views/untitledPath";
import { buildNewTicketDraftContent } from "../views/ticketDraftStore";

const DRAFT_FILENAME = "todoex-new-ticket.md";

const findOpenDocument = (uri: vscode.Uri): vscode.TextDocument | undefined =>
  vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  );

const getWorkspacePath = (): string | undefined =>
  vscode.workspace.workspaceFolders?.[0]?.uri.path;

const buildNewTicketTemplate = (): string =>
  buildTicketEditorContent({
    ...buildNewTicketDraftContent(),
  });

const resolveProjectId = (): number | undefined => {
  const selection = getProjectSelection();
  if (selection.id) {
    return selection.id;
  }

  const fallback = Number(getDefaultProjectId());
  return Number.isNaN(fallback) ? undefined : fallback;
};

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
  const projectId = resolveProjectId();
  if (projectId) {
    setEditorProjectId(editor, projectId);
  }

  if (document.getText().trim().length === 0) {
    await applyEditorContent(editor, buildNewTicketTemplate());
  }
};
