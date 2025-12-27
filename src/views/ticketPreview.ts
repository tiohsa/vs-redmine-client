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
import { IssueMetadata } from "./ticketMetadataTypes";
import {
  buildCommentEditorFilename,
  buildTicketEditorFilename,
} from "./editorFilename";

export const buildTicketPreviewContent = (
  ticket: Pick<Ticket, "subject" | "description" | "trackerName" | "priorityName" | "statusName" | "dueDate">,
): string => {
  const metadata: IssueMetadata = {
    tracker: ticket.trackerName ?? "",
    priority: ticket.priorityName ?? "",
    status: ticket.statusName ?? "",
    due_date: ticket.dueDate ?? "",
  };
  return buildTicketEditorContent({
    subject: ticket.subject,
    description: ticket.description ?? "",
    metadata,
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

const getEditorStorageDir = (): vscode.Uri | undefined => {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) {
    return undefined;
  }

  return vscode.Uri.joinPath(workspace.uri, ".todoex", "editors");
};

const openTicketEditor = async (
  ticket: Ticket,
  kind: TicketEditorKind,
  filename: string,
  content: string,
): Promise<vscode.TextEditor> => {
  const storageDir = getEditorStorageDir();
  if (!storageDir) {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(`untitled:${filename}`),
    );
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    await applyEditorContent(editor, content);
    registerTicketEditor(ticket.id, editor, kind, "ticket", ticket.projectId);
    return editor;
  }

  await vscode.workspace.fs.createDirectory(storageDir);
  const fileUri = vscode.Uri.joinPath(storageDir, filename);
  const bytes = new TextEncoder().encode(content);
  await vscode.workspace.fs.writeFile(fileUri, bytes);
  const document = await vscode.workspace.openTextDocument(fileUri);
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  registerTicketEditor(ticket.id, editor, kind, "ticket", ticket.projectId);
  return editor;
};

export const showTicketPreview = async (
  ticket: Ticket,
  options?: { kind?: TicketEditorKind },
): Promise<vscode.TextEditor> => {
  const savedContent: TicketEditorContent = {
    subject: ticket.subject,
    description: ticket.description ?? "",
    metadata: {
      tracker: ticket.trackerName ?? "",
      priority: ticket.priorityName ?? "",
      status: ticket.statusName ?? "",
      due_date: ticket.dueDate ?? "",
    },
  };
  const draftContent = getTicketDraftContent(ticket.id);
  const display = resolveTicketEditorDisplay(savedContent, draftContent);
  const content = buildTicketEditorContent(display.content);
  const filename = buildTicketEditorFilename(
    ticket.projectId,
    ticket.id,
    options?.kind ?? "primary",
  );
  const editor = await openTicketEditor(
    ticket,
    options?.kind ?? "primary",
    filename,
    content,
  );
  setEditorContentType(editor, "ticket");
  setEditorProjectId(editor, ticket.projectId);
  setEditorDisplaySource(editor, display.source);
  ensureTicketDraft(
    ticket.id,
    ticket.subject,
    ticket.description ?? "",
    savedContent.metadata,
    ticket.updatedAt,
  );
  return editor;
};

export const showTicketComment = async (
  ticket: Ticket,
  comment: string,
  commentId: number,
): Promise<vscode.TextEditor> => {
  const display = resolveCommentEditorBody(commentId, comment);
  const filename = buildCommentEditorFilename(ticket.projectId, ticket.id, commentId);
  const content = buildCommentEditorContent(display.body);
  const editor = await openTicketEditor(ticket, "primary", filename, content);
  setEditorContentType(editor, "comment");
  setEditorProjectId(editor, ticket.projectId);
  setEditorCommentId(editor, commentId);
  setEditorDisplaySource(editor, display.source);
  ensureCommentEdit(commentId, ticket.id, comment);
  return editor;
};
