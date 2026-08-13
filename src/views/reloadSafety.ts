import * as vscode from "vscode";
import { getCommentEdit } from "./commentEditStore";
import { parseTicketEditorContent } from "./ticketEditorContent";
import { getTicketDraft } from "./ticketDraftStore";
import { isIssueMetadataEqual } from "./ticketMetadataTypes";

const isDocumentDirty = (editor: vscode.TextEditor): boolean => editor.document.isDirty === true;

export const hasLocalTicketChanges = (
  ticketId: number,
  editor: vscode.TextEditor,
  connectionScope: string,
): boolean => {
  const draft = getTicketDraft(ticketId, connectionScope);
  if (!draft) {
    return true;
  }
  if (isDocumentDirty(editor)) {
    return true;
  }

  try {
    const current = parseTicketEditorContent(editor.document.getText(), {
      allowMissingMetadata: true,
      fallbackMetadata: draft.baseMetadata,
      allowMissingSubject: true,
    });
    return current.subject.trim() !== draft.baseSubject.trim()
      || current.description.trim() !== draft.baseDescription.trim()
      || !isIssueMetadataEqual(current.metadata, draft.baseMetadata);
  } catch {
    return true;
  }
};

export const hasLocalCommentChanges = (
  commentId: number,
  editor: vscode.TextEditor,
  connectionScope: string,
): boolean => {
  const edit = getCommentEdit(commentId, connectionScope);
  if (!edit) {
    return true;
  }
  return isDocumentDirty(editor)
    || editor.document.getText().trim() !== edit.baseBody.trim();
};

type ShowWarningMessage = (message: string, ...items: string[]) => Thenable<string | undefined>;

const defaultShowWarningMessage: ShowWarningMessage = (message, ...items) =>
  vscode.window.showWarningMessage(message, ...items);

export const confirmReloadDiscard = async (
  message: string,
  discardLabel: string,
  showWarningMessage: ShowWarningMessage = defaultShowWarningMessage,
): Promise<boolean> => (await showWarningMessage(message, discardLabel)) === discardLabel;
