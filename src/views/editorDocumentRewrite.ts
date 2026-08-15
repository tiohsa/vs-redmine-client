import * as vscode from "vscode";
import { parseTicketEditorContent, buildTicketEditorContent, TicketEditorContent } from "./ticketEditorContent";
import { withRegisteredTicketControlFields } from "./ticketControlFields";
import { suppressSaveSync, releaseSaveSync } from "./saveSyncSuppression";
import { applyEditorContent } from "./ticketPreview";
import type {
  DocumentApplyResult,
  DocumentFreshnessExpectation,
} from "../app/ticketSync/ports";

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
    metadata: replacement?.metadata ?? parsed.metadata,
    layout: replacement?.layout ?? parsed.layout,
    metadataBlock: replacement?.metadataBlock ?? "present",
    controlFields: newControlFields,
  });
};

export type RewriteDocumentDeps = {
  textDocuments?: vscode.TextDocument[];
  textEditors?: vscode.TextEditor[];
  applyEdit?: (edit: vscode.WorkspaceEdit) => Promise<boolean>;
  readFile?: (uri: vscode.Uri) => Promise<Uint8Array>;
  writeFile?: (uri: vscode.Uri, content: Uint8Array) => Promise<void>;
  saveDocument?: (document: vscode.TextDocument) => Promise<boolean>;
};

export const compareAndRewriteDocumentWithRegisteredFields = async (input: {
  documentUri: string;
  ticketId: number;
  deps?: RewriteDocumentDeps;
  projectId?: number;
  replacement: TicketEditorContent;
  expected: DocumentFreshnessExpectation;
}): Promise<DocumentApplyResult> => {
  const deps = input.deps ?? {};
  const textDocuments = deps.textDocuments ?? vscode.workspace.textDocuments;
  const textEditors = deps.textEditors ?? vscode.window.visibleTextEditors;
  const saveDocument = deps.saveDocument ?? ((target: vscode.TextDocument) => target.save());
  const document = textDocuments.find((doc) => doc.uri.toString() === input.documentUri);

  if (document) {
    if (document.getText() !== input.expected.content) {
      return { kind: "stale_source" };
    }
    let newContent: string;
    try {
      newContent = buildRegisteredDocumentContent(
        input.expected.content,
        input.ticketId,
        input.projectId,
        input.replacement,
      );
    } catch {
      return { kind: "write_failed" };
    }
    if (newContent === input.expected.content) {
      return { kind: "applied" };
    }

    suppressSaveSync(input.documentUri);
    try {
      if (document.getText() !== input.expected.content) {
        return { kind: "stale_source" };
      }
      const editor = textEditors.find(
        (candidate) => candidate.document.uri.toString() === input.documentUri,
      );
      if (!editor) {
        return { kind: "not_available" };
      }
      try {
        await applyEditorContent(editor, newContent);
      } catch {
        return document.getText() === input.expected.content
          ? { kind: "write_failed" }
          : { kind: "stale_source" };
      }
      if (document.getText() !== newContent) {
        return { kind: "stale_source" };
      }
      if (document.isDirty && !(await saveDocument(document))) {
        return { kind: "save_failed" };
      }
      if (document.getText() !== newContent) {
        return { kind: "stale_source" };
      }
      return { kind: "applied" };
    } finally {
      releaseSaveSync(input.documentUri);
    }
  }

  // VS Code does not provide a versioned compare-and-write for closed files.
  // Defer until the document is open rather than permit a read/write TOCTOU overwrite.
  return { kind: "not_available" };
};

export const rewriteDocumentWithRegisteredFields = async (
  documentUriString: string,
  createdId: number,
  deps: RewriteDocumentDeps = {},
  projectId?: number,
  replacement?: TicketEditorContent,
): Promise<boolean> => {
  const textDocuments = deps.textDocuments ?? vscode.workspace.textDocuments;
  const textEditors = deps.textEditors ?? vscode.window.visibleTextEditors;
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
      const editor = textEditors.find(
        (candidate) => candidate.document.uri.toString() === documentUriString,
      );
      if (editor) {
        try {
          await applyEditorContent(editor, newContent);
        } catch {
          return false;
        }
      } else {
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
