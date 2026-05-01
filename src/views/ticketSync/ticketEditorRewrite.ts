import * as vscode from "vscode";
import type { TicketEditorContent } from "../ticketEditorContent";
import type { FrontmatterControlFields } from "../ticketMetadataControlFields";
import { buildTicketEditorContent } from "../ticketEditorContent";
import { applyEditorContent } from "../ticketPreview";
import { registerTicketEditor, removeTicketEditorByDocument, setEditorDisplaySource } from "../ticketEditorRegistry";
import { releaseSaveSync, suppressSaveSync } from "../saveSyncSuppression";
import { withRegisteredTicketControlFields } from "../ticketControlFields";
import { updateDraftAfterSave } from "../ticketDraftStore";

export interface RewriteNewTicketEditorInput {
  editor: vscode.TextEditor;
  createdId: number;
  projectId: number;
  parsed: TicketEditorContent;
  originalControlFields?: FrontmatterControlFields;
  applyContent?: (editor: vscode.TextEditor, content: string) => Promise<void>;
}

export const rewriteNewTicketEditorToTicketMode = async (
  input: RewriteNewTicketEditorInput,
): Promise<void> => {
  removeTicketEditorByDocument(input.editor.document);
  registerTicketEditor(input.createdId, input.editor, "primary", "ticket", input.projectId);
  setEditorDisplaySource(input.editor, "saved");
  updateDraftAfterSave(input.createdId, input.parsed.subject, input.parsed.description, input.parsed.metadata);

  const newControlFields = withRegisteredTicketControlFields(
    input.originalControlFields ?? {},
    input.createdId,
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
  } finally {
    releaseSaveSync(uriString);
  }
};
