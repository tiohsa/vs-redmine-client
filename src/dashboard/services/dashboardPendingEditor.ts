import type * as vscode from "vscode";
import { browserTargetForUri } from "../../app/browserCommandTarget";
import { parseTicketEditorContent } from "../../views/ticketEditorContent";
import { NEW_TICKET_DRAFT_ID } from "../../views/ticketEditorRegistry";

export function dirtyDocumentTarget(connectionScope: string, document: vscode.TextDocument): {
  ticketId?: number; commentId?: number; newTicket?: true;
} | undefined {
  if (!document.isDirty) { return undefined; }
  const editorTarget = browserTargetForUri(document.uri, connectionScope);
  if (editorTarget?.connectionScope !== connectionScope) { return undefined; }
  if (editorTarget.ticketId !== NEW_TICKET_DRAFT_ID) { return editorTarget; }
  try {
    const parsed = parseTicketEditorContent(document.getText(), {
      allowEmptyStatus: true,
      allowMissingMetadata: true,
      allowMissingSubject: true,
    });
    return { ticketId: parsed.metadata.parent, newTicket: true };
  } catch {
    return { newTicket: true };
  }
}
