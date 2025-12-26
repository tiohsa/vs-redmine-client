import * as vscode from "vscode";
import { Ticket } from "../redmine/types";
import { TicketEditorKind } from "./ticketEditorTypes";
import {
  getLastActiveEditor,
  getPrimaryEditor,
  needsPrimaryEditor,
  registerTicketEditor,
  removeTicketEditorByUri,
  setEditorContentType,
} from "./ticketEditorRegistry";

export const buildTicketPreviewContent = (
  ticket: Pick<Ticket, "subject" | "description">,
): string => {
  const description = ticket.description ?? "";
  return `# ${ticket.subject}\n\n${description}`.trim();
};

export const buildCommentEditorContent = (comment: string): string => comment;

export const applyEditorContent = async (
  editor: vscode.TextEditor,
  nextContent: string,
): Promise<void> => {
  const current = editor.document.getText();
  if (current === nextContent) {
    return;
  }

  await editor.edit((builder) => {
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(current.length),
    );
    builder.replace(fullRange, nextContent);
  });
};

const getOpenDocument = (uri: string): vscode.TextDocument | undefined =>
  vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri);

const openTicketEditor = async (
  ticket: Ticket,
  kind: TicketEditorKind,
  content: string,
): Promise<vscode.TextEditor> => {
  const document = await vscode.workspace.openTextDocument({
    content,
    language: "markdown",
  });
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  registerTicketEditor(ticket.id, editor, kind);
  return editor;
};

const resolveTicketEditor = async (
  ticket: Ticket,
  kind: TicketEditorKind,
  content: string,
): Promise<vscode.TextEditor> => {
  if (kind === "extra") {
    return openTicketEditor(ticket, "extra", content);
  }

  if (needsPrimaryEditor(ticket.id)) {
    return openTicketEditor(ticket, "primary", content);
  }

  const primary = getPrimaryEditor(ticket.id);
  if (!primary) {
    return openTicketEditor(ticket, "primary", content);
  }

  const lastActive = getLastActiveEditor(ticket.id) ?? primary;
  const document = getOpenDocument(lastActive.uri);
  if (!document) {
    removeTicketEditorByUri(vscode.Uri.parse(lastActive.uri));
    return openTicketEditor(ticket, "primary", content);
  }

  return vscode.window.showTextDocument(document, { preview: false });
};

export const showTicketPreview = async (
  ticket: Ticket,
  options?: { kind?: TicketEditorKind },
): Promise<vscode.TextEditor> => {
  const content = buildTicketPreviewContent(ticket);
  const editor = await resolveTicketEditor(ticket, options?.kind ?? "primary", content);
  await applyEditorContent(editor, content);
  setEditorContentType(editor, "ticket");
  return editor;
};

export const showTicketComment = async (
  ticket: Ticket,
  comment: string,
): Promise<vscode.TextEditor> => {
  const content = buildCommentEditorContent(comment);
  const editor = await resolveTicketEditor(ticket, "primary", content);
  await applyEditorContent(editor, content);
  setEditorContentType(editor, "comment");
  return editor;
};
