import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { TicketEditorContent } from "../ticketEditorContent";
import type { FrontmatterControlFields } from "../ticketMetadataControlFields";
import { buildTicketEditorContent } from "../ticketEditorContent";
import { applyEditorContent } from "../ticketPreview";
import {
  registerTicketDocument,
  registerTicketEditor,
  removeTicketEditorByDocument,
  removeTicketEditorByUri,
  setEditorDisplaySource,
} from "../ticketEditorRegistry";
import { releaseSaveSync, suppressSaveSync } from "../saveSyncSuppression";
import { withRegisteredTicketControlFields } from "../ticketControlFields";
import { updateDraftAfterSave } from "../ticketDraftStore";
import { buildDirectTicketFilename, isNewTicketDraftFilename } from "../editorFilename";
import { getOfflineSyncQueue } from "../offlineSyncStore";

export interface RewriteNewTicketEditorInput {
  operationScope?: string;
  editor: vscode.TextEditor;
  createdId: number;
  projectId: number;
  parsed: TicketEditorContent;
  originalControlFields?: FrontmatterControlFields;
  lastKnownRemoteUpdatedAt?: string;
  applyContent?: (editor: vscode.TextEditor, content: string) => Promise<void>;
}

export const rewriteNewTicketEditorToTicketMode = async (
  input: RewriteNewTicketEditorInput,
): Promise<void> => {
  removeTicketEditorByDocument(input.editor.document);
  registerTicketEditor(
    input.createdId,
    input.editor,
    "primary",
    "ticket",
    input.projectId,
    input.operationScope,
  );
  setEditorDisplaySource(input.editor, "saved");
  updateDraftAfterSave(
    input.createdId,
    input.parsed.subject,
    input.parsed.description,
    input.parsed.metadata,
    input.lastKnownRemoteUpdatedAt,
    input.operationScope,
  );

  const newControlFields = withRegisteredTicketControlFields(
    input.originalControlFields ?? {},
    input.createdId,
    input.projectId,
  );
  const newContent = buildTicketEditorContent({
    subject: input.parsed.subject,
    description: input.parsed.description,
    metadata: input.parsed.metadata,
    layout: input.parsed.layout,
    metadataBlock: input.parsed.metadataBlock,
    controlFields: newControlFields,
  });
  const uriString = input.editor.document.uri.toString();
  suppressSaveSync(uriString);
  try {
    const doApply = input.applyContent ?? applyEditorContent;
    await doApply(input.editor, newContent);
    if (input.editor.document.isDirty) {
      await input.editor.document.save();
    }
  } finally {
    releaseSaveSync(uriString);
  }
};

export const renameSyncedNewTicketFileIfEligible = async (input: {
  oldUri: vscode.Uri;
  ticketId: number;
  projectId?: number;
  connectionScope: string;
}): Promise<vscode.Uri> => {
  if (input.oldUri.scheme !== "file") {
    return input.oldUri;
  }
  const oldFsPath = input.oldUri.fsPath;
  if (!isNewTicketDraftFilename(path.basename(oldFsPath)) || !fs.existsSync(oldFsPath)) {
    return input.oldUri;
  }
  if (getOfflineSyncQueue(input.connectionScope).tickets.has(input.ticketId)) {
    return input.oldUri;
  }
  const targetUri = vscode.Uri.file(
    path.join(path.dirname(oldFsPath), buildDirectTicketFilename(input.ticketId)),
  );
  if (targetUri.fsPath === oldFsPath || fs.existsSync(targetUri.fsPath)) {
    return input.oldUri;
  }

  const oldUriStr = input.oldUri.toString();
  const targetUriStr = targetUri.toString();
  suppressSaveSync(oldUriStr);
  suppressSaveSync(targetUriStr);
  try {
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(input.oldUri, targetUri, { overwrite: false });
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return input.oldUri;
    }
    removeTicketEditorByUri(input.oldUri);
    const renamedDoc = vscode.workspace.textDocuments.find(
      (doc) => doc.uri.toString() === targetUriStr || doc.uri.fsPath === targetUri.fsPath,
    );
    if (renamedDoc) {
      registerTicketDocument(
        input.ticketId,
        renamedDoc,
        "ticket",
        input.projectId,
        input.connectionScope,
      );
    }
    return targetUri;
  } catch (error) {
    console.error("[vs-redmine-client] Failed to rename synced new ticket file", error);
    return input.oldUri;
  } finally {
    releaseSaveSync(oldUriStr);
    releaseSaveSync(targetUriStr);
  }
};
