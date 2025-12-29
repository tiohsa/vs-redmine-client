import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
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
import {
  buildEmptyTicketDraftContent,
  buildNewTicketDraftContent,
  ensureTicketDraft,
  getTicketDraftContent,
} from "./ticketDraftStore";
import {
  buildTicketEditorContent,
  parseTicketEditorContent,
  resolveTicketEditorDisplay,
  TicketEditorContent,
} from "./ticketEditorContent";
import { IssueMetadata } from "./ticketMetadataTypes";
import {
  buildCommentEditorFilename,
  buildTicketEditorFilename,
} from "./editorFilename";
import { getEditorStorageDirectory, getNewTicketTemplatePath } from "../config/settings";
import { showError } from "../utils/notifications";

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

export const withTrailingEditLines = (content: string): string => {
  if (content.endsWith("\n\n")) {
    return content;
  }
  if (content.endsWith("\n")) {
    return `${content}\n`;
  }
  return `${content}\n\n`;
};

const moveCursorToEnd = (editor: vscode.TextEditor): void => {
  const end = editor.document.positionAt(editor.document.getText().length);
  editor.selection = new vscode.Selection(end, end);
  editor.revealRange(new vscode.Range(end, end));
};

export const findEmptySubjectPosition = (
  content: string,
): { line: number; character: number } | undefined => {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed.startsWith("#") || trimmed.startsWith("##")) {
      continue;
    }
    const subject = trimmed.replace(/^#\s*/, "");
    if (subject.length === 0) {
      const hashIndex = line.indexOf("#");
      return { line: index, character: hashIndex === -1 ? 2 : hashIndex + 2 };
    }
    return undefined;
  }
  return undefined;
};

export const buildCommentEditorContent = (comment: string): string => comment;

export const resolveTicketEditorUri = (input: {
  ticket: Ticket;
  kind: TicketEditorKind;
  storageDir?: vscode.Uri;
}): vscode.Uri => {
  const filename = buildTicketEditorFilename(
    input.ticket.projectId,
    input.ticket.id,
    input.kind,
  );
  if (input.storageDir) {
    return vscode.Uri.joinPath(input.storageDir, filename);
  }
  return vscode.Uri.parse(`untitled:${filename}`);
};

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

type StorageDirResolution = {
  uri?: vscode.Uri;
  usedFallback: boolean;
  errorMessage?: string;
};

const validateStorageDir = (dirPath: string): { uri?: vscode.Uri; errorMessage?: string } => {
  if (!path.isAbsolute(dirPath)) {
    return { errorMessage: "Editor storage directory must be an absolute path." };
  }

  if (!fs.existsSync(dirPath)) {
    return { errorMessage: "Editor storage directory does not exist." };
  }

  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      return { errorMessage: "Editor storage directory is not a folder." };
    }
    fs.accessSync(dirPath, fs.constants.W_OK);
  } catch {
    return { errorMessage: "Editor storage directory is not writable." };
  }

  return { uri: vscode.Uri.file(dirPath) };
};

export const resolveEditorStorageDir = (
  options: {
    configuredPath?: string;
    workspaceFolders?: readonly vscode.WorkspaceFolder[];
  } = {},
): StorageDirResolution => {
  const configuredPath = options.configuredPath ?? getEditorStorageDirectory();
  const workspaceFolders = options.workspaceFolders ?? vscode.workspace.workspaceFolders;

  if (configuredPath.length > 0) {
    const validation = validateStorageDir(configuredPath);
    if (validation.uri) {
      return { uri: validation.uri, usedFallback: false };
    }
    const fallbackUri = workspaceFolders?.[0]
      ? vscode.Uri.joinPath(workspaceFolders[0].uri, ".redmine-client", "editors")
      : undefined;
    return {
      uri: fallbackUri,
      usedFallback: true,
      errorMessage: validation.errorMessage,
    };
  }

  const workspace = workspaceFolders?.[0];
  if (!workspace) {
    return { usedFallback: true };
  }

  return {
    uri: vscode.Uri.joinPath(workspace.uri, ".redmine-client", "editors"),
    usedFallback: true,
  };
};

type TemplateResolution = {
  content?: TicketEditorContent;
  errorMessage?: string;
};

type NewTicketDraftResolution = {
  content: TicketEditorContent;
  errorMessage?: string;
  usedTemplate: boolean;
  isTemplateConfigured: boolean;
};

export const resolveNewTicketTemplateContent = (input: {
  templatePath: string;
  readFileSync?: (targetPath: string) => string;
  existsSync?: (targetPath: string) => boolean;
}): TemplateResolution => {
  const templatePath = input.templatePath.trim();
  if (!path.isAbsolute(templatePath)) {
    return { errorMessage: "Template file path must be an absolute path." };
  }

  const exists = input.existsSync ?? fs.existsSync;
  if (!exists(templatePath)) {
    return { errorMessage: "Template file does not exist." };
  }

  const readFile =
    input.readFileSync ?? ((targetPath: string) => fs.readFileSync(targetPath, "utf8"));
  let raw: string;
  try {
    raw = readFile(templatePath);
  } catch {
    return { errorMessage: "Template file could not be read." };
  }

  if (raw.trim().length === 0) {
    return { errorMessage: "Template file is empty." };
  }

  try {
    return { content: parseTicketEditorContent(raw, { allowMissingSubject: true }) };
  } catch {
    return { errorMessage: "Template content is invalid." };
  }
};

export const resolveNewTicketDraftContent = (options: {
  templatePath?: string;
  readFileSync?: (targetPath: string) => string;
  existsSync?: (targetPath: string) => boolean;
} = {}): NewTicketDraftResolution => {
  const templatePath = options.templatePath ?? getNewTicketTemplatePath();
  if (templatePath.length === 0) {
    return {
      content: buildNewTicketDraftContent(),
      usedTemplate: false,
      isTemplateConfigured: false,
    };
  }

  const template = resolveNewTicketTemplateContent({
    templatePath,
    readFileSync: options.readFileSync,
    existsSync: options.existsSync,
  });
  if (template.content) {
    return {
      content: template.content,
      usedTemplate: true,
      isTemplateConfigured: true,
    };
  }

  return {
    content: buildEmptyTicketDraftContent(),
    errorMessage: template.errorMessage,
    usedTemplate: false,
    isTemplateConfigured: true,
  };
};

const openTicketEditor = async (
  ticket: Ticket,
  kind: TicketEditorKind,
  filename: string,
  content: string,
): Promise<vscode.TextEditor> => {
  const storageResolution = resolveEditorStorageDir();
  if (storageResolution.errorMessage) {
    showError(storageResolution.errorMessage);
  }
  const storageDir = storageResolution.uri;
  if (!storageDir) {
    const document = await vscode.workspace.openTextDocument(
      resolveTicketEditorUri({ ticket, kind, storageDir }),
    );
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    await applyEditorContent(editor, content);
    registerTicketEditor(ticket.id, editor, kind, "ticket", ticket.projectId);
    return editor;
  }

  await vscode.workspace.fs.createDirectory(storageDir);
  const fileUri = resolveTicketEditorUri({ ticket, kind, storageDir });
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
  const content = withTrailingEditLines(buildTicketEditorContent(display.content));
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
  moveCursorToEnd(editor);
  return editor;
};

export const showTicketComment = async (
  ticket: Ticket,
  comment: string,
  commentId: number,
): Promise<vscode.TextEditor> => {
  const display = resolveCommentEditorBody(commentId, comment);
  const filename = buildCommentEditorFilename(ticket.projectId, ticket.id, commentId);
  const content =
    display.body.trim().length === 0
      ? buildCommentEditorContent(display.body)
      : withTrailingEditLines(buildCommentEditorContent(display.body));
  const editor = await openTicketEditor(ticket, "primary", filename, content);
  setEditorContentType(editor, "comment");
  setEditorProjectId(editor, ticket.projectId);
  setEditorCommentId(editor, commentId);
  setEditorDisplaySource(editor, display.source);
  ensureCommentEdit(commentId, ticket.id, comment);
  if (content.trim().length > 0) {
    moveCursorToEnd(editor);
  }
  return editor;
};
