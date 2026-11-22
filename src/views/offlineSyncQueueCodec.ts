import { randomUUID } from "crypto";
import {
  getAttemptGeneration,
  getPrimaryEffectForRevision,
  hasUncertainPrimaryDurableSyncEffect,
  isRejectedTicketCreate,
  normalizeAttemptGeneration,
  restoreDurableSyncEffect,
  type DurableSyncEffect,
} from "../app/syncEffects";
import { promoteCommentIntent, promoteNewTicketIntent, promoteTicketIntent } from "./offlineSyncIntentPromotion";
import { isAbandoned } from "./offlineSyncPolicy";
import { primaryEffectId, primaryEffectKind } from "./offlineSyncPrimaryEffects";
import type {
  NewTicketSyncPhase,
  OfflineCommentUpdate,
  OfflineNewTicket,
  OfflineSyncQueue,
  OfflineTicketUpdate,
  SyncOperation,
  SyncOperationKind,
  TicketEditAuthorization,
  TicketUpdateSyncPhase,
} from "./offlineSyncTypes";

export type SerializedQueue = {
  version?: 2 | 3;
  operations?: SyncOperation[];
  ticketEditAuthorizations?: TicketEditAuthorization[];
  tickets?: Array<[number, OfflineTicketUpdate] | OfflineTicketUpdate>;
  comments?: OfflineCommentUpdate[];
  newTickets?: OfflineNewTicket[];
};

export const emptyQueue = (): OfflineSyncQueue => ({
  tickets: new Map<number, OfflineTicketUpdate>(),
  abandonedTickets: [],
  comments: [],
  newTickets: [],
});

const normalizeOperationEffects = (input: {
  kind: SyncOperationKind;
  revision: number;
  attemptGeneration?: number;
  phase: SyncOperation["phase"];
  payload: OfflineNewTicket | OfflineTicketUpdate | OfflineCommentUpdate;
  effects?: DurableSyncEffect[];
}): DurableSyncEffect[] => {
  const attemptGeneration = normalizeAttemptGeneration(input.attemptGeneration);
  const storedEffects = Array.isArray(input.effects) ? input.effects : input.payload.effects;
  if (Array.isArray(storedEffects)) {
    return storedEffects.map((effect) => ({
      ...restoreDurableSyncEffect(effect),
      attemptGeneration: normalizeAttemptGeneration(effect.attemptGeneration ?? attemptGeneration),
    }));
  }
  const remoteId = input.kind === "ticketCreate"
    ? (input.payload as OfflineNewTicket).createdIssueId
    : input.kind === "commentCreate"
      ? (input.payload as OfflineCommentUpdate).commentId
      : undefined;
  const uncertain = input.phase === "remote_write_started" || input.phase === "commit_unknown";
  const committed = remoteId !== undefined || [
    "remote_created",
    "remote_committed",
    "reconciliation_pending",
    "local_finalize_pending",
    "completed",
  ].includes(input.phase);
  const effects: DurableSyncEffect[] = uncertain || committed
    ? [{
      effectId: primaryEffectId(input.kind),
      kind: primaryEffectKind(input.kind),
      operationRevision: input.revision,
      attemptGeneration,
      state: uncertain ? "commit_unknown" : "committed",
      target: input.kind === "ticketUpdate" || input.kind === "commentCreate" ||
        input.kind === "commentUpdate"
        ? { ticketId: (input.payload as OfflineTicketUpdate | OfflineCommentUpdate).ticketId }
        : {},
      ...(remoteId === undefined ? {} : { remoteId }),
    }]
    : [];
  const childIds = "createdChildIds" in input.payload
    ? input.payload.createdChildIds
    : undefined;
  if (Array.isArray(childIds)) {
    childIds.forEach((childId, ordinal) => {
      effects.push({
        effectId: `legacy-child:${childId}`,
        kind: "child_create",
        operationRevision: input.revision,
        attemptGeneration,
        state: "committed",
        target: { ordinal },
        remoteId: childId,
      });
    });
  }
  return effects;
};

const businessPayload = <T extends OfflineNewTicket | OfflineTicketUpdate | OfflineCommentUpdate>(
  payload: T,
): T => {
  const copy = { ...payload };
  delete copy.operationId;
  delete copy.connectionScope;
  delete copy.phase;
  delete copy.attemptGeneration;
  delete copy.revision;
  delete copy.createdAt;
  delete copy.effects;
  delete copy.disposition;
  return copy;
};

const operationFromTicketUpdate = (
  update: OfflineTicketUpdate,
  scope: string,
): SyncOperation => {
  const revision = Math.max(update.revision ?? 1, update.intentRevision ?? 0);
  const phase = update.phase ?? "queued";
  return ({
  operationId: update.operationId ?? `ticket:${update.ticketId}`,
  kind: "ticketUpdate",
    connectionScope: update.connectionScope ?? scope,
    revision,
    intentRevision: revision,
  attemptGeneration: getAttemptGeneration(update),
  phase,
  documentUri: update.documentUri,
  createdAt: update.createdAt ?? 0,
  effects: normalizeOperationEffects({ kind: "ticketUpdate", revision, attemptGeneration: getAttemptGeneration(update), phase, payload: update, effects: update.effects }),
  disposition: update.disposition,
  payload: businessPayload(update),
  });
};

const operationFromNewTicket = (
  ticket: OfflineNewTicket,
  scope: string,
): SyncOperation => {
  const revision = ticket.revision ?? 1;
  const phase = ticket.phase ?? "queued";
  return ({
  operationId: ticket.operationId ?? ticket.queueId,
  kind: "ticketCreate",
  connectionScope: ticket.connectionScope ?? scope,
  revision,
  attemptGeneration: getAttemptGeneration(ticket),
  phase,
  documentUri: ticket.documentUri,
  createdAt: ticket.createdAt ?? 0,
  effects: normalizeOperationEffects({ kind: "ticketCreate", revision, attemptGeneration: getAttemptGeneration(ticket), phase, payload: ticket, effects: ticket.effects }),
  disposition: ticket.disposition,
  payload: businessPayload(ticket),
  });
};

const getStoredCommentKind = (comment: OfflineCommentUpdate): "commentCreate" | "commentUpdate" => {
  const primaryKind = comment.effects?.find((effect) =>
    effect.kind === "comment_create" || effect.kind === "comment_update"
  )?.kind;
  if (primaryKind === "comment_create") { return "commentCreate"; }
  if (primaryKind === "comment_update") { return "commentUpdate"; }
  return comment.commentId === undefined ? "commentCreate" : "commentUpdate";
};

const operationFromComment = (
  comment: OfflineCommentUpdate,
  scope: string,
  index: number,
): SyncOperation => {
  const revision = Math.max(comment.revision ?? 1, comment.intentRevision ?? 0);
  const phase = comment.phase ?? "queued";
  const kind = getStoredCommentKind(comment);
  return ({
  operationId: comment.operationId ??
    `comment:${comment.ticketId}:${comment.commentId ?? comment.documentUri ?? index}`,
    kind,
    connectionScope: comment.connectionScope ?? scope,
    revision,
    intentRevision: revision,
  attemptGeneration: getAttemptGeneration(comment),
  phase,
  documentUri: comment.documentUri,
  createdAt: comment.createdAt ?? 0,
  effects: normalizeOperationEffects({ kind, revision, attemptGeneration: getAttemptGeneration(comment), phase, payload: comment, effects: comment.effects }),
  disposition: comment.disposition,
  payload: businessPayload(comment),
  });
};

export const operationsFromQueue = (queue: OfflineSyncQueue, scope: string): SyncOperation[] => [
  ...queue.newTickets.map((ticket) => operationFromNewTicket(ticket, scope)),
  ...Array.from(queue.tickets.values()).map((update) => operationFromTicketUpdate(update, scope)),
  ...(queue.abandonedTickets ?? []).map((update) => operationFromTicketUpdate(update, scope)),
  ...queue.comments.map((comment, index) => operationFromComment(comment, scope, index)),
];

const queueFromOperations = (operations: SyncOperation[]): OfflineSyncQueue => {
  const queue = emptyQueue();
  for (const operation of operations) {
    switch (operation.kind) {
      case "ticketCreate":
        queue.newTickets.push(normalizeNewTicket({
          ...(operation.payload as OfflineNewTicket),
          operationId: operation.operationId,
          connectionScope: operation.connectionScope,
          revision: operation.revision,
          attemptGeneration: operation.attemptGeneration,
          phase: operation.phase as NewTicketSyncPhase,
          createdAt: operation.createdAt,
          effects: normalizeOperationEffects({ ...operation, attemptGeneration: operation.attemptGeneration, effects: operation.effects }),
          disposition: operation.disposition,
        }));
        break;
      case "ticketUpdate": {
        const update: OfflineTicketUpdate = {
          ...(operation.payload as OfflineTicketUpdate),
          operationId: operation.operationId,
          connectionScope: operation.connectionScope,
          revision: operation.intentRevision ?? operation.revision,
          intentRevision: operation.intentRevision ?? operation.revision,
          attemptGeneration: operation.attemptGeneration,
          phase: operation.phase as TicketUpdateSyncPhase,
          createdAt: operation.createdAt,
          effects: normalizeOperationEffects({ ...operation, attemptGeneration: operation.attemptGeneration, effects: operation.effects }),
          disposition: operation.disposition,
        };
        const normalized = normalizeTicketUpdate(update.ticketId, update);
        if (isAbandoned(normalized)) {
          queue.abandonedTickets!.push(normalized);
        } else {
          queue.tickets.set(update.ticketId, normalized);
        }
        break;
      }
      case "commentCreate":
      case "commentUpdate": {
      const comment = normalizeComment({
        ...(operation.payload as OfflineCommentUpdate),
        operationId: operation.operationId,
        connectionScope: operation.connectionScope,
        revision: operation.intentRevision ?? operation.revision,
        intentRevision: operation.intentRevision ?? operation.revision,
          attemptGeneration: operation.attemptGeneration,
          phase: (operation.phase === "remote_write_started" ? "commit_unknown" : operation.phase) as TicketUpdateSyncPhase,
          createdAt: operation.createdAt,
          effects: normalizeOperationEffects({ ...operation, attemptGeneration: operation.attemptGeneration, effects: operation.effects }),
          disposition: operation.disposition,
        }, operation.connectionScope, queue.comments.length);
        queue.comments.push(comment);
        break;
      }
    }
  }
  return queue;
};

export const serializeQueueFrom = (
  queue: OfflineSyncQueue,
  scope: string,
): SerializedQueue => ({
  version: 3,
  operations: operationsFromQueue(queue, scope),
  ticketEditAuthorizations: queue.ticketEditAuthorizations,
});

const normalizeTicketUpdate = (
  ticketId: number,
  update: OfflineTicketUpdate,
): OfflineTicketUpdate => {
  const revision = Math.max(update.revision ?? 1, update.intentRevision ?? 0);
  const attemptGeneration = getAttemptGeneration(update);
  const phase = update.phase === "remote_write_started" ? "commit_unknown" : update.phase ?? "queued";
  const effects = normalizeOperationEffects({
    kind: "ticketUpdate",
    revision,
    attemptGeneration,
    phase,
    payload: update,
    effects: update.effects,
  });
  const restoredPhase = hasUncertainPrimaryDurableSyncEffect(effects) &&
    (phase === "preparing" || phase === "queued")
    ? "commit_unknown"
    : phase;
  const restored: OfflineTicketUpdate = {
    ...update,
    operationId: update.operationId ?? `ticket:${ticketId}`,
    phase: restoredPhase,
    revision,
    intentRevision: revision,
    attemptGeneration,
    effects,
  };
  const hasRemoteChild = restored.effects?.some((effect) => effect.kind === "child_create" && [
    "committed",
    "commit_unknown",
    "compensation_started",
    "compensation_unknown",
  ].includes(effect.state));
  if (hasRemoteChild) {
    return restored;
  }
  return restored.phase === "preparing" || restored.phase === "queued"
    ? promoteTicketIntent(restored)
    : restored;
};

const normalizeNewTicket = (ticket: OfflineNewTicket): OfflineNewTicket => {
  const revision = ticket.revision ?? 1;
  const attemptGeneration = getAttemptGeneration(ticket);
  const phase = ticket.phase === "remote_write_started" ? "commit_unknown" : ticket.phase ?? (
    ticket.createdIssueId !== undefined || ticket.status === "created_rewrite_failed"
      ? "local_finalize_pending"
      : "queued"
  );
  const effects = normalizeOperationEffects({
    kind: "ticketCreate",
    revision,
    attemptGeneration,
    phase,
    payload: ticket,
    effects: ticket.effects,
  });
  const restoredPhase = hasUncertainPrimaryDurableSyncEffect(effects) &&
    (phase === "preparing" || phase === "queued")
    ? "commit_unknown"
    : phase;
  const restored: OfflineNewTicket = {
    ...ticket,
    operationId: ticket.operationId ?? ticket.queueId,
    revision,
    attemptGeneration,
    phase: restoredPhase,
    effects,
  };
  const primary = getPrimaryEffectForRevision(restored);
  return (restored.phase === "preparing" || restored.phase === "queued") &&
    !(primary && isRejectedTicketCreate(primary))
    ? promoteNewTicketIntent(restored)
    : restored;
};

export const normalizeComment = (
  comment: OfflineCommentUpdate,
  scope: string,
  index: number,
): OfflineCommentUpdate => {
  const attemptGeneration = getAttemptGeneration(comment);
  const kind = getStoredCommentKind(comment);
  const revision = Math.max(comment.revision ?? 1, comment.intentRevision ?? 0);
  const phase = comment.phase === "remote_write_started"
    ? "commit_unknown"
    : comment.phase ?? "queued";
  const effects = normalizeOperationEffects({
    kind,
    revision,
    attemptGeneration,
    phase,
    payload: comment,
    effects: comment.effects,
  });
  const restoredPhase = hasUncertainPrimaryDurableSyncEffect(effects) &&
    (phase === "preparing" || phase === "queued")
    ? "commit_unknown"
    : phase;
  const restored: OfflineCommentUpdate = {
    ...comment,
    operationId: comment.operationId ??
      `comment:${comment.ticketId}:${comment.commentId ?? comment.documentUri ?? index}`,
    connectionScope: comment.connectionScope ?? scope,
    revision,
    intentRevision: revision,
    attemptGeneration,
    phase: restoredPhase,
    effects,
  };
  return restored.phase === "preparing" || restored.phase === "queued"
    ? promoteCommentIntent(restored)
    : restored;
};

const isLegacyTicketTuple = (entry: NonNullable<SerializedQueue["tickets"]>[number]):
  entry is [number, OfflineTicketUpdate] =>
  Array.isArray(entry) && typeof entry[0] === "number" && entry[1] !== null && typeof entry[1] === "object";

const normalizeLegacyTicketEntry = (entry: NonNullable<SerializedQueue["tickets"]>[number]):
  [number, OfflineTicketUpdate] | undefined => {
  if (isLegacyTicketTuple(entry)) {
    return [entry[0], normalizeTicketUpdate(entry[0], entry[1])];
  }
  if (entry && typeof entry === "object" && "ticketId" in entry && typeof entry.ticketId === "number") {
    return [entry.ticketId, normalizeTicketUpdate(entry.ticketId, entry)];
  }
  return undefined;
};

export const deserializeQueue = (raw: SerializedQueue | undefined, legacyCommentScope: string): OfflineSyncQueue => {
  if (raw && Array.isArray(raw.operations)) {
    const valid = raw.operations.filter((operation): operation is SyncOperation =>
      operation !== null &&
      typeof operation === "object" &&
      typeof operation.operationId === "string" &&
      typeof operation.kind === "string" &&
      operation.payload !== null &&
      typeof operation.payload === "object",
    );
    const queue = queueFromOperations(valid);
    const authorizations = (Array.isArray(raw.ticketEditAuthorizations) ? raw.ticketEditAuthorizations : []).filter((entry) =>
      entry && Number.isSafeInteger(entry.ticketId) && entry.ticketId > 0 &&
      typeof entry.documentUri === "string" && entry.documentUri.length > 0 &&
      typeof entry.editSessionId === "string" && entry.editSessionId.length > 0,
    ).map((entry) => ({ ...entry }));
    for (const update of queue.tickets.values()) {
      if (update.documentUri &&
          queue.abandonedTickets?.some((entry) => entry.ticketId === update.ticketId) &&
          !authorizations.some((entry) => entry.ticketId === update.ticketId)) {
        authorizations.push({
          ticketId: update.ticketId,
          documentUri: update.documentUri,
          editSessionId: randomUUID(),
        });
      }
    }
    if (Array.isArray(raw.ticketEditAuthorizations) || authorizations.length > 0) {
      queue.ticketEditAuthorizations = authorizations;
    }
    return queue;
  }
  const legacyQueue: OfflineSyncQueue = {
    tickets: new Map(
      raw && Array.isArray(raw.tickets)
        ? raw.tickets
          .map(normalizeLegacyTicketEntry)
          .filter((e): e is [number, OfflineTicketUpdate] => e !== undefined)
        : [],
    ),
    abandonedTickets: [],
    comments:
      raw && Array.isArray(raw.comments)
        ? raw.comments
          .filter((c) => c !== null && typeof c === "object")
          .map((comment, index) => normalizeComment(comment, legacyCommentScope, index))
        : [],
    newTickets:
      raw && Array.isArray(raw.newTickets)
        ? raw.newTickets
          .filter((t) => t !== null && typeof t === "object")
          .map(normalizeNewTicket)
        : [],
  };
  for (const [ticketId, update] of legacyQueue.tickets) {
    if (isAbandoned(update)) {
      legacyQueue.abandonedTickets!.push(update);
      legacyQueue.tickets.delete(ticketId);
    }
  }
  return legacyQueue;
};
