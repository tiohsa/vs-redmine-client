import * as vscode from "vscode";
import { createSyncOperationRepository } from "../../app/ticketSync/syncRepository";
import {
  deletionInProgressError,
  hasActiveSyncForDeletion,
  matchesDeletionTarget,
  reserveDeletion,
  syncTouchesDeletion,
  type DeletionTarget,
} from "../../app/ticketSync/syncDeletionGuard";
import { getCommentDraftState, isPendingCommentDraft } from "../../views/commentDraftStore";
import { getCommentEditDrafts } from "../../views/commentEditStore";
import { collectPendingChangeSnapshots, getCommentDraftTargetId } from "./dashboardPendingDeletionChanges";
import { dirtyDocumentTarget } from "./dashboardPendingEditor";

const repository = createSyncOperationRepository();

export function getTicketIdsWithPendingChanges(connectionScope: string): number[] {
  const ids = new Set(collectPendingChangeSnapshots(connectionScope).flatMap(change => change.ticketIds));
  return [...ids].filter(id => Number.isSafeInteger(id) && id > 0);
}

export function assertCanDelete(target: DeletionTarget): void {
  const { connectionScope } = target;
  const hasPending = target.commentIds === undefined
    ? getTicketIdsWithPendingChanges(connectionScope).some(ticketId => matchesDeletionTarget(target, ticketId))
    : hasPendingCommentChanges(target);
  if (hasPending) {
    throw new Error(vscode.l10n.t("Resolve unsaved changes or pending sync for this Redmine item before deleting it."));
  }
}

function hasPendingCommentChanges(target: DeletionTarget): boolean {
  const { connectionScope } = target;
  const hasCommentDraft = target.ticketIds.some(ticketId => {
    const draft = getCommentDraftState(ticketId, connectionScope);
    return isPendingCommentDraft(draft) && matchesDeletionTarget(target, ticketId, getCommentDraftTargetId(ticketId, draft));
  });
  return hasCommentDraft || hasActiveSyncForDeletion(target) ||
    getCommentEditDrafts(connectionScope).some(edit => matchesDeletionTarget(target, edit.ticketId, edit.commentId)) ||
    vscode.workspace.textDocuments.some(document => {
      const editor = dirtyDocumentTarget(connectionScope, document);
      return matchesDeletionTarget(target, editor?.ticketId, editor?.commentId);
    }) || repository.listOperations(connectionScope).some(operation => syncTouchesDeletion(target, operation));
}

export async function runProtectedDelete<T>(
  target: DeletionTarget & { possibleTicketIds?: readonly number[] },
  operation: () => Promise<T>,
): Promise<T> {
  assertCanDelete(target);
  const reservation = { ...target, ticketIds: [...target.ticketIds, ...(target.possibleTicketIds ?? [])] };
  if (hasActiveSyncForDeletion(reservation)) {
    throw new Error(vscode.l10n.t("Resolve unsaved changes or pending sync for this Redmine item before deleting it."));
  }
  const release = reserveDeletion(reservation);
  if (!release) {
    throw deletionInProgressError();
  }
  try {
    return await operation();
  } finally {
    release();
  }
}
