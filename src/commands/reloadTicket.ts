import * as vscode from "vscode";
import { showError, showSuccess, showWarning } from "../utils/notifications";
import {
  getEditorContentType,
  getTicketIdForEditor,
  setEditorDisplaySource,
} from "../views/ticketEditorRegistry";
import { reloadTicketEditor } from "../views/ticketSaveSync";
import { TicketSaveResult } from "../views/ticketSaveTypes";

const notifyReloadResult = (result: TicketSaveResult): void => {
  if (result.status === "success") {
    showSuccess("Reloaded from Redmine.");
    return;
  }

  if (result.status === "conflict") {
    showWarning("Remote changes detected. Refresh before saving.");
    return;
  }

  showError(result.message);
};

export const reloadTicketFromEditor = async (): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    showError("Open a ticket editor before reloading.");
    return;
  }

  if (getEditorContentType(editor) !== "ticket") {
    showError("Reload is only available for ticket editors.");
    return;
  }

  const ticketId = getTicketIdForEditor(editor);
  if (!ticketId) {
    showError("Unable to resolve the ticket for this editor.");
    return;
  }

  const result = await reloadTicketEditor({ ticketId, editor });
  notifyReloadResult(result);
  if (result.status === "success") {
    setEditorDisplaySource(editor, "saved");
  }
};
