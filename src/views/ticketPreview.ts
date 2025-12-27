import * as fs from "fs";
import * as vscode from "vscode";
import { Ticket } from "../redmine/types";
import { TicketEditorKind } from "./ticketEditorTypes";
import {
  registerTicketEditor,
  setEditorCommentId,
  setEditorContentType,
  setEditorProjectId,
  setEditorDisplaySource,
} from "./ticketEditorRegistry";
import { ensureCommentEdit, resolveCommentEditorBody } from "./commentEditStore";
import { ensureTicketDraft, getTicketDraftContent } from "./ticketDraftStore";
import {
  buildTicketEditorContent,
  resolveTicketEditorDisplay,
  TicketEditorContent,
} from "./ticketEditorContent";
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

export const showTicketPreview = async (
  ticket: Ticket,
  options?: { kind?: TicketEditorKind },
): Promise<vscode.TextEditor> => {
  const savedContent: TicketEditorContent = {
    subject: ticket.subject,
    description: ticket.description ?? "",
  };
  const draftContent = getTicketDraftContent(ticket.id);
  const display = resolveTicketEditorDisplay(savedContent, draftContent);
  const content = buildTicketEditorContent(display.content);
  const filename = buildTicketEditorFilename(
    ticket.projectId,
    ticket.id,
    options?.kind ?? "primary",
  );
  const editor = await openTicketEditor(ticket, options?.kind ?? "primary", filename);
  await applyEditorContent(editor, content);
  setEditorContentType(editor, "ticket");
  setEditorProjectId(editor, ticket.projectId);
  setEditorDisplaySource(editor, display.source);
  ensureTicketDraft(ticket.id, ticket.subject, ticket.description ?? "", ticket.updatedAt);
  return editor;
};

export const showTicketComment = async (
  ticket: Ticket,
  comment: string,
  commentId: number,
): Promise<vscode.TextEditor> => {
  const display = resolveCommentEditorBody(commentId, comment);
  const filename = buildCommentEditorFilename(ticket.projectId, ticket.id, commentId);
  const editor = await openTicketEditor(ticket, "primary", filename);
  const content = buildCommentEditorContent(display.body);
  await applyEditorContent(editor, content);
  setEditorContentType(editor, "comment");
  setEditorProjectId(editor, ticket.projectId);
  setEditorCommentId(editor, commentId);
  setEditorDisplaySource(editor, display.source);
  ensureCommentEdit(commentId, ticket.id, comment);
  return editor;
};
