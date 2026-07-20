import * as vscode from "vscode";
import { showError, showSuccess, showWarning } from "../utils/notifications";
import {
  getCommentIdForEditor,
  getConnectionScopeForEditor,
  getEditorContentType,
  getTicketIdForEditor,
  setEditorDisplaySource,
} from "../views/ticketEditorRegistry";
import { reloadCommentEditor } from "../views/commentSaveSync";
import { CommentSaveResult } from "../views/commentSaveTypes";
import {
  CONNECTION_SCOPE_MISMATCH_MESSAGE,
  getCurrentConnectionScope,
} from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";

const notifyReloadResult = (result: CommentSaveResult): void => {
  if (result.status === "success") {
    showSuccess(vscode.l10n.t("Comment reloaded from Redmine."));
    return;
  }

  if (result.status === "conflict") {
    showWarning(vscode.l10n.t("Remote changes detected. Refresh before saving."));
    return;
  }

  showError(result.message);
};

export const reloadCommentFromEditor = async (): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    showError(vscode.l10n.t("Open a comment editor before reloading."));
    return;
  }

  if (getEditorContentType(editor) !== "comment") {
    showError(vscode.l10n.t("Reload is only available for comment editors."));
    return;
  }

  const ticketId = getTicketIdForEditor(editor);
  const commentId = getCommentIdForEditor(editor);
  if (!ticketId || !commentId) {
    showError(vscode.l10n.t("Unable to resolve the comment for this editor."));
    return;
  }

  const operationScope = getConnectionScopeForEditor(editor);
  if (!operationScope || operationScope !== getCurrentConnectionScope()) {
    showError(CONNECTION_SCOPE_MISMATCH_MESSAGE);
    return;
  }

  const result = await runWithConnectionScope(
    operationScope,
    () => reloadCommentEditor({ ticketId, commentId, editor, operationScope }),
  );
  notifyReloadResult(result);
  if (result.status === "success") {
    setEditorDisplaySource(editor, "saved");
  }
};
