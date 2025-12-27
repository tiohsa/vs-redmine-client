import * as vscode from "vscode";
import { showError, showSuccess, showWarning } from "../utils/notifications";
import {
  getCommentIdForEditor,
  getEditorContentType,
  getTicketIdForEditor,
  setEditorDisplaySource,
} from "../views/ticketEditorRegistry";
import { reloadCommentEditor } from "../views/commentSaveSync";
import { CommentSaveResult } from "../views/commentSaveTypes";

const notifyReloadResult = (result: CommentSaveResult): void => {
  if (result.status === "success") {
    showSuccess("Comment reloaded from Redmine.");
    return;
  }

  if (result.status === "conflict") {
    showWarning("Remote changes detected. Refresh before saving.");
    return;
  }

  showError(result.message);
};

export const reloadCommentFromEditor = async (): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    showError("Open a comment editor before reloading.");
    return;
  }

  if (getEditorContentType(editor) !== "comment") {
    showError("Reload is only available for comment editors.");
    return;
  }

  const ticketId = getTicketIdForEditor(editor);
  const commentId = getCommentIdForEditor(editor);
  if (!ticketId || !commentId) {
    showError("Unable to resolve the comment for this editor.");
    return;
  }

  const result = await reloadCommentEditor({ ticketId, commentId, editor });
  notifyReloadResult(result);
  if (result.status === "success") {
    setEditorDisplaySource(editor, "saved");
  }
};
