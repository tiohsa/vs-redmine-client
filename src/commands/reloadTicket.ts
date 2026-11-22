import * as vscode from "vscode";
import { showError, showSuccess, showWarning } from "../utils/notifications";
import {
  getEditorContentType,
  getConnectionScopeForEditor,
  getTicketIdForEditor,
  setEditorDisplaySource,
} from "../views/ticketEditorRegistry";
import { reloadTicketEditor } from "../views/ticketSaveSync";
import { confirmReloadDiscard, hasLocalTicketChanges } from "../views/reloadSafety";
import { TicketSaveResult } from "../views/ticketSaveTypes";
import {
  CONNECTION_SCOPE_MISMATCH_MESSAGE,
  getCurrentConnectionScope,
} from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";

const notifyReloadResult = (result: TicketSaveResult): void => {
  if (result.status === "success") {
    showSuccess(vscode.l10n.t("Reloaded from Redmine."));
    return;
  }

  if (result.status === "conflict") {
    showWarning(vscode.l10n.t("Remote changes detected. Refresh before saving."));
    return;
  }

  showError(result.message);
};

export const reloadTicketFromEditor = async (): Promise<boolean> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    showError(vscode.l10n.t("Open a ticket editor before reloading."));
    return false;
  }

  if (getEditorContentType(editor) !== "ticket") {
    showError(vscode.l10n.t("Reload is only available for ticket editors."));
    return false;
  }

  const ticketId = getTicketIdForEditor(editor);
  if (!ticketId) {
    showError(vscode.l10n.t("Unable to resolve the ticket for this editor."));
    return false;
  }

  const operationScope = getConnectionScopeForEditor(editor);
  if (!operationScope || operationScope !== getCurrentConnectionScope()) {
    showError(CONNECTION_SCOPE_MISMATCH_MESSAGE);
    return false;
  }

  const discardLabel = vscode.l10n.t("Reload and Discard Changes");
  if (hasLocalTicketChanges(ticketId, editor, operationScope) && !await confirmReloadDiscard(
    vscode.l10n.t("Reloading from Redmine will discard your local ticket changes."),
    discardLabel,
  )) {
    return false;
  }

  const result = await runWithConnectionScope(
    operationScope,
    () => reloadTicketEditor({ ticketId, editor, operationScope }),
  );
  notifyReloadResult(result);
  if (result.status === "success") {
    setEditorDisplaySource(editor, "saved");
    return true;
  }
  return false;
};
