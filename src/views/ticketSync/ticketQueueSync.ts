import * as vscode from "vscode";
import {
  addOfflineNewTicketAsync,
  addOfflineTicketUpdateAsync,
  cancelQueuedTicketUpdateIfMatchesAsync,
  getActiveScope,
  getTicketEditAuthorization,
  getOfflineSyncQueue,
  isAbandoned,
  sameDocumentIdentity,
} from "../offlineSyncStore";
import { buildTicketEditorContent, parseTicketEditorContent } from "../ticketEditorContent";
import { getTicketDraft, markDraftStatus, setTicketDraftContent } from "../ticketDraftStore";
import type { IssueMetadata } from "../ticketMetadataTypes";
import { applyEditorContent } from "../ticketPreview";
import { resolveEditorBaseDir } from "../../utils/editorBaseDir";
import { buildResult } from "./ticketSyncResult";
import type { TicketSaveResult } from "../ticketSaveTypes";
import {
  getEditorContentType,
  getProjectIdForEditor,
  getTicketIdForEditor,
  isTicketEditor,
  NEW_TICKET_DRAFT_ID,
  setEditorDisplaySource,
} from "../ticketEditorRegistry";
import { isSaveSyncSuppressed } from "../saveSyncSuppression";
import { getDefaultProjectId } from "../../config/settings";
import { getProjectSelection, parseConfiguredProjectId } from "../../config/projectSelection";
import { containsConflictMarkers } from "../../utils/threeWayMerge";
import { detectTicketChanges } from "./ticketChangeDetector";

export interface QueueTicketDraftInput {
  operationScope?: string;
  ticketId: number;
  content: string;
  editor?: vscode.TextEditor;
  documentUri?: vscode.Uri;
  onSubjectUpdated?: (ticketId: number, subject: string) => void;
  queueUnchanged?: boolean;
}

export const queueTicketDraft = async (
  input: QueueTicketDraftInput,
): Promise<TicketSaveResult> => {
  const draft = getTicketDraft(input.ticketId, input.operationScope);
  if (!draft) {
    return buildResult("failed", "Missing draft state for ticket.");
  }
  const scope = input.operationScope ?? getActiveScope();
  const queue = getOfflineSyncQueue(scope);
  const documentUri = input.editor?.document.uri.toString() ?? input.documentUri?.toString();
  const editAuthorization = getTicketEditAuthorization(input.ticketId, scope);
  const activeTicket = queue.tickets.get(input.ticketId);
  const hasAbandonedTicket = (queue.abandonedTickets ?? []).some((entry) => entry.ticketId === input.ticketId);
  if (isAbandoned(activeTicket ?? {}) || (hasAbandonedTicket &&
      (documentUri === undefined || documentUri !== (activeTicket?.documentUri ?? editAuthorization?.documentUri)))) {
    return buildResult("failed", vscode.l10n.t("Sync was abandoned for this ticket. Review the retained record before starting a new edit."));
  }
  if (containsConflictMarkers(input.content)) {
    return buildResult("failed", vscode.l10n.t("Resolve all merge conflict markers before syncing."));
  }

  let parsed;
  try {
    parsed = parseTicketEditorContent(input.content, {
      allowMissingMetadata: true,
      fallbackMetadata: draft.baseMetadata,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metadata.";
    return buildResult("failed", message);
  }

  const subject = parsed.subject || draft.baseSubject;
  const changeState = detectTicketChanges(draft, parsed);
  if (!changeState.hasChanges && !input.queueUnchanged) {
    const scope = input.operationScope ?? getActiveScope();
    const queued = getOfflineSyncQueue(scope).tickets.get(input.ticketId);
    if (!queued) {
      markDraftStatus(input.ticketId, "Synced", input.operationScope);
      return buildResult("no_change", "No changes to save.");
    }

    const cancellation = await cancelQueuedTicketUpdateIfMatchesAsync(
      input.ticketId,
      {
        operationId: queued.operationId,
        revision: queued.revision ?? 1,
        intentRevision: queued.intentRevision ?? queued.revision ?? 1,
        content: queued.content,
        connectionScope: queued.connectionScope,
      },
      scope,
    );
    if (cancellation === "cancelled" || cancellation === "not_found") {
      setTicketDraftContent(input.ticketId, parsed, input.operationScope);
      markDraftStatus(input.ticketId, "Synced", input.operationScope);
      return buildResult("no_change", "No changes to save.");
    }
    if (cancellation === "stale") {
      return buildResult("failed", vscode.l10n.t("The queued update changed while it was being cancelled. Save again."));
    }
    return buildResult("failed", vscode.l10n.t("The queued update needs recovery before it can be cancelled."));
  }

  const baseDir = resolveEditorBaseDir({
    editor: input.editor,
    documentUri: input.documentUri,
  });

  const clearedMetadata: IssueMetadata = { ...parsed.metadata, children: [] };
  const normalizedContent = buildTicketEditorContent({
    subject,
    description: parsed.description,
    metadata: input.editor ? clearedMetadata : parsed.metadata,
    layout: parsed.layout,
    metadataBlock: parsed.metadataBlock,
    controlFields: parsed.controlFields,
  });

  const registered = await addOfflineTicketUpdateAsync(input.ticketId, {
    ticketId: input.ticketId,
    baseSubject: draft.baseSubject,
    baseDescription: draft.baseDescription,
    baseMetadata: draft.baseMetadata,
    lastKnownRemoteUpdatedAt: draft.lastKnownRemoteUpdatedAt,
    content: normalizedContent,
    subject,
    description: parsed.description,
    metadata: parsed.metadata,
    layout: parsed.layout,
    metadataBlock: parsed.metadataBlock,
    controlFields: parsed.controlFields,
    baseDir,
    documentUri,
    connectionScope: input.operationScope,
    operationId: activeTicket?.operationId ?? (hasAbandonedTicket
      ? undefined
      : `${input.operationScope ?? "legacy"}:ticket:${input.ticketId}`),
    phase: "queued",
  }, scope, editAuthorization?.editSessionId);
  if (!registered) {
    return buildResult("failed", vscode.l10n.t("The queued update changed. Save again."));
  }
  if (!changeState.hasChanges) {
    return buildResult("no_change", "No changes to save.");
  }
  if (!input.queueUnchanged) {
    markDraftStatus(input.ticketId, "Queued", input.operationScope);
  }
  if (input.editor) {
    await applyEditorContent(input.editor, normalizedContent);
    setEditorDisplaySource(input.editor, "saved");
  }
  if (
    (changeState.subjectChanged ||
      changeState.descriptionChanged ||
      changeState.metadataChanged) &&
    input.onSubjectUpdated
  ) {
    input.onSubjectUpdated(input.ticketId, subject);
  }

  return buildResult("queued", "Saved for offline sync.");
};

/**
 * Ctrl+S local save path. Does not call Redmine APIs.
 */
export const saveTicketDraftLocally = async (
  editor: vscode.TextEditor,
  operationScope?: string,
): Promise<TicketSaveResult | undefined> => {
  if (!isTicketEditor(editor)) { return undefined; }
  if (getEditorContentType(editor) !== "ticket") { return undefined; }

  const ticketId = getTicketIdForEditor(editor);
  if (!ticketId) { return undefined; }

  if (ticketId === NEW_TICKET_DRAFT_ID) {
    await addOfflineNewTicketAsync({
      content: editor.document.getText(),
      documentUri: editor.document.uri.toString(),
    }, operationScope);
    return buildResult("queued", vscode.l10n.t("New ticket draft saved locally."));
  }

  return queueTicketDraft({
    ticketId,
    content: editor.document.getText(),
    editor,
    operationScope,
  });
};

export const handleTicketEditorSave = async (
  editor: vscode.TextEditor,
  options: { onSubjectUpdated?: (ticketId: number, subject: string) => void; operationScope?: string } = {},
): Promise<TicketSaveResult | undefined> => {
  if (isSaveSyncSuppressed(editor.document.uri.toString())) {
    return undefined;
  }

  const result = await saveTicketDraftLocally(editor, options.operationScope);
  if (result !== undefined) {
    return result;
  }

  return undefined;
};

const resolveProjectIdForCreate = (projectId?: number): number | undefined => {
  if (projectId) {
    return projectId;
  }
  const selection = getProjectSelection();
  if (selection.id) {
    return selection.id;
  }

  return parseConfiguredProjectId(getDefaultProjectId());
};

const resolveProjectIdForEditor = (editor: vscode.TextEditor): number | undefined =>
  resolveProjectIdForCreate(getProjectIdForEditor(editor));

export const validateNewTicketContent = (content: string): TicketSaveResult | undefined => {
  let parsed;
  try {
    parsed = parseTicketEditorContent(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metadata.";
    return buildResult("failed", message);
  }

  const subject = parsed.subject.trim();
  if (!subject) {
    return buildResult("failed", "Ticket subject is required.");
  }

  return undefined;
};

export const queueNewTicketDraft = async (input: {
  editor: vscode.TextEditor;
  operationScope?: string;
}): Promise<TicketSaveResult> => {
  const content = input.editor.document.getText();
  if (getOfflineSyncQueue(input.operationScope ?? getActiveScope()).newTickets.some((entry) =>
    isAbandoned(entry) && sameDocumentIdentity(entry.documentUri, input.editor.document.uri.toString()))) {
    return buildResult("failed", vscode.l10n.t("Sync was abandoned for this draft. Review the retained record before creating another ticket."));
  }
  const validation = validateNewTicketContent(content);
  if (validation) {
    return validation;
  }
  await addOfflineNewTicketAsync({
    content,
    projectId: resolveProjectIdForEditor(input.editor),
    documentUri: input.editor.document.uri.toString(),
    baseDir: resolveEditorBaseDir({ editor: input.editor }),
  }, input.operationScope);
  setEditorDisplaySource(input.editor, "saved");
  return buildResult("queued", "Saved for offline sync.");
};

export const queueNewTicketDraftContent = async (input: {
  operationScope?: string;
  content: string;
  projectId?: number;
  documentUri?: vscode.Uri;
}): Promise<TicketSaveResult> => {
  if (input.documentUri && getOfflineSyncQueue(input.operationScope ?? getActiveScope()).newTickets.some((entry) =>
    isAbandoned(entry) && sameDocumentIdentity(entry.documentUri, input.documentUri?.toString()))) {
    return buildResult("failed", vscode.l10n.t("Sync was abandoned for this draft. Review the retained record before creating another ticket."));
  }
  const validation = validateNewTicketContent(input.content);
  if (validation) {
    return validation;
  }
  await addOfflineNewTicketAsync({
    content: input.content,
    projectId: input.projectId,
    documentUri: input.documentUri?.toString(),
    baseDir: resolveEditorBaseDir({ documentUri: input.documentUri }),
  }, input.operationScope);
  return buildResult("queued", "Saved for offline sync.");
};
