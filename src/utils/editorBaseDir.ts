import * as path from "path";
import * as vscode from "vscode";
import { getEditorStorageDirectory } from "../config/settings";

export const resolveEditorBaseDir = (input: {
  editor?: vscode.TextEditor;
  documentUri?: vscode.Uri;
} = {}): string | undefined => {
  const uri = input.editor?.document.uri ?? input.documentUri;
  const configured = getEditorStorageDirectory();
  if (uri?.scheme === "file") {
    return path.dirname(uri.fsPath);
  }
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (configured && path.isAbsolute(configured)) {
    return configured;
  }
  if (uri?.scheme === "untitled") {
    return workspace
      ? path.join(workspace.uri.fsPath, ".redmine-client", "editors")
      : undefined;
  }
  return workspace ? workspace.uri.fsPath : undefined;
};
