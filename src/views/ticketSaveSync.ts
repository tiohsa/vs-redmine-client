import * as vscode from "vscode";
import type { OfflineTicketUpdate } from "./offlineSyncStore";
import type { TicketEditorContent } from "./ticketEditorContent";
import type { TicketSaveResult } from "./ticketSaveTypes";
import {
  applyQueuedTicketUpdate as applyQueuedTicketUpdateInternal,
  handleTicketEditorSave as handleTicketEditorSaveInternal,
  queueNewTicketDraft as queueNewTicketDraftInternal,
  queueNewTicketDraftContent as queueNewTicketDraftContentInternal,
  queueTicketDraft as queueTicketDraftInternal,
  saveTicketDraftLocally as saveTicketDraftLocallyInternal,
} from "./ticketSync/ticketQueueSync";
import {
  createTicketFromQueuedContent as createTicketFromQueuedContentInternal,
  syncNewTicketDraft as syncNewTicketDraftInternal,
  syncNewTicketDraftContent as syncNewTicketDraftContentInternal,
} from "./ticketSync/ticketCreateSync";
import {
  reloadTicketEditor as reloadTicketEditorInternal,
  syncTicketDraft as syncTicketDraftInternal,
} from "./ticketSync/ticketUpdateSync";
import type {
  TicketCreateDependencies,
  TicketReloadDependencies,
  TicketSaveDependencies,
} from "./ticketSync/types";

export type {
  TicketCreateDependencies,
  TicketReloadDependencies,
  TicketSaveDependencies,
} from "./ticketSync/types";

export const syncTicketDraft = async (input: {
  operationScope?: string;
  ticketId: number;
  content: string;
  editor?: vscode.TextEditor;
  documentUri?: vscode.Uri;
  deps?: Partial<TicketSaveDependencies>;
  onSubjectUpdated?: (ticketId: number, subject: string) => void;
}): Promise<TicketSaveResult> => syncTicketDraftInternal(input);

export const queueTicketDraft = async (input: {
  operationScope?: string;
  ticketId: number;
  content: string;
  editor?: vscode.TextEditor;
  documentUri?: vscode.Uri;
  onSubjectUpdated?: (ticketId: number, subject: string) => void;
}): Promise<TicketSaveResult> => queueTicketDraftInternal(input);

export const syncNewTicketDraft = async (input: {
  operationScope?: string;
  editor: vscode.TextEditor;
  deps?: Partial<TicketCreateDependencies>;
  applyContent?: (editor: vscode.TextEditor, content: string) => Promise<void>;
}): Promise<TicketSaveResult> => syncNewTicketDraftInternal(input);

export const syncNewTicketDraftContent = async (input: {
  operationScope?: string;
  content: string;
  projectId?: number;
  documentUri?: vscode.Uri;
  deps?: Partial<TicketCreateDependencies>;
  onCreated?: (createdId: number, parsed: TicketEditorContent) => void;
}): Promise<TicketSaveResult> => syncNewTicketDraftContentInternal(input);

export const createTicketFromQueuedContent = async (input: {
  operationScope?: string;
  content: string;
  projectId?: number;
  baseDir?: string;
  deps?: Partial<TicketCreateDependencies>;
}): Promise<{
  result: TicketSaveResult;
  createdId?: number;
  parsed?: TicketEditorContent;
}> => createTicketFromQueuedContentInternal(input);

export const applyQueuedTicketUpdate = async (input: {
  operationScope?: string;
  update: OfflineTicketUpdate;
  deps?: Partial<TicketSaveDependencies>;
}): Promise<TicketSaveResult> => applyQueuedTicketUpdateInternal(input);

export const queueNewTicketDraft = async (input: {
  editor: vscode.TextEditor;
  operationScope?: string;
}): Promise<TicketSaveResult> => queueNewTicketDraftInternal(input);

export const queueNewTicketDraftContent = async (input: {
  operationScope?: string;
  content: string;
  projectId?: number;
  documentUri?: vscode.Uri;
}): Promise<TicketSaveResult> => queueNewTicketDraftContentInternal(input);

export const reloadTicketEditor = async (input: {
  operationScope?: string;
  ticketId: number;
  editor: vscode.TextEditor;
  deps?: TicketReloadDependencies;
}): Promise<TicketSaveResult> => reloadTicketEditorInternal(input);

export const saveTicketDraftLocally = (
  editor: vscode.TextEditor,
): TicketSaveResult | undefined => saveTicketDraftLocallyInternal(editor);

export const handleTicketEditorSave = async (
  editor: vscode.TextEditor,
  options: {
    onSubjectUpdated?: (ticketId: number, subject: string) => void;
    operationScope?: string;
  } = {},
): Promise<TicketSaveResult | undefined> => handleTicketEditorSaveInternal(editor, options);
