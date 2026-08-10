import * as vscode from "vscode";
import { parseTicketEditorContent, buildTicketEditorContent, TicketEditorContent } from "./ticketEditorContent";
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
  projectId?: number,
  replacement?: TicketEditorContent,
): string => {
  const parsed = parseTicketEditorContent(currentContent, {
    allowMissingMetadata: true,
    fallbackMetadata: FALLBACK_METADATA,
    allowMissingSubject: true,
  });
  const newControlFields = withRegisteredTicketControlFields(
    parsed.controlFields ?? {},
    createdId,
    projectId,
  );
  return buildTicketEditorContent({
    ...(replacement ?? parsed),
    layout: replacement?.layout ?? parsed.layout,
    metadataBlock: replacement?.metadataBlock ?? parsed.metadataBlock,
    controlFields: newControlFields,
  });
};

export type RewriteDocumentDeps = {
  textDocuments?: vscode.TextDocument[];
  applyEdit?: (edit: vscode.WorkspaceEdit) => Promise<boolean>;
  readFile?: (uri: vscode.Uri) => Promise<Uint8Array>;
  writeFile?: (uri: vscode.Uri, content: Uint8Array) => Promise<void>;
  saveDocument?: (document: vscode.TextDocument) => Promise<boolean>;
};

export const rewriteDocumentWithRegisteredFields = async (
  documentUriString: string,
  createdId: number,
  deps: RewriteDocumentDeps = {},
  projectId?: number,
  replacement?: TicketEditorContent,
): Promise<boolean> => {
  const textDocuments = deps.textDocuments ?? vscode.workspace.textDocuments;
  const applyEdit = deps.applyEdit ?? ((edit: vscode.WorkspaceEdit) => vscode.workspace.applyEdit(edit));
  const readFile = deps.readFile ?? ((uri: vscode.Uri) => vscode.workspace.fs.readFile(uri));
  const writeFile = deps.writeFile ?? ((uri: vscode.Uri, content: Uint8Array) =>
    vscode.workspace.fs.writeFile(uri, content));
  const saveDocument = deps.saveDocument ?? ((target: vscode.TextDocument) => target.save());

  const document = textDocuments.find((doc) => doc.uri.toString() === documentUriString);

  if (document) {
    let newContent: string;
    try {
      newContent = buildRegisteredDocumentContent(
        document.getText(),
        createdId,
        projectId,
        replacement,
      );
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
      const changed = await applyEdit(edit);
      if (!changed) {
        return false;
      }
      if (document.isDirty && !(await saveDocument(document))) {
        return false;
      }
      return true;
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
    const newContent = buildRegisteredDocumentContent(
      currentContent,
      createdId,
      projectId,
      replacement,
    );
    await writeFile(uri, Buffer.from(newContent, "utf8"));
    return true;
  } catch {
    return false;
  }
};
