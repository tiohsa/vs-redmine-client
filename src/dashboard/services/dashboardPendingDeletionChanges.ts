import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import * as vscode from "vscode";
import { getActiveSyncOperations, getAffectedSyncTicketIds } from "../../app/ticketSync/syncDeletionGuard";
import { createSyncOperationRepository } from "../../app/ticketSync/syncRepository";
import type { SyncIntent, SyncOperationKey, UnifiedSyncOperation } from "../../app/ticketSync/syncOperationTypes";
import { getCurrentConnectionScope } from "../../config/connectionScope";
import type { PendingChangeReviewItem } from "../../layers/extension-host/features/delete-redmine-items";
import { getCommentDraftState, getPendingCommentDraftTicketIds, type CommentDraftState } from "../../views/commentDraftStore";
import { getCommentEditDrafts } from "../../views/commentEditStore";
import { parseCommentUpdateFile } from "../../views/commentUpdateFile";
import { parseNewCommentDraftFilename } from "../../views/editorFilename";
import { getOfflineSyncQueue, isAbandoned } from "../../views/offlineSyncStore";
import { getPendingTicketDraftIds, getTicketDraft, getTicketDraftContent } from "../../views/ticketDraftStore";
import { buildTicketEditorContent } from "../../views/ticketEditorContent";
import { getEditorContentTypeForUri } from "../../views/ticketEditorRegistry";
import { dirtyDocumentTarget } from "./dashboardPendingEditor";

export type ChangeSnapshot = Omit<PendingChangeReviewItem, "open"> & {
  content?: string;
  draftSyncing?: boolean;
  key?: string;
  linkedKey?: string;
  documentUri?: string;
  document?: vscode.TextDocument;
  queueKey?: SyncOperationKey;
  queueContents?: readonly string[];
  reference?: string;
  active?: true;
};

const repository = createSyncOperationRepository();

function snapshot(
  id: string,
  ticketIds: readonly number[],
  label: string,
  detail: string,
  content?: string,
  state?: unknown,
): ChangeSnapshot {
  const version = createHash("sha256").update(JSON.stringify([ticketIds, label, detail, content, state])).digest("hex");
  return { id, ticketIds, label, detail, content, version };
}

export function isRelatedPendingChange(source: ChangeSnapshot, candidate: ChangeSnapshot): boolean {
  if (!source.ticketIds.some(id => candidate.ticketIds.includes(id))) { return false; }
  return !source.key?.startsWith("comment:") || source.key === candidate.key || source.key === candidate.linkedKey;
}

function describeTarget(ticketId: number, commentId?: number): string {
  return commentId === undefined ? vscode.l10n.t("Ticket #{0}", ticketId)
    : vscode.l10n.t("Comment #{0} on ticket #{1}", commentId, ticketId);
}

function renderIntent(intent?: SyncIntent): string | undefined {
  if (!intent) { return undefined; }
  if ("body" in intent) { return intent.body; }
  return intent.content || buildTicketEditorContent(intent);
}

function queueSnapshot(operation: UnifiedSyncOperation): ChangeSnapshot {
  const intent = operation.intent;
  const isNewTicket = operation.kind === "ticket_create" && operation.createdRemoteId === undefined;
  const changedTicket = operation.ticketId ?? (operation.kind === "ticket_create" ? operation.createdRemoteId : undefined);
  const changedComment = operation.commentId ?? (operation.kind === "comment_create" ? operation.createdRemoteId : undefined);
  const description = isNewTicket
    ? vscode.l10n.t("New ticket draft: {0}", intent && "subject" in intent && intent.subject ? intent.subject : vscode.l10n.t("New ticket"))
    : changedTicket === undefined ? vscode.l10n.t("Unidentified sync target")
      : operation.kind === "comment_create" && changedComment === undefined ? vscode.l10n.t("New comment on ticket #{0}", changedTicket)
        : describeTarget(changedTicket, changedComment);
  const file = operation.documentUri ? basename(vscode.Uri.parse(operation.documentUri).path) : undefined;
  const content = renderIntent(intent);
  const laterContent = renderIntent(operation.nextIntent);
  const parentId = intent && "metadata" in intent ? intent.metadata.parent : undefined;
  const laterParent = operation.nextIntent && "metadata" in operation.nextIntent ? operation.nextIntent.metadata.parent : undefined;
  const parent = [...new Set([parentId, laterParent])].filter((id): id is number => id !== undefined)
    .map(id => vscode.l10n.t("Parent ticket #{0}", id)).join(" · ");
  const detail = [description, parent, file].filter(Boolean).join(" · ");
  const record = snapshot(`queue:${operation.operationId}`, getAffectedSyncTicketIds(operation),
    vscode.l10n.t("Pending sync"), detail,
    changedTicket === undefined && !isNewTicket ? undefined
      : laterContent === undefined ? content : [content ?? "", vscode.l10n.t("Later edits"), laterContent].join("\n\n"),
    [operation.phase, operation.persistenceVersion, operation.attemptGeneration, intent, operation.nextIntent, operation.effects]);
  return { ...record, queueKey: operation.key, documentUri: operation.documentUri,
    key: isNewTicket ? undefined : pendingChangeKey(changedTicket, changedComment, operation.kind === "comment_create"),
    queueContents: [content, laterContent].filter((value): value is string => value !== undefined), reference: parent };
}

function pendingChangeKey(ticketId: number | undefined, commentId?: number, newComment = false): string | undefined {
  if (ticketId === undefined) { return undefined; }
  return commentId !== undefined || newComment ? `comment:${ticketId}:${commentId ?? "new"}` : `ticket:${ticketId}`;
}

export function getCommentDraftTargetId(ticketId: number, draft?: CommentDraftState): number | undefined {
  if (!draft || draft.postedCommentId !== undefined) { return draft?.postedCommentId; }
  const update = parseCommentUpdateFile(draft.body);
  return update?.fields.issueId === ticketId ? update.fields.journalId : undefined;
}

export function collectPendingChangeSnapshots(connectionScope: string, ticketIds?: readonly number[]): ChangeSnapshot[] {
  const candidates = ticketIds && new Set(ticketIds);
  const matches = (id: number): boolean => !candidates || candidates.has(id);
  const snapshots: ChangeSnapshot[] = [];
  for (const document of vscode.workspace.textDocuments) {
    const target = dirtyDocumentTarget(connectionScope, document);
    if (!target || (candidates && (target.ticketId === undefined || !matches(target.ticketId)))) { continue; }
    const name = basename(document.uri.path);
    const isNewComment = getEditorContentTypeForUri(document.uri) === "commentDraft" || parseNewCommentDraftFilename(name) !== undefined;
    const detail = target.ticketId === undefined ? vscode.l10n.t("New ticket draft")
      : target.newTicket ? vscode.l10n.t("New ticket draft referencing parent #{0}", target.ticketId)
        : isNewComment && target.commentId === undefined ? vscode.l10n.t("New comment on ticket #{0}", target.ticketId)
          : describeTarget(target.ticketId, target.commentId);
    snapshots.push({ ...snapshot(`editor:${document.uri}`, target.ticketId === undefined ? [] : [target.ticketId],
      vscode.l10n.t("Unsaved editor changes"), `${detail} · ${name}`, document.getText(), document.version),
      document, documentUri: document.uri.toString(),
      key: target.newTicket ? undefined : pendingChangeKey(target.ticketId, target.commentId, isNewComment) });
  }
  const queuedTickets = getOfflineSyncQueue(connectionScope).tickets;
  for (const ticketId of getPendingTicketDraftIds(connectionScope)) {
    if (!matches(ticketId)) { continue; }
    const draft = getTicketDraft(ticketId, connectionScope);
    const content = getTicketDraftContent(ticketId, connectionScope);
    const queued = queuedTickets.get(ticketId);
    const draftSyncing = draft?.status === "Syncing";
    if (!draftSyncing && !content && queued && !isAbandoned(queued)) {
      continue;
    }
    snapshots.push({ ...snapshot(`ticket-draft:${ticketId}`, [ticketId], vscode.l10n.t("Ticket draft"), describeTarget(ticketId),
      content ? buildTicketEditorContent(content) : undefined, draft?.status), key: pendingChangeKey(ticketId), draftSyncing });
  }
  for (const ticketId of getPendingCommentDraftTicketIds(connectionScope)) {
    if (!matches(ticketId)) { continue; }
    const draft = getCommentDraftState(ticketId, connectionScope);
    const commentId = getCommentDraftTargetId(ticketId, draft);
    snapshots.push({ ...snapshot(`comment-draft:${ticketId}`, [ticketId], vscode.l10n.t("Comment draft"),
      describeTarget(ticketId, commentId), draft?.body, draft?.status),
      key: pendingChangeKey(ticketId, commentId, true), draftSyncing: draft?.status === "Syncing" });
  }
  for (const edit of getCommentEditDrafts(connectionScope)) {
    if (!matches(edit.ticketId)) { continue; }
    snapshots.push({ ...snapshot(`comment-edit:${edit.ticketId}:${edit.commentId}`, [edit.ticketId], vscode.l10n.t("Comment draft"),
      describeTarget(edit.ticketId, edit.commentId), edit.draftBody), key: pendingChangeKey(edit.ticketId, edit.commentId) });
  }
  const queued = new Map(repository.listOperations(connectionScope).map(operation => [operation.operationId, queueSnapshot(operation)]));
  for (const { operation, linkedTarget } of getActiveSyncOperations(connectionScope)) {
    const existing = queued.get(operation.operationId) ?? queueSnapshot(operation);
    const ticketIds = new Set([...existing.ticketIds, ...getAffectedSyncTicketIds(operation)]);
    if (linkedTarget) { ticketIds.add(linkedTarget.ticketId); }
    queued.set(operation.operationId, { ...existing, ticketIds: [...ticketIds], active: true, label: vscode.l10n.t("Sync in progress"),
      linkedKey: pendingChangeKey(linkedTarget?.ticketId, linkedTarget?.commentId) });
  }
  snapshots.push(...Array.from(queued.values()).filter(change => !candidates || change.ticketIds.some(matches)));
  return snapshots;
}

export async function openSnapshot(connectionScope: string, change: ChangeSnapshot): Promise<void> {
  const scheme = `redmine-deletion-review-${randomUUID()}`;
  const uri = vscode.Uri.from({ scheme, path: `/${vscode.l10n.t("Pending Redmine change")}.txt` });
  const provider = vscode.workspace.registerTextDocumentContentProvider(scheme, {
    provideTextDocumentContent: () => [change.detail, change.content || vscode.l10n.t("The pending content is empty.")].join("\n\n"),
  });
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    if (getCurrentConnectionScope() !== connectionScope) { throw changedReviewError(); }
    await vscode.window.showTextDocument(document, { preview: true, preserveFocus: true });
  } finally {
    provider.dispose();
  }
}

function changedReviewError(): Error {
  return new Error(vscode.l10n.t("Pending changes changed while verifying this ticket. Try again."));
}

export function getPendingChangeReview(connectionScope: string, ticketIds: readonly number[]): PendingChangeReviewItem[] {
  const candidates = new Set(ticketIds);
  return collectPendingChangeSnapshots(connectionScope, ticketIds).map(initial => {
    const { id, ticketIds: associatedIds, label, detail, content, version } = initial;
    const open = content === undefined ? undefined : async () => {
      if (getCurrentConnectionScope() !== connectionScope) { throw changedReviewError(); }
      const current = collectPendingChangeSnapshots(connectionScope, ticketIds).find(item => item.id === id && item.version === version);
      if (!current || current.content === undefined) { throw changedReviewError(); }
      await openSnapshot(connectionScope, current);
    };
    return { id, ticketIds: associatedIds.filter(ticketId => candidates.has(ticketId)), label, detail, version, open, inProgress: initial.active };
  });
}
