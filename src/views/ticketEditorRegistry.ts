import * as vscode from "vscode";
import {
  TicketEditorContentType,
  TicketEditorDisplaySource,
  TicketEditorKind,
  TicketEditorRecord,
} from "./ticketEditorTypes";
import { clearEditorDisplayState, setEditorDisplayState } from "./viewState";

const editorByUri = new Map<string, TicketEditorRecord>();
let editorByDocument = new WeakMap<vscode.TextDocument, TicketEditorRecord>();
let editorByEditor = new WeakMap<vscode.TextEditor, TicketEditorRecord>();
const editorsByTicket = new Map<number, Set<string>>();
export const NEW_TICKET_DRAFT_ID = -1;

const syncRecordUri = (record: TicketEditorRecord, nextUri: string): void => {
  if (record.uri === nextUri) {
    return;
  }

  const set = editorsByTicket.get(record.ticketId);
  if (set) {
    set.delete(record.uri);
    set.add(nextUri);
  }
  record.uri = nextUri;
};

const getRecord = (editor: vscode.TextEditor): TicketEditorRecord | undefined => {
  const uri = editor.document.uri.toString();
  const record =
    editorByEditor.get(editor) ??
    editorByDocument.get(editor.document) ??
    editorByUri.get(uri);
  if (record) {
    syncRecordUri(record, uri);
  }
  return record;
};

export const registerTicketEditor = (
  ticketId: number,
  editor: vscode.TextEditor,
  kind: TicketEditorKind,
  contentType: TicketEditorContentType = "ticket",
  projectId?: number,
): TicketEditorRecord => {
  const uri = editor.document.uri.toString();
  const record: TicketEditorRecord = {
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
  registerTicketEditor(NEW_TICKET_DRAFT_ID, editor, "primary", "ticket");

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
  registerTicketEditor(ticketId, editor, "primary", "commentDraft");

export const getNewCommentDraftUri = (ticketId: number): vscode.Uri | undefined => {
  const record = getCommentDraftRecord(ticketId);
  if (!record) {
    return undefined;
  }

  return vscode.Uri.parse(record.uri);
};

export const getTicketEditors = (ticketId: number): TicketEditorRecord[] =>
  Array.from(editorsByTicket.get(ticketId) ?? []).map((uri) => editorByUri.get(uri))
    .filter((record): record is TicketEditorRecord => Boolean(record));

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
