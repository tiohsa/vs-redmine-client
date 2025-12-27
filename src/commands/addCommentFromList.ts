import * as fs from "fs";
import * as vscode from "vscode";
import { showError } from "../utils/notifications";
import {
  getNewCommentDraftUri,
  registerNewCommentDraft,
} from "../views/ticketEditorRegistry";
import { buildUniqueUntitledPath } from "../views/untitledPath";

export const addCommentFromList = async (ticketId?: number): Promise<void> => {
  if (!ticketId) {
    showError("Select a ticket before adding a comment.");
    return;
  }

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.path;
  const filename = `todoex-new-comment-${ticketId}.md`;
  const targetPath = workspacePath
    ? buildUniqueUntitledPath(workspacePath, filename, fs.existsSync)
    : filename;
  const draftUri =
    getNewCommentDraftUri(ticketId) ?? vscode.Uri.parse(`untitled:${targetPath}`);
  const existing = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === draftUri.toString(),
  );
  const document = existing ?? (await vscode.workspace.openTextDocument(draftUri));
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  registerNewCommentDraft(ticketId, editor);
};
