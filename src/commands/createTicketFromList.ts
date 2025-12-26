import * as vscode from "vscode";
import { getNewTicketDraftUri, registerNewTicketDraft } from "../views/ticketEditorRegistry";

const DRAFT_URI = vscode.Uri.parse("untitled:todoex-new-ticket.md");

const findOpenDocument = (uri: vscode.Uri): vscode.TextDocument | undefined =>
  vscode.workspace.textDocuments.find((document) =>
    document.uri.toString() === uri.toString(),
  );

export const createTicketFromList = async (): Promise<void> => {
  const knownUri = getNewTicketDraftUri() ?? DRAFT_URI;
  const existing = findOpenDocument(knownUri);
  const document = existing ?? (await vscode.workspace.openTextDocument(knownUri));
  const editor = await vscode.window.showTextDocument(document, { preview: false });

  registerNewTicketDraft(editor);
};
