import * as vscode from "vscode";
import { beginActiveSync } from "../../views/offlineSyncStore";
import type { UnifiedSyncOperation } from "./syncOperationTypes";

export interface DeletionTarget {
  connectionScope: string;
  ticketIds: readonly number[];
  commentIds?: readonly number[];
}

interface SyncTarget {
  connectionScope: string;
  operation: UnifiedSyncOperation;
  linkedTarget?: { ticketId: number; commentId?: number };
}

const activeDeletions = new Set<DeletionTarget>();
const activeSyncs = new Set<SyncTarget>();
const activeSyncChanges = new vscode.EventEmitter<string>();
export const onActiveSyncChanged = activeSyncChanges.event;

export function matchesDeletionTarget(target: DeletionTarget, ticketId?: number, commentId?: number): boolean {
  return ticketId !== undefined && target.ticketIds.includes(ticketId) &&
    (target.commentIds === undefined || (commentId !== undefined && target.commentIds.includes(commentId)));
}

export function syncTouchesDeletion(target: DeletionTarget, operation: UnifiedSyncOperation): boolean {
  if (target.commentIds === undefined) {
    return getAffectedSyncTicketIds(operation).some(id => matchesDeletionTarget(target, id));
  }
  const matches = (ticketId?: number, commentId?: number): boolean =>
    matchesDeletionTarget(target, ticketId, commentId);
  if (operation.kind !== "comment_create" && operation.kind !== "comment_update") {
    return false;
  }
  return matches(operation.ticketId, operation.commentId) || matches(operation.ticketId, operation.createdRemoteId) ||
    (operation.effects?.some(effect => matches(effect.target.ticketId, effect.target.commentId) ||
      ((effect.kind === "comment_create" || effect.kind === "comment_update") && matches(operation.ticketId, effect.remoteId))) ?? false);
}

export function getAffectedSyncTicketIds(operation: UnifiedSyncOperation): number[] {
  const ids = new Set<number>();
  const add = (id?: number): void => {
    if (id !== undefined && Number.isSafeInteger(id) && id > 0) { ids.add(id); }
  };
  add(operation.ticketId);
  if (operation.kind === "ticket_create" || operation.kind === "ticket_update") {
    add(operation.createdRemoteId);
  }
  for (const id of operation.createdChildIds ?? []) { add(id); }
  for (const intent of [operation.intent, operation.nextIntent]) {
    if (intent && "metadata" in intent) { add(intent.metadata.parent); }
  }
  for (const effect of operation.effects ?? []) {
    add(effect.target.ticketId);
    add(effect.target.parentTicketId);
    if (effect.kind === "ticket_create" || effect.kind === "child_create" || effect.kind === "ticket_delete") { add(effect.remoteId); }
    const snapshot = effect.requestSnapshot;
    if (snapshot?.kind === "ticket_create" || snapshot?.kind === "child_create") { add(snapshot.request.parentId); }
  }
  return [...ids];
}

export function hasActiveSyncForDeletion(target: DeletionTarget): boolean {
  return Array.from(activeSyncs).some(sync => syncConflictsWithDeletion(sync, target));
}

export function getActiveSyncOperations(connectionScope: string): ReadonlyArray<Readonly<SyncTarget>> {
  return Array.from(activeSyncs).filter(sync => sync.connectionScope === connectionScope);
}

export function reserveDeletion(target: DeletionTarget): (() => void) | undefined {
  const overlaps = Array.from(activeDeletions).some(active =>
    active.connectionScope === target.connectionScope &&
    active.ticketIds.some(id => target.ticketIds.includes(id)) &&
    (!active.commentIds || !target.commentIds || active.commentIds.some(id => target.commentIds?.includes(id))));
  if (overlaps || hasActiveSyncForDeletion(target)) {
    return undefined;
  }
  activeDeletions.add(target);
  return () => { activeDeletions.delete(target); };
}

function syncConflictsWithDeletion(sync: SyncTarget, target: DeletionTarget): boolean {
  return target.connectionScope === sync.connectionScope &&
    (syncTouchesDeletion(target, sync.operation) ||
      matchesDeletionTarget(target, sync.linkedTarget?.ticketId, sync.linkedTarget?.commentId));
}

export function beginSyncUnlessDeleting(
  connectionScope: string,
  operation: UnifiedSyncOperation,
  linkedTarget?: SyncTarget["linkedTarget"],
): (() => void) | undefined {
  const entry = { connectionScope, operation, linkedTarget };
  if (Array.from(activeDeletions).some(target => syncConflictsWithDeletion(entry, target))) {
    return undefined;
  }
  const endActiveSync = beginActiveSync(connectionScope, operation.operationId);
  activeSyncs.add(entry);
  activeSyncChanges.fire(connectionScope);
  return () => {
    activeSyncs.delete(entry);
    endActiveSync();
    activeSyncChanges.fire(connectionScope);
  };
}

export function deletionInProgressError(): Error {
  return new Error(vscode.l10n.t("Deletion is in progress for this Redmine item."));
}
