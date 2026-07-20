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
  ensureTicketDraft,
  getTicketDraftContent,
} from "./ticketDraftStore";
import {
  buildTicketEditorContent,
  resolveTicketEditorDisplay,
  TicketEditorContent,
} from "./ticketEditorContent";
import { IssueMetadata } from "./ticketMetadataTypes";
import {
  buildTicketEditorFilename,
} from "./editorFilename";
import { getEditorStorageDirectory } from "../config/settings";
import { showError } from "../utils/notifications";
import { rememberTicketSummary } from "./ticketSummaryStore";
import {
  getConnectionScopeHash,
  getCurrentConnectionScope,
} from "../config/connectionScope";

export const buildTicketPreviewContent = (
  ticket: Pick<Ticket, "subject" | "description" | "trackerName" | "priorityName" | "statusName" | "dueDate" | "startDate" | "assigneeName" | "assigneeId">,
): string => {
  const metadata: IssueMetadata = {
    tracker: ticket.trackerName ?? "",
    priority: ticket.priorityName ?? "",
    status: ticket.statusName ?? "",
    due_date: ticket.dueDate ?? "",
    start_date: ticket.startDate ?? "",
    assignee: ticket.assigneeName,
    assignee_id: ticket.assigneeId,
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
  legacyUri?: vscode.Uri;
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
    connectionScope?: string;
  } = {},
): StorageDirResolution => {
  const configuredPath = options.configuredPath ?? getEditorStorageDirectory();
  const workspaceFolders = options.workspaceFolders ?? vscode.workspace.workspaceFolders;

  const scopeHash = options.connectionScope
    ? getConnectionScopeHash(options.connectionScope)
    : undefined;
  const withScope = (uri: vscode.Uri | undefined): vscode.Uri | undefined =>
    uri && scopeHash ? vscode.Uri.joinPath(uri, scopeHash) : uri;

  if (configuredPath.length > 0) {
    const validation = validateStorageDir(configuredPath);
    if (validation.uri) {
      return {
        uri: withScope(validation.uri),
        legacyUri: scopeHash ? validation.uri : undefined,
        usedFallback: false,
      };
    }
    const fallbackUri = workspaceFolders?.[0]
      ? vscode.Uri.joinPath(workspaceFolders[0].uri, ".redmine-client", "editors")
      : undefined;
    return {
      uri: withScope(fallbackUri),
      legacyUri: scopeHash ? fallbackUri : undefined,
      usedFallback: true,
      errorMessage: validation.errorMessage,
    };
  }

  const workspace = workspaceFolders?.[0];
  if (!workspace) {
    return { usedFallback: true };
  }

  return {
    uri: withScope(vscode.Uri.joinPath(workspace.uri, ".redmine-client", "editors")),
    legacyUri: scopeHash
      ? vscode.Uri.joinPath(workspace.uri, ".redmine-client", "editors")
      : undefined,
    usedFallback: true,
  };
};

const fileExists = async (uri: vscode.Uri): Promise<boolean> => {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === "FileNotFound") {
      return false;
    }
    throw err;
  }
};

export const ensureScopedEditorFile = async (input: {
  fileUri: vscode.Uri;
  legacyFileUri?: vscode.Uri;
  initialContent: string;
}): Promise<void> => {
  if (await fileExists(input.fileUri)) {
    return;
  }
  if (input.legacyFileUri && await fileExists(input.legacyFileUri)) {
    await vscode.workspace.fs.rename(input.legacyFileUri, input.fileUri, { overwrite: false });
    return;
  }
  await vscode.workspace.fs.writeFile(
    input.fileUri,
    new TextEncoder().encode(input.initialContent),
  );
};

const openTicketEditor = async (
  ticket: Ticket,
  kind: TicketEditorKind,
  content: string,
): Promise<vscode.TextEditor> => {
  const connectionScope = getCurrentConnectionScope();
  const storageResolution = resolveEditorStorageDir({ connectionScope });
  if (storageResolution.errorMessage) {
    showError(storageResolution.errorMessage);
  }
  const storageDir = storageResolution.uri;
  if (!storageDir) {
    const scopeHash = getConnectionScopeHash(connectionScope);
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(
        `untitled:redmine-client-${scopeHash}-${buildTicketEditorFilename(ticket.projectId, ticket.id, kind)}`,
      ),
    );
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    await applyEditorContent(editor, content);
    registerTicketEditor(ticket.id, editor, kind, "ticket", ticket.projectId, connectionScope);
    return editor;
  }

  await vscode.workspace.fs.createDirectory(storageDir);
  const fileUri = resolveTicketEditorUri({ ticket, kind, storageDir });
  const legacyFileUri = storageResolution.legacyUri
    ? resolveTicketEditorUri({ ticket, kind, storageDir: storageResolution.legacyUri })
    : undefined;
  await ensureScopedEditorFile({ fileUri, legacyFileUri, initialContent: content });
  const document = await vscode.workspace.openTextDocument(fileUri);
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  registerTicketEditor(ticket.id, editor, kind, "ticket", ticket.projectId, connectionScope);
  return editor;
};

export const showTicketPreview = async (
  ticket: Ticket,
  options?: { kind?: TicketEditorKind },
): Promise<vscode.TextEditor> => {
  rememberTicketSummary(ticket);
  const controlFields = {
    mode: "ticket-update" as const,
    project_id: ticket.projectId,
    issue_id: ticket.id,
  };
  const savedContent: TicketEditorContent = {
    subject: ticket.subject,
    description: ticket.description ?? "",
    metadata: {
      tracker: ticket.trackerName ?? "",
      priority: ticket.priorityName ?? "",
      status: ticket.statusName ?? "",
      due_date: ticket.dueDate ?? "",
      start_date: ticket.startDate ?? "",
      assignee: ticket.assigneeName,
      assignee_id: ticket.assigneeId,
    },
    controlFields,
  };
  const draftContent = getTicketDraftContent(ticket.id);
  const display = resolveTicketEditorDisplay(savedContent, draftContent);
  const displayContent: TicketEditorContent = { ...display.content, controlFields };
  const content = withTrailingEditLines(buildTicketEditorContent(displayContent));
  const editor = await openTicketEditor(
    ticket,
    options?.kind ?? "primary",
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
  updatedAt?: string,
): Promise<vscode.TextEditor> => {
  rememberTicketSummary(ticket);
  const connectionScope = getCurrentConnectionScope();
  const display = resolveCommentEditorBody(commentId, comment, connectionScope);
  const content =
    display.body.trim().length === 0
      ? buildCommentEditorContent(display.body)
      : withTrailingEditLines(buildCommentEditorContent(display.body));
  const editor = await openTicketEditor(ticket, "primary", content);
  setEditorContentType(editor, "comment");
  setEditorProjectId(editor, ticket.projectId);
  setEditorCommentId(editor, commentId);
  setEditorDisplaySource(editor, display.source);
  ensureCommentEdit(commentId, ticket.id, comment, updatedAt, connectionScope);
  if (content.trim().length > 0) {
    moveCursorToEnd(editor);
  }
  return editor;
};
