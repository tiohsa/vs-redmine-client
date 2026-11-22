import { randomUUID } from "crypto";
import { commitOfflineDiscardAsync, prepareOfflineDiscard } from "./offlineSyncDiscard";
import { hasCurrentAttemptNonPlannedEffect, resolveRevisionForEditedQueuedFailure } from "./offlineSyncIntentRevision";
import { isAbandoned } from "./offlineSyncPolicy";
import { normalizeComment } from "./offlineSyncQueueCodec";
import { findCommentIndex, sameDocumentIdentity } from "./offlineSyncQueueEntries";
import { commitQueueMutation, getActiveScope, getQueue, mutateQueueAsync, skipQueueMutation } from "./offlineSyncQueueStorage";
import type { CommentQueueKey, OfflineCommentUpdate, OfflineDiscardResult } from "./offlineSyncTypes";

export type OfflineCommentConflictExpectation = Pick<
  OfflineCommentUpdate,
  "operationId" | "revision" | "intentRevision" | "connectionScope" | "body"
>;

export const addOfflineCommentUpdateAsync = (
  update: OfflineCommentUpdate,
  scope = getActiveScope(),
): Promise<void> => mutateQueueAsync(scope, (queue) => {
  const byOperationId = update.operationId === undefined ? [] : queue.comments.filter((item) =>
    item.ticketId === update.ticketId && item.operationId === update.operationId);
  const byCommentId = update.commentId === undefined ? [] : queue.comments.filter((item) =>
    item.ticketId === update.ticketId && item.commentId === update.commentId);
  const byDocumentUri = update.documentUri === undefined ? [] : queue.comments.filter((item) =>
    item.ticketId === update.ticketId && sameDocumentIdentity(item.documentUri, update.documentUri));
  if (byOperationId.length > 1 || byCommentId.length > 1 || byDocumentUri.length > 1) {
    return skipQueueMutation(undefined);
  }
  const target = update.operationId !== undefined
    ? byOperationId[0]
    : update.commentId !== undefined
      ? byCommentId[0]
      : byDocumentUri[0];
  if (byDocumentUri[0] && byDocumentUri[0] !== target) {
    return skipQueueMutation(undefined);
  }
  const index = target ? queue.comments.indexOf(target) : -1;
  if (index !== -1) {
    const existing = queue.comments[index];
    if (isAbandoned(existing)) { return skipQueueMutation(undefined); }
    if (existing.phase && existing.phase !== "queued" && existing.phase !== "completed") {
      const revision = Math.max(existing.revision ?? 1, existing.nextIntent?.revision ?? 0) + 1;
      queue.comments[index] = {
        ...existing,
        nextIntent: {
          revision,
          body: update.body,
          baseDir: update.baseDir,
          documentUri: update.documentUri ?? existing.documentUri,
        },
      };
    } else {
      const failedRecovery = update.body !== existing.body
        ? resolveRevisionForEditedQueuedFailure(existing)
        : undefined;
      const resolvedRevision = failedRecovery?.revision ?? existing.revision ?? update.revision ?? 1;
      queue.comments[index] = normalizeComment({
        ...existing,
        ...update,
        operationId: existing.operationId,
        connectionScope: existing.connectionScope ?? scope,
        revision: resolvedRevision,
        ...(failedRecovery
          ? { intentRevision: resolvedRevision, effects: failedRecovery.effects }
          : {}),
        createdAt: existing.createdAt ?? update.createdAt ?? Date.now(),
      }, scope, index);
    }
    return commitQueueMutation(undefined);
  }
  queue.comments.push(normalizeComment({
    ...update,
    operationId: update.operationId ?? `comment:${randomUUID()}`,
    connectionScope: update.connectionScope ?? scope,
    phase: update.phase ?? "queued",
    revision: update.revision ?? 1,
    createdAt: update.createdAt ?? Date.now(),
  }, scope, queue.comments.length));
  return commitQueueMutation(undefined);
});

export const rebaseOfflineCommentUpdateAfterConflictAsync = (
  commentId: number,
  remoteBase: Pick<
    OfflineCommentUpdate,
    "baseBody" | "lastKnownRemoteUpdatedAt" | "sourceNotesHash"
  >,
  scope = getActiveScope(),
  expected?: OfflineCommentConflictExpectation,
): Promise<OfflineCommentUpdate | undefined> => mutateQueueAsync(scope, (queue) => {
  const index = queue.comments.findIndex((entry) => entry.commentId === commentId);
  const existing = index === -1 ? undefined : queue.comments[index];
  if (
    !existing ||
    (existing.phase !== undefined && existing.phase !== "queued") ||
    existing.nextIntent !== undefined ||
    (existing.connectionScope !== undefined && existing.connectionScope !== scope) ||
    hasCurrentAttemptNonPlannedEffect(existing) ||
    (expected !== undefined && (
      existing.operationId !== expected.operationId ||
      existing.revision !== expected.revision ||
      (expected.intentRevision !== undefined &&
        (existing.intentRevision ?? existing.revision) !== expected.intentRevision) ||
      (expected.connectionScope !== undefined &&
        existing.connectionScope !== expected.connectionScope) ||
      existing.body !== expected.body
    ))
  ) {
    return skipQueueMutation(undefined);
  }
  const revision = Math.max(existing.revision ?? 1, existing.intentRevision ?? 0) + 1;
  const rebased: OfflineCommentUpdate = {
    ...existing,
    ...remoteBase,
    phase: "queued",
    revision,
    intentRevision: revision,
  };
  queue.comments[index] = rebased;
  return commitQueueMutation(rebased);
});

export const getOfflineCommentUpdate = (
  key: CommentQueueKey,
  scope = getActiveScope(),
): OfflineCommentUpdate | undefined => {
  const queue = getQueue(scope);
  const index = findCommentIndex(queue, key);
  return index === -1 ? undefined : structuredClone(queue.comments[index]);
};

export const discardOfflineCommentUpdateAsync = (
  key: CommentQueueKey,
  scope: string,
): Promise<OfflineDiscardResult> =>
  commitOfflineDiscardAsync(prepareOfflineDiscard({ kind: "comment", ...key }, scope));

export const removeOfflineCommentEntryAsync = (
  params: CommentQueueKey,
  scope = getActiveScope(),
): Promise<void> => mutateQueueAsync(scope, (queue) => {
  const index = findCommentIndex(queue, params);
  if (index === -1 || isAbandoned(queue.comments[index])) { return skipQueueMutation(undefined); }
  queue.comments.splice(index, 1);
  return commitQueueMutation(undefined);
});

export const removeOfflineCommentEntryIfMatchesAsync = (
  params: { ticketId: number; commentId?: number; documentUri?: string },
  expected: OfflineCommentConflictExpectation | undefined,
  scope = getActiveScope(),
): Promise<boolean> => mutateQueueAsync(scope, (queue) => {
  const index = findCommentIndex(queue, params);
  if (index === -1) {
    return skipQueueMutation(expected === undefined);
  }
  const current = queue.comments[index];
  if (
    expected === undefined ||
    isAbandoned(current) ||
    (current.phase !== undefined && current.phase !== "queued") ||
    current.nextIntent !== undefined ||
    (current.connectionScope !== undefined && current.connectionScope !== scope) ||
    current.operationId !== expected.operationId ||
    current.revision !== expected.revision ||
    (expected.intentRevision !== undefined &&
      (current.intentRevision ?? current.revision) !== expected.intentRevision) ||
    (expected.connectionScope !== undefined &&
      current.connectionScope !== expected.connectionScope) ||
    current.body !== expected.body
  ) {
    return skipQueueMutation(false);
  }
  queue.comments.splice(index, 1);
  return commitQueueMutation(true);
});
