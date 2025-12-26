import * as fs from "fs";
import * as vscode from "vscode";
import { Ticket } from "../redmine/types";
import { TicketEditorKind } from "./ticketEditorTypes";
import {
  getLastActiveEditor,
  getPrimaryEditor,
  needsPrimaryEditor,
  registerTicketEditor,
  removeTicketEditorByUri,
  setEditorCommentId,
  setEditorContentType,
  setEditorProjectId,
} from "./ticketEditorRegistry";
import { initializeCommentEdit } from "./commentEditStore";
import { initializeTicketDraft } from "./ticketDraftStore";
import { buildTicketEditorContent } from "./ticketEditorContent";
import {
  buildCommentEditorFilename,
  buildTicketEditorFilename,
} from "./editorFilename";
import { buildUniqueUntitledPath } from "./untitledPath";

export const buildTicketPreviewContent = (
  ticket: Pick<Ticket, "subject" | "description">,
): string => {
  return buildTicketEditorContent({
    subject: ticket.subject,
    description: ticket.description ?? "",
  });
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
  filename: string,
): Promise<vscode.TextEditor> => {
  const document = await vscode.workspace.openTextDocument(
    buildUntitledUri(filename),
  );
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  registerTicketEditor(ticket.id, editor, kind, "ticket", ticket.projectId);
  return editor;
};

const buildUntitledUri = (filename: string): vscode.Uri => {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) {
    return vscode.Uri.parse(`untitled:${filename}`);
  }

  const targetPath = buildUniqueUntitledPath(
    workspace.uri.path,
    filename,
    (candidate) => fs.existsSync(candidate),
  );
  return vscode.Uri.parse(`untitled:${targetPath}`);
};

const resolveTicketEditor = async (
  ticket: Ticket,
  kind: TicketEditorKind,
  filename: string,
): Promise<vscode.TextEditor> => {
  if (kind === "extra") {
    return openTicketEditor(ticket, "extra", filename);
  }

  if (needsPrimaryEditor(ticket.id)) {
    return openTicketEditor(ticket, "primary", filename);
  }

  const primary = getPrimaryEditor(ticket.id);
  if (!primary) {
    return openTicketEditor(ticket, "primary", filename);
  }

  const lastActive = getLastActiveEditor(ticket.id) ?? primary;
  const document = getOpenDocument(lastActive.uri);
  if (!document) {
    removeTicketEditorByUri(vscode.Uri.parse(lastActive.uri));
    return openTicketEditor(ticket, "primary", filename);
  }

  return vscode.window.showTextDocument(document, { preview: false });
};

export const showTicketPreview = async (
  ticket: Ticket,
  options?: { kind?: TicketEditorKind },
): Promise<vscode.TextEditor> => {
  const content = buildTicketPreviewContent(ticket);
  const filename = buildTicketEditorFilename(
    ticket.projectId,
    ticket.id,
    options?.kind ?? "primary",
  );
  const editor = await resolveTicketEditor(
    ticket,
    options?.kind ?? "primary",
    filename,
  );
  await applyEditorContent(editor, content);
  setEditorContentType(editor, "ticket");
  setEditorProjectId(editor, ticket.projectId);
  initializeTicketDraft(ticket.id, ticket.subject, ticket.description ?? "", ticket.updatedAt);
  return editor;
};

export const showTicketComment = async (
  ticket: Ticket,
  comment: string,
  commentId: number,
): Promise<vscode.TextEditor> => {
  const content = buildCommentEditorContent(comment);
  const filename = buildCommentEditorFilename(ticket.projectId, ticket.id, commentId);
  const editor = await resolveTicketEditor(ticket, "primary", filename);
  await applyEditorContent(editor, content);
  setEditorContentType(editor, "comment");
  setEditorProjectId(editor, ticket.projectId);
  setEditorCommentId(editor, commentId);
  initializeCommentEdit(commentId, ticket.id, comment);
  return editor;
};
