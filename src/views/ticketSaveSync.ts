import * as vscode from "vscode";
import type { TicketSaveResult } from "./ticketSaveTypes";
import {
  handleTicketEditorSave as handleTicketEditorSaveInternal,
  queueNewTicketDraft as queueNewTicketDraftInternal,
  queueNewTicketDraftContent as queueNewTicketDraftContentInternal,
  queueTicketDraft as queueTicketDraftInternal,
  saveTicketDraftLocally as saveTicketDraftLocallyInternal,
} from "./ticketSync/ticketQueueSync";
import {
  reloadTicketEditor as reloadTicketEditorInternal,
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

export const queueTicketDraft = async (input: {
  operationScope?: string;
  ticketId: number;
  content: string;
  editor?: vscode.TextEditor;
  documentUri?: vscode.Uri;
  onSubjectUpdated?: (ticketId: number, subject: string) => void;
}): Promise<TicketSaveResult> => queueTicketDraftInternal(input);

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
