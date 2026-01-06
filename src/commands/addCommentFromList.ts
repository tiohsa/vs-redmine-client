import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getEditorStorageDirectory } from "../config/settings";
import { showError } from "../utils/notifications";
import {
  getNewCommentDraftUri,
  registerNewCommentDraft,
} from "../views/ticketEditorRegistry";
import { buildUniqueUntitledName, buildUniqueUntitledPath } from "../views/untitledPath";

const getOpenUntitledNames = (): Set<string> =>
  new Set(
    vscode.workspace.textDocuments
      .filter((doc) => doc.uri.scheme === "untitled")
      .map((doc) => path.posix.basename(doc.uri.path.replace(/\\/g, "/"))),
  );

export const addCommentFromList = async (ticketId?: number): Promise<void> => {
  if (!ticketId) {
    showError("Select a ticket before adding a comment.");
    return;
  }

  const configured = getEditorStorageDirectory();
  const workspacePath =
    configured && path.isAbsolute(configured)
      ? configured
      : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const filename = `redmine-client-new-comment-${ticketId}.md`;
  const targetPath = workspacePath
    ? buildUniqueUntitledPath(workspacePath, filename, fs.existsSync)
    : buildUniqueUntitledName(filename, (candidate) =>
      getOpenUntitledNames().has(candidate),
    );
  const draftUri =
    getNewCommentDraftUri(ticketId) ??
    (workspacePath
      ? vscode.Uri.file(targetPath).with({ scheme: "untitled" })
      : vscode.Uri.parse(`untitled:${targetPath}`));
  const existing = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === draftUri.toString(),
  );
  const document = existing ?? (await vscode.workspace.openTextDocument(draftUri));
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  registerNewCommentDraft(ticketId, editor);
};
