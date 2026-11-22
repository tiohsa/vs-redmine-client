import { randomUUID } from "crypto";
import { isDeepStrictEqual } from "util";
import { getAttemptGeneration } from "../app/syncEffects";
import { buildTicketEditorContent, type TicketEditorContent } from "./ticketEditorContent";
import { commitOfflineDiscardAsync, prepareOfflineDiscard } from "./offlineSyncDiscard";
import { hasCurrentAttemptNonPlannedEffect, resolveRevisionForEditedQueuedFailure } from "./offlineSyncIntentRevision";
import { isAbandoned } from "./offlineSyncPolicy";
import { commitQueueMutation, getActiveScope, getQueue, mutateQueueAsync, skipQueueMutation } from "./offlineSyncQueueStorage";
import type { OfflineDiscardResult, OfflineTicketUpdate, QueuedTicketCancellationExpectation, QueuedTicketCancelResult, TicketEditAuthorization } from "./offlineSyncTypes";

export type OfflineTicketConflictExpectation = Pick<
  OfflineTicketUpdate,
  "operationId" | "revision" | "intentRevision" | "attemptGeneration" | "connectionScope" | "content"
>;

export const mergeOfflineTicketUpdate = (
  ticketId: number,
  existing: OfflineTicketUpdate | undefined,
  update: OfflineTicketUpdate,
): OfflineTicketUpdate => {
  if (existing?.phase && existing.phase !== "queued" && existing.phase !== "completed") {
    const revision = Math.max(
      existing.revision ?? 1,
      existing.nextIntent?.revision ?? 0,
    ) + 1;
    const fallbackNextContent = update.content ?? (update.subject ? buildTicketEditorContent(update) : update.description);
    return {
      ...existing,
      documentUri: existing.documentUri ?? update.documentUri,
      nextIntent: {
        revision,
        subject: update.subject,
        description: update.description,
        content: fallbackNextContent,
        metadata: update.metadata,
        attachments: update.attachments,
        uploadTokens: update.uploadTokens,
        childTickets: update.childTickets,
        layout: update.layout,
        metadataBlock: update.metadataBlock,
        controlFields: update.controlFields,
        baseDir: update.baseDir,
        documentUri: update.documentUri ?? existing.documentUri,
      },
    };
  }
  const fallbackContent = update.content ?? existing?.content ?? (update.subject ? buildTicketEditorContent(update) : update.description);
  const existingContent = existing
    ? (existing.content ?? (existing.subject ? buildTicketEditorContent(existing) : existing.description))
    : undefined;
  const hasPayloadChange = Boolean(
    existing && (
      fallbackContent !== existingContent ||
      update.subject !== existing.subject ||
      update.description !== existing.description ||
      !isDeepStrictEqual(update.metadata, existing.metadata)
    ),
  );
  const failedRecovery = existing && hasPayloadChange
    ? resolveRevisionForEditedQueuedFailure(existing)
    : undefined;
  const resolvedRevision = failedRecovery?.revision ?? existing?.revision ?? update.revision ?? 1;
  return {
    ...(existing ?? update),
    ...update,
    content: fallbackContent,
    baseSubject: existing?.baseSubject ?? update.baseSubject,
    baseDescription: existing?.baseDescription ?? update.baseDescription,
    baseMetadata: existing?.baseMetadata ?? update.baseMetadata,
    lastKnownRemoteUpdatedAt:
      existing?.lastKnownRemoteUpdatedAt ?? update.lastKnownRemoteUpdatedAt,
    operationId: existing?.operationId ?? update.operationId ?? `ticket:${ticketId}`,
    connectionScope: existing?.connectionScope ?? update.connectionScope,
    phase: update.phase ?? existing?.phase,
    remoteUpdatedAt: existing?.remoteUpdatedAt ?? update.remoteUpdatedAt,
    createdChildIds: existing?.createdChildIds ?? update.createdChildIds,
    revision: resolvedRevision,
    ...(failedRecovery
      ? { intentRevision: resolvedRevision, effects: failedRecovery.effects }
      : {}),
    createdAt: existing?.createdAt ?? update.createdAt ?? Date.now(),
  };
};

export const beginFreshTicketEdit = (
  ticketId: number, documentUri: string, scope = getActiveScope(),
): Promise<TicketEditAuthorization | undefined> => mutateQueueAsync(scope, (queue) => {
  if (queue.tickets.has(ticketId) ||
      !queue.abandonedTickets?.some((entry) => entry.ticketId === ticketId) ||
      queue.abandonedTickets.some((entry) => entry.ticketId === ticketId && entry.documentUri === documentUri)) {
    return skipQueueMutation(undefined);
  }
  const authorization = { ticketId, documentUri, editSessionId: randomUUID() };
  queue.ticketEditAuthorizations = [
    ...(queue.ticketEditAuthorizations ?? []).filter((entry) => entry.ticketId !== ticketId),
    authorization,
  ];
  return commitQueueMutation({ ...authorization });
});

export const getTicketEditAuthorization = (ticketId: number, scope = getActiveScope()):
  TicketEditAuthorization | undefined => {
  const authorization = getQueue(scope).ticketEditAuthorizations?.find((entry) => entry.ticketId === ticketId);
  return authorization ? { ...authorization } : undefined;
};

export const addOfflineTicketUpdateAsync = (
  ticketId: number,
  update: OfflineTicketUpdate,
  scope = getActiveScope(),
  editSessionId?: string,
): Promise<boolean> => mutateQueueAsync(scope, (queue) => {
  const existing = queue.tickets.get(ticketId);
  if (existing && isAbandoned(existing)) { return skipQueueMutation(false); }
  if ((queue.abandonedTickets ?? []).some((entry) => entry.ticketId === ticketId)) {
    if (existing) {
      if (update.operationId !== existing.operationId || update.documentUri !== existing.documentUri) {
        return skipQueueMutation(false);
      }
    } else {
      const authorization = queue.ticketEditAuthorizations?.find((entry) => entry.ticketId === ticketId);
      if (!authorization || authorization.editSessionId !== editSessionId ||
          update.documentUri !== authorization.documentUri || update.operationId !== undefined) {
        return skipQueueMutation(false);
      }
      update = { ...update, operationId: `${scope}:ticket:${ticketId}:${randomUUID()}`, connectionScope: scope };
    }
  }
  queue.tickets.set(ticketId, mergeOfflineTicketUpdate(ticketId, existing, update));
  return commitQueueMutation(true);
});

export const updateQueuedTicketIntentAsync = (
  ticketId: number,
  scope: string,
  update: (current: TicketEditorContent) => TicketEditorContent,
): Promise<TicketEditorContent | undefined> => mutateQueueAsync(scope, (queue) => {
  const existing = queue.tickets.get(ticketId);
  if (!existing || isAbandoned(existing)) {
    return skipQueueMutation(undefined);
  }
  const current = existing.nextIntent ?? existing;
  const next = update(current);
  queue.tickets.set(ticketId, mergeOfflineTicketUpdate(ticketId, existing, {
    ...existing,
    ...next,
    content: buildTicketEditorContent(next),
    baseDir: current.baseDir,
    documentUri: current.documentUri,
  }));
  return commitQueueMutation(next);
});

export const rebaseOfflineTicketUpdateAfterConflictAsync = (
  ticketId: number,
  remoteBase: Pick<
    OfflineTicketUpdate,
    "baseSubject" | "baseDescription" | "baseMetadata" | "lastKnownRemoteUpdatedAt"
  >,
  scope = getActiveScope(),
  expected?: OfflineTicketConflictExpectation,
): Promise<OfflineTicketUpdate | undefined> => mutateQueueAsync(scope, (queue) => {
  const existing = queue.tickets.get(ticketId);
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
      (expected.attemptGeneration !== undefined &&
        getAttemptGeneration(existing) !== expected.attemptGeneration) ||
      (expected.connectionScope !== undefined &&
        existing.connectionScope !== expected.connectionScope) ||
      existing.content !== expected.content
    ))
  ) {
    return skipQueueMutation(undefined);
  }
  const revision = Math.max(existing.revision ?? 1, existing.intentRevision ?? 0) + 1;
  const rebased: OfflineTicketUpdate = {
    ...existing,
    ...remoteBase,
    phase: "queued",
    revision,
    intentRevision: revision,
  };
  queue.tickets.set(ticketId, rebased);
  return commitQueueMutation(rebased);
});

export const updateOfflineTicketUpdateAsync = async (
  ticketId: number,
  updates: Partial<Pick<OfflineTicketUpdate, "phase" | "remoteUpdatedAt" | "createdChildIds">>,
  scope: string,
  expectedRevision?: number,
): Promise<OfflineTicketUpdate | undefined> => {
  try {
    return await mutateQueueAsync(scope, (queue) => {
      const current = queue.tickets.get(ticketId);
      if (!current || (expectedRevision !== undefined && current.revision !== expectedRevision)) {
        return skipQueueMutation(undefined);
      }
      if (updates.phase === "queued" && current.nextIntent) {
        return skipQueueMutation(undefined);
      }
      const next = { ...current, ...updates };
      queue.tickets.set(ticketId, next);
      return commitQueueMutation(next);
    });
  } catch {
    return undefined;
  }
};

export const removeOfflineTicketUpdateAsync = async (
  ticketId: number,
  scope = getActiveScope(),
): Promise<void> => {
  return mutateQueueAsync(scope, (queue) => queue.tickets.delete(ticketId)
    ? commitQueueMutation(undefined)
    : skipQueueMutation(undefined));
};

export const removeOfflineTicketUpdateIfMatchesAsync = (
  ticketId: number,
  expected: OfflineTicketConflictExpectation | undefined,
  scope = getActiveScope(),
): Promise<boolean> => mutateQueueAsync(scope, (queue) => {
  const current = queue.tickets.get(ticketId);
  if (!current) {
    return skipQueueMutation(expected === undefined);
  }
  if (
    expected === undefined ||
    (current.phase !== undefined && current.phase !== "queued") ||
    current.nextIntent !== undefined ||
    (current.connectionScope !== undefined && current.connectionScope !== scope) ||
    current.operationId !== expected.operationId ||
    current.revision !== expected.revision ||
    (expected.intentRevision !== undefined &&
      (current.intentRevision ?? current.revision) !== expected.intentRevision) ||
    (expected.connectionScope !== undefined &&
      current.connectionScope !== expected.connectionScope) ||
    current.content !== expected.content
  ) {
        return skipQueueMutation(false);
  }
  queue.tickets.delete(ticketId);
  return commitQueueMutation(true);
});

export const cancelQueuedTicketUpdateIfMatchesAsync = async (
  ticketId: number,
  expected: QueuedTicketCancellationExpectation,
  scope: string,
): Promise<QueuedTicketCancelResult> => {
  const expectation = { ...expected };
  try {
    return await mutateQueueAsync<QueuedTicketCancelResult>(scope, (queue) => {
      const current = queue.tickets.get(ticketId);
      if (!current) {
        return skipQueueMutation("not_found");
      }
      if (
        (current.connectionScope !== undefined && current.connectionScope !== scope) ||
        current.connectionScope !== expectation.connectionScope ||
        current.operationId !== expectation.operationId ||
        (current.revision ?? 1) !== expectation.revision ||
        (current.intentRevision ?? current.revision ?? 1) !== expectation.intentRevision ||
        current.content !== expectation.content ||
        current.nextIntent !== undefined
      ) {
        return skipQueueMutation("stale");
      }
      if (
        current.phase !== "queued" ||
        current.remoteUpdatedAt !== undefined ||
        (current.createdChildIds?.length ?? 0) > 0 ||
        (current.effects ?? []).some((effect) =>
          effect.state !== "planned" || effect.remoteId !== undefined || effect.token !== undefined
        )
      ) {
        return skipQueueMutation("recovery_required");
      }
      queue.tickets.delete(ticketId);
      return commitQueueMutation("cancelled");
    });
  } catch {
    return "recovery_required";
  }
};

export const discardOfflineTicketUpdateAsync = (
  ticketId: number,
  scope: string,
): Promise<OfflineDiscardResult> =>
  commitOfflineDiscardAsync(prepareOfflineDiscard({ kind: "ticket", ticketId }, scope));
