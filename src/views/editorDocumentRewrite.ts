import * as vscode from "vscode";
import { parseTicketEditorContent, buildTicketEditorContent } from "./ticketEditorContent";
import { withRegisteredTicketControlFields } from "./ticketControlFields";
import { suppressSaveSync, releaseSaveSync } from "./saveSyncSuppression";

const FALLBACK_METADATA = {
  tracker: "",
  priority: "",
  status: "",
  due_date: "",
  children: [] as string[],
};

export const buildRegisteredDocumentContent = (
  currentContent: string,
  createdId: number,
): string => {
  const parsed = parseTicketEditorContent(currentContent, {
    allowMissingMetadata: true,
    fallbackMetadata: FALLBACK_METADATA,
    allowMissingSubject: true,
  });
  const newControlFields = withRegisteredTicketControlFields(
    parsed.controlFields ?? {},
    createdId,
  );
  return buildTicketEditorContent({ ...parsed, controlFields: newControlFields });
};

export type RewriteDocumentDeps = {
  textDocuments?: vscode.TextDocument[];
  applyEdit?: (edit: vscode.WorkspaceEdit) => Promise<boolean>;
  readFile?: (uri: vscode.Uri) => Promise<Uint8Array>;
  writeFile?: (uri: vscode.Uri, content: Uint8Array) => Promise<void>;
};

export const rewriteDocumentWithRegisteredFields = async (
  documentUriString: string,
  createdId: number,
  deps: RewriteDocumentDeps = {},
): Promise<boolean> => {
  const textDocuments = deps.textDocuments ?? vscode.workspace.textDocuments;
  const applyEdit = deps.applyEdit ?? ((edit: vscode.WorkspaceEdit) => vscode.workspace.applyEdit(edit));
  const readFile = deps.readFile ?? ((uri: vscode.Uri) => vscode.workspace.fs.readFile(uri));
  const writeFile = deps.writeFile ?? ((uri: vscode.Uri, content: Uint8Array) =>
    vscode.workspace.fs.writeFile(uri, content));

  const document = textDocuments.find((doc) => doc.uri.toString() === documentUriString);

  if (document) {
    let newContent: string;
    try {
      newContent = buildRegisteredDocumentContent(document.getText(), createdId);
    } catch {
      return false;
    }

    const uri = document.uri;
    suppressSaveSync(documentUriString);
    try {
      const currentText = document.getText();
      const lines = currentText.split("\n");
      const lastLineIndex = Math.max(0, lines.length - 1);
      const lastCharIndex = lines[lastLineIndex].length;
      const fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(lastLineIndex, lastCharIndex),
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, fullRange, newContent);
      return await applyEdit(edit);
    } finally {
      releaseSaveSync(documentUriString);
    }
  }

  const uri = vscode.Uri.parse(documentUriString);
  if (uri.scheme !== "file") {
    return false;
  }

  try {
    const fileContent = await readFile(uri);
    const currentContent = Buffer.from(fileContent).toString("utf8");
    const newContent = buildRegisteredDocumentContent(currentContent, createdId);
    await writeFile(uri, Buffer.from(newContent, "utf8"));
    return true;
  } catch {
    return false;
  }
};
