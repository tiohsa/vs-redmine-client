import * as vscode from "vscode";
import {
  TicketEditorContentType,
  TicketEditorKind,
  TicketEditorRecord,
} from "./ticketEditorTypes";

const editorByUri = new Map<string, TicketEditorRecord>();
const editorsByTicket = new Map<number, Set<string>>();

const getRecord = (editor: vscode.TextEditor): TicketEditorRecord | undefined =>
  editorByUri.get(editor.document.uri.toString());

export const registerTicketEditor = (
  ticketId: number,
  editor: vscode.TextEditor,
  kind: TicketEditorKind,
  contentType: TicketEditorContentType = "ticket",
): TicketEditorRecord => {
  const uri = editor.document.uri.toString();
  const record: TicketEditorRecord = {
    ticketId,
    uri,
    kind,
    contentType,
    lastActiveAt: Date.now(),
  };

  editorByUri.set(uri, record);
  if (!editorsByTicket.has(ticketId)) {
    editorsByTicket.set(ticketId, new Set());
  }
  editorsByTicket.get(ticketId)?.add(uri);

  return record;
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

export const getTicketIdForEditor = (editor: vscode.TextEditor): number | undefined =>
  getRecord(editor)?.ticketId;

export const isTicketEditor = (editor: vscode.TextEditor): boolean =>
  Boolean(getRecord(editor));

export const getEditorContentType = (
  editor: vscode.TextEditor,
): TicketEditorContentType | undefined => getRecord(editor)?.contentType;

export const clearRegistry = (): void => {
  editorByUri.clear();
  editorsByTicket.clear();
};
