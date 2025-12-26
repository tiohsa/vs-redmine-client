import * as vscode from "vscode";
import { updateComment } from "../redmine/comments";
import { Comment } from "../redmine/types";
import { getCommentLimitGuidance, validateComment } from "../utils/commentValidation";
import { showError, showInfo } from "../utils/notifications";
import { clearCommentDraft, setCommentDraft } from "../views/commentDraftStore";
import { getEditorContentType, getTicketIdForEditor } from "../views/ticketEditorRegistry";

export const editComment = async (comment: Comment): Promise<void> => {
  if (!comment.editableByCurrentUser) {
    showError("You can only edit your own comments.");
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    showError("No active editor found.");
    return;
  }

  const ticketId = getTicketIdForEditor(editor);
  if (!ticketId || ticketId !== comment.ticketId) {
    showError("Open the ticket editor before updating.");
    return;
  }
  if (getEditorContentType(editor) !== "comment") {
    showError("Open the comment editor before updating.");
    return;
  }

  const updated = editor.document.getText();
  setCommentDraft(ticketId, updated);
  const validation = validateComment(updated);
  if (!validation.valid) {
    showError(validation.message ?? "Invalid comment.");
    showInfo(getCommentLimitGuidance());
    return;
  }

  try {
    await updateComment(comment.id, updated);
    showInfo("Comment updated successfully.");
    clearCommentDraft(ticketId);
  } catch (error) {
    showError((error as Error).message);
  }
};
