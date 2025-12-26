import * as vscode from "vscode";
import { addComment } from "../redmine/comments";
import { getCommentLimitGuidance, validateComment } from "../utils/commentValidation";
import { showError, showInfo } from "../utils/notifications";
import { clearCommentDraft, setCommentDraft } from "../views/commentDraftStore";
import { getEditorContentType, getTicketIdForEditor } from "../views/ticketEditorRegistry";

export interface AddCommentInput {
  issueId: number;
  onSuccess?: () => void | Promise<void>;
}

export const addCommentForIssue = async (input: AddCommentInput): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    showError("No active editor found.");
    return;
  }

  const ticketId = getTicketIdForEditor(editor);
  if (!ticketId || ticketId !== input.issueId) {
    showError("Open the ticket editor before adding a comment.");
    return;
  }
  if (getEditorContentType(editor) !== "comment") {
    showError("Open the comment editor before adding a comment.");
    return;
  }

  const text = editor.document.getText();
  setCommentDraft(ticketId, text);
  const validation = validateComment(text);
  if (!validation.valid) {
    showError(validation.message ?? "Invalid comment.");
    showInfo(getCommentLimitGuidance());
    return;
  }

  try {
    await addComment(input.issueId, text);
    showInfo("Comment added.");
    clearCommentDraft(ticketId);
    await input.onSuccess?.();
  } catch (error) {
    showError((error as Error).message);
  }
};
