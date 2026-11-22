import * as vscode from "vscode";
import { resolveEditorBaseDir } from "../../utils/editorBaseDir";

export const resolveIntentBaseDir = (intent: {
  baseDir?: string;
  documentUri?: string;
}): string | undefined => {
  if (intent.baseDir) {
    return intent.baseDir;
  }
  if (!intent.documentUri) {
    return undefined;
  }
  return resolveEditorBaseDir({ documentUri: vscode.Uri.parse(intent.documentUri) });
};
