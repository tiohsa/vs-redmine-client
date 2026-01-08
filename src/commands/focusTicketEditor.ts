import * as vscode from "vscode";
import { getTicketEditors } from "../views/ticketEditorRegistry";

const resolveLastActiveEditorUri = (ticketId: number): string | undefined => {
  const records = getTicketEditors(ticketId);
  if (records.length === 0) {
    return undefined;
  }

  const ticketEditors = records.filter((record) => record.contentType === "ticket");
  const candidates = ticketEditors.length > 0 ? ticketEditors : records;
  const latest = candidates.reduce((current, record) =>
    record.lastActiveAt > current.lastActiveAt ? record : current,
  );
  return latest.uri;
};

export const focusTicketEditor = async (
  input: number | { ticketId?: number; uri?: string },
): Promise<void> => {
  const ticketId = typeof input === "number" ? input : input.ticketId;
  const uriValue = typeof input === "number" ? undefined : input.uri;
  const targetUri = uriValue ?? (ticketId ? resolveLastActiveEditorUri(ticketId) : undefined);
  if (!targetUri) {
    void vscode.window.showErrorMessage("Ticket editor is not open.");
    return;
  }

  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(targetUri));
  await vscode.window.showTextDocument(document, { preview: false });
};
