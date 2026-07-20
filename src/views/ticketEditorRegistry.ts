import * as path from "path";
import * as vscode from "vscode";
import {
  TicketEditorContentType,
  TicketEditorDisplaySource,
  TicketEditorKind,
  TicketEditorRecord,
} from "./ticketEditorTypes";
import { clearEditorDisplayState, setEditorDisplayState } from "./viewState";
import {
  getConnectionScopeHash,
  getCurrentConnectionScope,
} from "../config/connectionScope";

const editorByUri = new Map<string, TicketEditorRecord>();
let editorByDocument = new WeakMap<vscode.TextDocument, TicketEditorRecord>();
let editorByEditor = new WeakMap<vscode.TextEditor, TicketEditorRecord>();
const editorsByTicket = new Map<number, Set<string>>();
export const NEW_TICKET_DRAFT_ID = -1;
const UNRESOLVED_CONNECTION_SCOPE_PREFIX = "unresolved:";

const extractEditorScopeHash = (uri: vscode.Uri): string | undefined => {
  const normalized = uri.path.replace(/\\/g, "/");
  // Both the default `.redmine-client/editors/<hash>/` and a configured
  // storage directory use the hash directory immediately above the file.
  const directoryMatch = normalized.match(/\/([a-f0-9]{16})\/[^/]+$/i);
  if (directoryMatch?.[1]) {
    return directoryMatch[1].toLowerCase();
  }
  return path.posix.basename(normalized)
    .match(/^redmine-client-([a-f0-9]{16})-/i)?.[1]?.toLowerCase();
};

/**
 * 再起動で復元されたファイルは、パスのスコープハッシュが現在の接続先と
 * 一致するときだけ現在スコープへ所属させる。旧形式は読み取り互換のため
 * 現在スコープとして扱う。
 */
export const resolveEditorConnectionScope = (
  uri: vscode.Uri,
  currentScope = getCurrentConnectionScope(),
): string => {
  const storedHash = extractEditorScopeHash(uri);
  if (!storedHash) {
    // Legacy editor files predate connection-scoped storage. Treat them as
    // belonging to the connection that restored them so they remain usable.
    return currentScope;
  }
  return storedHash === getConnectionScopeHash(currentScope)
    ? currentScope
    : `${UNRESOLVED_CONNECTION_SCOPE_PREFIX}${storedHash}`;
};

export const refreshEditorConnectionScopes = (
  currentScope = getCurrentConnectionScope(),
): void => {
  const currentHash = getConnectionScopeHash(currentScope);
  for (const record of editorByUri.values()) {
    const storedHash = extractEditorScopeHash(vscode.Uri.parse(record.uri));
    if (storedHash === currentHash) {
      record.connectionScope = currentScope;
    }
  }
};

const syncRecordUri = (record: TicketEditorRecord, nextUri: string): void => {
  if (record.uri === nextUri) {
    return;
  }

  const oldUri = record.uri;

  // Update editorByUri map key
  editorByUri.delete(oldUri);
  editorByUri.set(nextUri, record);

  const set = editorsByTicket.get(record.ticketId);
  if (set) {
    set.delete(oldUri);
    set.add(nextUri);
  }
  record.uri = nextUri;
};

const getRecord = (editor: vscode.TextEditor): TicketEditorRecord | undefined => {
  const uri = editor.document.uri.toString();
  const recordFromEditor = editorByEditor.get(editor);
  const recordFromDocument = editorByDocument.get(editor.document);
  const recordFromUri = editorByUri.get(uri);
  let record = recordFromEditor ?? recordFromDocument ?? recordFromUri;

  const hasMismatch = (
    left?: TicketEditorRecord,
    right?: TicketEditorRecord,
  ): boolean =>
    Boolean(
      left &&
        right &&
        (left.ticketId !== right.ticketId || left.contentType !== right.contentType),
    );

  if (recordFromEditor && hasMismatch(recordFromEditor, recordFromDocument)) {
    record = recordFromDocument;
  } else if (recordFromEditor && hasMismatch(recordFromEditor, recordFromUri)) {
    record = recordFromUri;
  }

  if (record?.ticketId === NEW_TICKET_DRAFT_ID) {
    const preferred =
      recordFromDocument?.ticketId !== NEW_TICKET_DRAFT_ID
        ? recordFromDocument
        : recordFromUri?.ticketId !== NEW_TICKET_DRAFT_ID
          ? recordFromUri
          : undefined;
    if (preferred) {
      record = preferred;
    }
  }

  if (record) {
    syncRecordUri(record, uri);
    // Keep all maps in sync with the current editor/document
    editorByEditor.set(editor, record);
    editorByDocument.set(editor.document, record);
  }
  return record;
};

export const registerTicketEditor = (
  ticketId: number,
  editor: vscode.TextEditor,
  kind: TicketEditorKind,
  contentType: TicketEditorContentType = "ticket",
  projectId?: number,
  connectionScope = resolveEditorConnectionScope(editor.document.uri),
): TicketEditorRecord => {
  const uri = editor.document.uri.toString();
  const record: TicketEditorRecord = {
    connectionScope,
    ticketId,
    projectId,
    uri,
    kind,
    contentType,
    lastActiveAt: Date.now(),
    displaySource: "saved",
    lastLoadedAt: Date.now(),
  };

  editorByUri.set(uri, record);
  editorByDocument.set(editor.document, record);
  editorByEditor.set(editor, record);
  if (!editorsByTicket.has(ticketId)) {
    editorsByTicket.set(ticketId, new Set());
  }
  editorsByTicket.get(ticketId)?.add(uri);

  return record;
};

export const registerNewTicketDraft = (editor: vscode.TextEditor): TicketEditorRecord =>
  registerTicketEditor(
    NEW_TICKET_DRAFT_ID,
    editor,
    "primary",
    "ticket",
    undefined,
    getCurrentConnectionScope(),
  );

export const registerTicketDocument = (
  ticketId: number,
  document: vscode.TextDocument,
  contentType: TicketEditorContentType = "ticket",
  projectId?: number,
  connectionScope = resolveEditorConnectionScope(document.uri),
): TicketEditorRecord => {
  const uri = document.uri.toString();
  const record: TicketEditorRecord = {
    connectionScope,
    ticketId,
    projectId,
    uri,
    kind: "primary",
    contentType,
    lastActiveAt: Date.now(),
    displaySource: "saved",
    lastLoadedAt: Date.now(),
  };

  editorByUri.set(uri, record);
  editorByDocument.set(document, record);
  if (!editorsByTicket.has(ticketId)) {
    editorsByTicket.set(ticketId, new Set());
  }
  editorsByTicket.get(ticketId)?.add(uri);

  return record;
};

export const registerCommentDocument = (
  ticketId: number,
  commentId: number,
  document: vscode.TextDocument,
  projectId?: number,
  connectionScope = getCurrentConnectionScope(),
): TicketEditorRecord => {
  const record = registerTicketDocument(
    ticketId,
    document,
    "comment",
    projectId,
    connectionScope,
  );
  record.commentId = commentId;
  return record;
};

export const getNewTicketDraftUri = (): vscode.Uri | undefined => {
  const record =
    getLastActiveEditor(NEW_TICKET_DRAFT_ID) ?? getPrimaryEditor(NEW_TICKET_DRAFT_ID);
  if (!record) {
    return undefined;
  }

  return vscode.Uri.parse(record.uri);
};

const getCommentDraftRecord = (ticketId: number): TicketEditorRecord | undefined =>
  getTicketEditors(ticketId).find((record) => record.contentType === "commentDraft");

export const registerNewCommentDraft = (
  ticketId: number,
  editor: vscode.TextEditor,
): TicketEditorRecord =>
  registerTicketEditor(
    ticketId,
    editor,
    "primary",
    "commentDraft",
    undefined,
    getCurrentConnectionScope(),
  );

export const getNewCommentDraftUri = (ticketId: number): vscode.Uri | undefined => {
  const record = getCommentDraftRecord(ticketId);
  if (!record) {
    return undefined;
  }

  return vscode.Uri.parse(record.uri);
};

export const getTicketEditors = (
  ticketId: number,
  connectionScope = getCurrentConnectionScope(),
): TicketEditorRecord[] =>
  Array.from(editorsByTicket.get(ticketId) ?? []).map((uri) => editorByUri.get(uri))
    .filter((record): record is TicketEditorRecord =>
      Boolean(record) && record?.connectionScope === connectionScope
    );

export const getTrackedTicketIds = (): number[] =>
  Array.from(editorsByTicket.keys());

export const getAllEditorRecords = (): TicketEditorRecord[] =>
  Array.from(editorByUri.values());

const normalizeUriPath = (value: string): string => value.replace(/\\/g, "/");

const extractBasename = (uri: string): string => {
  try {
    const parsed = vscode.Uri.parse(uri);
    // Use path.posix.basename for URI paths as they use forward slashes
    return path.posix.basename(normalizeUriPath(parsed.path));
  } catch {
    // Fallback for simple strings or unexpected formats
    const normalized = normalizeUriPath(uri);
    return normalized.split("/").pop() ?? "";
  }
};

export const getCommentIdForDraftUri = (
  ticketId: number,
  currentUri: string,
): number | undefined => {
  const currentBasename = extractBasename(currentUri).toLowerCase();
  const record = getTicketEditors(ticketId).find((r) => {
    if (r.commentId === undefined) {
      return false;
    }
    // Match by filename to handle URI scheme changes (untitled: -> file:)
    // normalization for Windows safety
    const recordBasename = extractBasename(r.uri).toLowerCase();
    return currentBasename === recordBasename;
  });
  return record?.commentId;
};

export const getTicketIdForDraftUri = (currentUri: string): number | undefined => {
  const currentBasename = extractBasename(currentUri).toLowerCase();
  if (!currentBasename) {
    return undefined;
  }

  for (const record of editorByUri.values()) {
    if (record.contentType !== "ticket") {
      continue;
    }
    const recordBasename = extractBasename(record.uri).toLowerCase();
    if (currentBasename === recordBasename) {
      return record.ticketId;
    }
  }

  return undefined;
};

export const getPrimaryEditor = (ticketId: number): TicketEditorRecord | undefined =>
  getTicketEditors(ticketId).find((record) => record.kind === "primary");

export const needsPrimaryEditor = (ticketId: number): boolean =>
  !getPrimaryEditor(ticketId);

export const getLastActiveEditor = (ticketId: number): TicketEditorRecord | undefined => {
  const records = getTicketEditors(ticketId);
  if (records.length === 0) {
    return undefined;
  }

  return records.reduce((latest, current) =>
    current.lastActiveAt > latest.lastActiveAt ? current : latest,
  );
};

export const markEditorActive = (editor: vscode.TextEditor): void => {
  const record = getRecord(editor);
  if (!record) {
    return;
  }

  record.lastActiveAt = Date.now();
};

export const setEditorContentType = (
  editor: vscode.TextEditor,
  contentType: TicketEditorContentType,
): void => {
  const record = getRecord(editor);
  if (!record) {
    return;
  }

  record.contentType = contentType;
};

export const setEditorProjectId = (editor: vscode.TextEditor, projectId: number): void => {
  const record = getRecord(editor);
  if (!record) {
    return;
  }

  record.projectId = projectId;
};

export const setEditorCommentId = (
  editor: vscode.TextEditor,
  commentId: number,
): void => {
  const record = getRecord(editor);
  if (!record) {
    return;
  }

  record.commentId = commentId;
};

export const setEditorDisplaySource = (
  editor: vscode.TextEditor,
  source: TicketEditorDisplaySource,
): void => {
  const record = getRecord(editor);
  if (!record) {
    return;
  }

  record.displaySource = source;
  record.lastLoadedAt = Date.now();
  setEditorDisplayState(record.uri, {
    source,
    lastLoadedAt: record.lastLoadedAt,
  });
};

export const getEditorDisplaySource = (
  editor: vscode.TextEditor,
): TicketEditorDisplaySource | undefined => getRecord(editor)?.displaySource;

export const removeTicketEditorByUri = (uri: vscode.Uri): void => {
  const key = uri.toString();
  const record = editorByUri.get(key);
  if (!record) {
    return;
  }

  editorByUri.delete(key);
  const set = editorsByTicket.get(record.ticketId);
  if (!set) {
    return;
  }

  set.delete(key);
  if (set.size === 0) {
    editorsByTicket.delete(record.ticketId);
  }
};

export const removeTicketEditorByDocument = (document: vscode.TextDocument): void => {
  const record = editorByDocument.get(document);
  if (!record) {
    return;
  }

  editorByDocument.delete(document);
  editorByUri.delete(record.uri);
  const set = editorsByTicket.get(record.ticketId);
  if (!set) {
    return;
  }

  set.delete(record.uri);
  if (set.size === 0) {
    editorsByTicket.delete(record.ticketId);
  }
};

export const getTicketIdForEditor = (editor: vscode.TextEditor): number | undefined =>
  getRecord(editor)?.ticketId;

export const getProjectIdForEditor = (editor: vscode.TextEditor): number | undefined =>
  getRecord(editor)?.projectId;

export const getTicketIdForDocument = (
  document: vscode.TextDocument,
): number | undefined => editorByDocument.get(document)?.ticketId;

export const getProjectIdForDocument = (
  document: vscode.TextDocument,
): number | undefined => editorByDocument.get(document)?.projectId;

export const getCommentIdForDocument = (
  document: vscode.TextDocument,
): number | undefined => editorByDocument.get(document)?.commentId;

export const getEditorContentTypeForDocument = (
  document: vscode.TextDocument,
): TicketEditorContentType | undefined => editorByDocument.get(document)?.contentType;

export const getTicketIdForUri = (uri: vscode.Uri): number | undefined =>
  editorByUri.get(uri.toString())?.ticketId;

export const getProjectIdForUri = (uri: vscode.Uri): number | undefined =>
  editorByUri.get(uri.toString())?.projectId;

export const getCommentIdForUri = (uri: vscode.Uri): number | undefined =>
  editorByUri.get(uri.toString())?.commentId;

export const getEditorContentTypeForUri = (
  uri: vscode.Uri,
): TicketEditorContentType | undefined => editorByUri.get(uri.toString())?.contentType;

export const getConnectionScopeForEditor = (
  editor: vscode.TextEditor,
): string | undefined => getRecord(editor)?.connectionScope;

export const getConnectionScopeForDocument = (
  document: vscode.TextDocument,
): string | undefined => editorByDocument.get(document)?.connectionScope;

export const getConnectionScopeForUri = (uri: vscode.Uri): string | undefined =>
  editorByUri.get(uri.toString())?.connectionScope;

export const getCommentIdForEditor = (editor: vscode.TextEditor): number | undefined =>
  getRecord(editor)?.commentId;

export const isTicketEditor = (editor: vscode.TextEditor): boolean =>
  Boolean(getRecord(editor));

export const getEditorContentType = (
  editor: vscode.TextEditor,
): TicketEditorContentType | undefined => getRecord(editor)?.contentType;

export const clearRegistry = (): void => {
  editorByUri.clear();
  editorsByTicket.clear();
  editorByDocument = new WeakMap<vscode.TextDocument, TicketEditorRecord>();
  editorByEditor = new WeakMap<vscode.TextEditor, TicketEditorRecord>();
  clearEditorDisplayState();
};
