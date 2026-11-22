import { randomUUID } from "crypto";
import { getPrimaryEffectForRevision, isRejectedTicketCreate } from "../app/syncEffects";
import { commitOfflineDiscardAsync, prepareOfflineDiscard } from "./offlineSyncDiscard";
import { resolveRevisionForEditedQueuedFailure } from "./offlineSyncIntentRevision";
import { isAbandoned } from "./offlineSyncPolicy";
import { findNewTicketIndex, sameDocumentIdentity } from "./offlineSyncQueueEntries";
import { commitQueueMutation, getActiveScope, getQueue, mutateQueueAsync, skipQueueMutation } from "./offlineSyncQueueStorage";
import type { OfflineDiscardResult, OfflineNewTicket } from "./offlineSyncTypes";

export const addOfflineNewTicketAsync = async (
  update: Omit<OfflineNewTicket, "queueId"> & { queueId?: string },
  scope = getActiveScope(),
): Promise<OfflineNewTicket> => mutateQueueAsync(scope, (queue) => {
  const index = update.documentUri
    ? queue.newTickets.findIndex(
      (item) => sameDocumentIdentity(item.documentUri, update.documentUri),
    )
    : update.queueId
      ? queue.newTickets.findIndex((item) => item.queueId === update.queueId)
      : -1;
  const queueId = update.queueId ?? randomUUID();
  const existing = index === -1 ? undefined : queue.newTickets[index];
  if (existing && isAbandoned(existing)) { return skipQueueMutation(existing); }
  const primary = existing && getPrimaryEffectForRevision(existing);
  const rejected = primary && isRejectedTicketCreate(primary);
  if (existing && rejected && (existing.nextIntent?.content ?? existing.content) === update.content) {
    return skipQueueMutation(existing);
  }
  const entry: OfflineNewTicket = index === -1
    ? {
      ...update,
      queueId,
      operationId: update.operationId ?? queueId,
      phase: update.phase ?? "queued",
      connectionScope: update.connectionScope ?? scope,
      revision: update.revision ?? 1,
      createdAt: update.createdAt ?? Date.now(),
    }
    : existing && (rejected || (existing.phase && existing.phase !== "queued" && existing.phase !== "completed"))
      ? {
        ...existing,
        documentUri: existing.documentUri ?? update.documentUri,
        nextIntent: {
          revision: Math.max(
            existing.revision ?? 1,
            existing.nextIntent?.revision ?? 0,
          ) + 1,
          content: update.content,
          projectId: update.projectId ?? existing.projectId,
          documentUri: update.documentUri ?? existing.documentUri,
          baseDir: update.baseDir ?? existing.baseDir,
        },
      }
      : (() => {
        const failedRecovery = existing && existing.content !== update.content
          ? resolveRevisionForEditedQueuedFailure(existing)
          : undefined;
        const resolvedRevision = failedRecovery?.revision ?? existing?.revision ?? update.revision ?? 1;
        return {
          ...existing,
          ...update,
          queueId: existing?.queueId ?? queueId,
          revision: resolvedRevision,
          ...(failedRecovery
            ? {
              intentRevision: resolvedRevision,
              effects: failedRecovery.effects,
              preparationFailure: undefined,
            }
            : {}),
        };
      })();
  if (index === -1) {
    queue.newTickets.unshift(entry);
  } else {
    queue.newTickets[index] = entry;
  }
  return commitQueueMutation(entry);
});

export const getOfflineNewTicket = (
  key: { queueId?: string; documentUri?: string },
  scope: string,
): OfflineNewTicket | undefined => {
  const queue = getQueue(scope);
  const index = findNewTicketIndex(queue, key);
  return index === -1 ? undefined : structuredClone(queue.newTickets[index]);
};

export const updateOfflineNewTicketAsync = async (
  key: { queueId?: string; documentUri?: string },
  updates: Partial<Pick<OfflineNewTicket, "createdIssueId" | "status" | "phase" | "remoteUpdatedAt" | "createdChildIds">>,
  scope = getActiveScope(),
  expectedRevision?: number,
): Promise<OfflineNewTicket | undefined> => {
  try {
    return await mutateQueueAsync(scope, (queue) => {
      const index = findNewTicketIndex(queue, key);
      if (index === -1 || (
        expectedRevision !== undefined && queue.newTickets[index].revision !== expectedRevision
      )) {
        return skipQueueMutation(undefined);
      }
      if (updates.phase === "queued" && queue.newTickets[index].nextIntent) {
        return skipQueueMutation(undefined);
      }
      const next = { ...queue.newTickets[index], ...updates };
      queue.newTickets[index] = next;
      return commitQueueMutation(next);
    });
  } catch {
    return undefined;
  }
};

export const removeOfflineNewTicketAsync = async (
  key: { queueId?: string; documentUri?: string },
  scope = getActiveScope(),
): Promise<void> => {
  return mutateQueueAsync(scope, (queue) => {
    const previousLength = queue.newTickets.length;
    queue.newTickets = queue.newTickets.filter((ticket) => {
      if (key.queueId && ticket.queueId === key.queueId) {
        return false;
      }
      return !sameDocumentIdentity(ticket.documentUri, key.documentUri);
    });
    return queue.newTickets.length === previousLength
      ? skipQueueMutation(undefined)
      : commitQueueMutation(undefined);
  });
};

export const discardOfflineNewTicketAsync = (
  key: { queueId?: string; documentUri?: string },
  scope: string,
): Promise<OfflineDiscardResult> =>
  commitOfflineDiscardAsync(prepareOfflineDiscard({ kind: "newTicket", ...key }, scope));
