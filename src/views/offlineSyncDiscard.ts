import { isDeepStrictEqual } from "util";
import { isOfflineSyncActive } from "./offlineSyncActiveOperations";
import { evaluateOfflineSyncPolicy, isAbandoned } from "./offlineSyncPolicy";
import { replaceStoredOperationInQueue, resolveStoredOfflineOperation, sameDocumentIdentity } from "./offlineSyncQueueEntries";
import { commitQueueMutation, getQueue, mutateQueueAsync, skipQueueMutation } from "./offlineSyncQueueStorage";
import type {
  OfflineAbandonPlan,
  OfflineAbandonResult,
  OfflineCommentUpdate,
  OfflineDiscardKey,
  OfflineDiscardPlan,
  OfflineDiscardResult,
  OfflineForgetAbandonedPlan,
  OfflineForgetAbandonedResult,
  OfflineForgetAllAbandonedPlan,
  OfflineNewTicket,
  OfflineSyncQueue,
  OfflineTicketUpdate,
  StoredOfflineOperation,
} from "./offlineSyncTypes";

const resolveOfflineDiscardTarget = (
  queue: OfflineSyncQueue,
  key: OfflineDiscardKey,
): StoredOfflineOperation | undefined => resolveStoredOfflineOperation(queue, key)?.value;

export const prepareOfflineDiscard = (
  key: OfflineDiscardKey,
  scope: string,
): OfflineDiscardPlan => {
  const operation = resolveOfflineDiscardTarget(getQueue(scope), key);
  return {
    key: structuredClone(key),
    scope,
    mode: operation ? evaluateOfflineSyncPolicy(operation).discardMode : "none",
    expectation: operation ? structuredClone(operation) : undefined,
  };
};

export const prepareOfflineAbandon = (key: OfflineDiscardKey, scope: string): OfflineAbandonPlan => ({
  key: structuredClone(key),
  scope,
  expectation: structuredClone(resolveOfflineDiscardTarget(getQueue(scope), key)),
});

export const commitOfflineAbandonAsync = async (plan: OfflineAbandonPlan): Promise<OfflineAbandonResult> => {
  try {
    return await mutateQueueAsync(plan.scope, (queue) => {
      if (!plan.expectation) { return skipQueueMutation("not_found" as const); }
      const operation = resolveOfflineDiscardTarget(queue, plan.key);
      if (!operation || !isDeepStrictEqual(operation, plan.expectation) ||
          (operation.connectionScope !== undefined && operation.connectionScope !== plan.scope) ||
          isAbandoned(operation)) {
        return skipQueueMutation("stale" as const);
      }
      if (isOfflineSyncActive(plan.scope, operation)) {
        return skipQueueMutation("busy" as const);
      }
      const abandoned = {
        ...operation,
        disposition: { kind: "abandoned" as const, abandonedAt: Date.now() },
      };
      if (plan.key.kind === "ticket") {
        const ticketId = plan.key.ticketId;
        queue.tickets.delete(ticketId);
        (queue.abandonedTickets ??= []).push(abandoned as OfflineTicketUpdate);
        queue.ticketEditAuthorizations = (queue.ticketEditAuthorizations ?? [])
          .filter((entry) => entry.ticketId !== ticketId);
      } else {
        replaceStoredOperationInQueue(queue, operation, abandoned);
      }
      return commitQueueMutation("abandoned" as const);
    });
  } catch {
    return "persistence_failed";
  }
};

export const prepareOfflineForgetAbandoned = (
  key: OfflineDiscardKey,
  scope: string,
): OfflineForgetAbandonedPlan => {
  const queue = getQueue(scope);
  const candidates: Array<OfflineNewTicket | OfflineTicketUpdate | OfflineCommentUpdate> = key.kind === "ticket"
    ? (queue.abandonedTickets ?? []).filter((item) => item.ticketId === key.ticketId &&
      (key.operationId === undefined || item.operationId === key.operationId) &&
      (key.abandonedAt === undefined || item.disposition?.abandonedAt === key.abandonedAt))
    : key.kind === "newTicket"
      ? queue.newTickets.filter((item) => isAbandoned(item) &&
        (key.queueId === undefined || item.queueId === key.queueId) &&
        (key.documentUri === undefined || sameDocumentIdentity(item.documentUri, key.documentUri)))
      : queue.comments.filter((item) => isAbandoned(item) && item.ticketId === key.ticketId &&
        (key.commentId === undefined || item.commentId === key.commentId) &&
        (key.operationId === undefined || item.operationId === key.operationId) &&
        (key.documentUri === undefined || item.documentUri === key.documentUri));
  return {
    key: structuredClone(key),
    scope,
    expectation: candidates.length === 1 ? structuredClone(candidates[0]) : undefined,
  };
};

export const prepareOfflineForgetAllAbandoned = (scope: string): OfflineForgetAllAbandonedPlan => {
  const queue = getQueue(scope);
  const items: OfflineForgetAbandonedPlan[] = [];
  for (const operation of queue.abandonedTickets ?? []) {
    if (isAbandoned(operation)) {
      items.push({ scope, key: { kind: "ticket", ticketId: operation.ticketId }, expectation: operation });
    }
  }
  for (const operation of queue.newTickets) {
    if (isAbandoned(operation)) {
      items.push({ scope, key: { kind: "newTicket", queueId: operation.queueId }, expectation: operation });
    }
  }
  for (const operation of queue.comments) {
    if (isAbandoned(operation)) {
      items.push({ scope, key: { kind: "comment", ticketId: operation.ticketId, operationId: operation.operationId }, expectation: operation });
    }
  }
  return { scope, items: structuredClone(items) };
};

const forgetAbandonedInQueue = (
  queue: OfflineSyncQueue,
  plan: OfflineForgetAbandonedPlan,
): OfflineForgetAbandonedResult => {
  if (!plan.expectation) { return "not_found"; }
  if (!isAbandoned(plan.expectation) ||
      (plan.expectation.connectionScope !== undefined && plan.expectation.connectionScope !== plan.scope)) {
    return "stale";
  }
  const list = plan.key.kind === "ticket"
    ? queue.abandonedTickets ?? []
    : plan.key.kind === "newTicket" ? queue.newTickets : queue.comments;
  const index = list.findIndex((item) => isAbandoned(item) && isDeepStrictEqual(item, plan.expectation));
  if (index < 0) { return "stale"; }
  const operation = list[index];
  if (isOfflineSyncActive(plan.scope, operation)) {
    return "busy";
  }
  list.splice(index, 1);
  return "removed";
};

export const commitOfflineForgetAllAbandonedAsync = async (
  plan: OfflineForgetAllAbandonedPlan,
): Promise<OfflineForgetAbandonedResult> => {
  try {
    return await mutateQueueAsync(plan.scope, (queue) => {
      if (!plan.items.length) { return skipQueueMutation("not_found" as const); }
      for (const item of plan.items) {
        if (item.scope !== plan.scope) { return skipQueueMutation("stale" as const); }
        const result = forgetAbandonedInQueue(queue, item);
        if (result !== "removed") { return skipQueueMutation(result); }
      }
      return commitQueueMutation("removed" as const);
    });
  } catch {
    return "persistence_failed";
  }
};

export const commitOfflineForgetAbandonedAsync = async (
  plan: OfflineForgetAbandonedPlan,
): Promise<OfflineForgetAbandonedResult> => {
  try {
    return await mutateQueueAsync(plan.scope, (queue) => {
      const result = forgetAbandonedInQueue(queue, plan);
      return result === "removed" ? commitQueueMutation(result) : skipQueueMutation(result);
    });
  } catch {
    return "persistence_failed";
  }
};

export const commitOfflineDiscardAsync = async (
  plan: OfflineDiscardPlan,
): Promise<OfflineDiscardResult> => {
  try {
    return await mutateQueueAsync(plan.scope, (queue) => {
      if (!plan.expectation) {
        return skipQueueMutation("not_found");
      }
      const operation = resolveOfflineDiscardTarget(queue, plan.key);
      if (!operation || !isDeepStrictEqual(operation, plan.expectation) ||
        evaluateOfflineSyncPolicy(operation).discardMode !== plan.mode || isAbandoned(operation)) {
        return skipQueueMutation("stale");
      }
      if (plan.mode === "none") {
        return skipQueueMutation("recovery_required");
      }
      if (plan.mode === "nextIntent") {
        replaceStoredOperationInQueue(queue, operation, { ...operation, nextIntent: undefined });
        return commitQueueMutation("discarded_next");
      }
      switch (plan.key.kind) {
        case "ticket":
          queue.tickets.delete(plan.key.ticketId);
          break;
        case "newTicket":
          queue.newTickets = queue.newTickets.filter((entry) => entry !== operation);
          break;
        case "comment":
          queue.comments = queue.comments.filter((entry) => entry !== operation);
          break;
      }
      return commitQueueMutation("discarded");
    });
  } catch {
    return "recovery_required";
  }
};
