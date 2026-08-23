import { randomUUID } from "crypto";
import type { Memento } from "vscode";
import { IssueMetadata } from "./ticketMetadataTypes";
import {
  buildTicketEditorContent,
  TicketEditorContent,
  TicketEditorLayout,
  TicketEditorMetadataBlock,
} from "./ticketEditorContent";
import type { FrontmatterControlFields } from "./ticketMetadataControlFields";
import { computeNotesHash } from "../utils/notesHash";
import {
  getAttemptGeneration,
  hasUncertainDurableSyncEffect,
  hasUncertainPrimaryDurableSyncEffect,
  normalizeAttemptGeneration,
  restoreDurableSyncEffect,
  transitionDurableSyncEffect,
  type DurableSyncEffect,
  type DurableSyncEffectAction,
  type DurableSyncEffectKind,
  type DurableSyncEffectState,
} from "../app/syncEffects";

export type TicketUpdateSyncPhase =
  | "queued"
  | "preparing"
  | "remote_write_started"
  | "commit_unknown"
  | "remote_committed"
  | "reconciliation_pending"
  | "local_finalize_pending"
  | "completed";

export type NewTicketSyncPhase =
  | "queued"
  | "preparing"
  | "remote_write_started"
  | "commit_unknown"
  | "remote_created"
  | "reconciliation_pending"
  | "local_finalize_pending"
  | "completed";

export type TicketUpdateIntentSnapshot = {
  revision: number;
  subject: string;
  description: string;
  metadata: IssueMetadata;
  content?: string;
  layout?: TicketEditorLayout;
  metadataBlock?: TicketEditorMetadataBlock;
  controlFields?: FrontmatterControlFields;
  baseDir?: string;
  documentUri?: string;
};

export type OfflineTicketUpdate = {
  ticketId: number;
  baseSubject: string;
  baseDescription: string;
  baseMetadata: IssueMetadata;
  lastKnownRemoteUpdatedAt?: string;
  subject: string;
  description: string;
  metadata: IssueMetadata;
  content?: string;
  layout?: TicketEditorLayout;
  metadataBlock?: TicketEditorMetadataBlock;
  controlFields?: FrontmatterControlFields;
  baseDir?: string;
  documentUri?: string;
  operationId?: string;
  connectionScope?: string;
  phase?: TicketUpdateSyncPhase;
  attemptGeneration?: number;
  remoteUpdatedAt?: string;
  createdChildIds?: number[];
  revision?: number;
  nextIntent?: TicketUpdateIntentSnapshot;
  createdAt?: number;
  effects?: DurableSyncEffect[];
};

export type OfflineCommentUpdate = {
  ticketId: number;
  commentId?: number;
  baseBody?: string;
  lastKnownRemoteUpdatedAt?: string;
  body: string;
  baseDir?: string;
  documentUri?: string;
  sourceNotesHash?: string;
  createdAt?: number;
  operationId?: string;
  connectionScope?: string;
  phase?: TicketUpdateSyncPhase;
  attemptGeneration?: number;
  revision?: number;
  effects?: DurableSyncEffect[];
  remoteProjectId?: number;
  finalizeDraft?: boolean;
  nextIntent?: CommentIntentSnapshot;
};

export type CommentIntentSnapshot = {
  revision: number;
  body: string;
  baseDir?: string;
  documentUri?: string;
};

export type SyncOperationKind =
  | "ticketCreate"
  | "ticketUpdate"
  | "commentCreate"
  | "commentUpdate";

export type SyncOperation = {
  operationId: string;
  kind: SyncOperationKind;
  connectionScope: string;
  revision: number;
  attemptGeneration?: number;
  phase: NewTicketSyncPhase | TicketUpdateSyncPhase | "queued";
  documentUri?: string;
  createdAt: number;
  effects: DurableSyncEffect[];
  payload: OfflineNewTicket | OfflineTicketUpdate | OfflineCommentUpdate;
};

export type NewTicketIntentSnapshot = {
  revision: number;
  content: string;
  projectId?: number;
  documentUri?: string;
  baseDir?: string;
};

export type OfflineNewTicket = {
  queueId: string;
  operationId?: string;
  content: string;
  projectId?: number;
  documentUri?: string;
  baseDir?: string;
  createdIssueId?: number;
  status?: "queued" | "created_rewrite_failed";
  phase?: NewTicketSyncPhase;
  connectionScope?: string;
  attemptGeneration?: number;
  remoteUpdatedAt?: string;
  createdChildIds?: number[];
  revision?: number;
  nextIntent?: NewTicketIntentSnapshot;
  createdAt?: number;
  effects?: DurableSyncEffect[];
};

export type OfflineSyncQueue = {
  tickets: Map<number, OfflineTicketUpdate>;
  comments: OfflineCommentUpdate[];
  newTickets: OfflineNewTicket[];
};

export type OfflineDiscardResult =
  | "discarded"
  | "discarded_next"
  | "recovery_required"
  | "not_found";

export type OfflineSyncLifecycle = "queued" | "recovery_pending" | "commit_unknown";

export type NewTicketLifecycleAction =
  | { kind: "begin_preparation" }
  | { kind: "abort_before_remote_write" }
  | { kind: "start_normal_remote_write" }
  | { kind: "start_explicit_retry_remote_write" }
  | { kind: "mark_commit_unknown" }
  | { kind: "record_remote_created"; ticketId: number }
  | { kind: "link_created_ticket"; ticketId: number }
  | { kind: "mark_reconciliation_pending"; remoteUpdatedAt?: string }
  | { kind: "mark_local_finalize_pending"; remoteUpdatedAt?: string }
  | { kind: "mark_compensation_pending" }
  | { kind: "complete_compensation" };

export type TicketUpdateLifecycleAction =
  | { kind: "begin_preparation" }
  | { kind: "abort_before_remote_write" }
  | { kind: "start_normal_remote_write" }
  | { kind: "start_explicit_retry_remote_write" }
  | { kind: "mark_commit_unknown" }
  | { kind: "record_remote_commit"; createdChildIds?: number[] }
  | { kind: "assume_update_committed" }
  | { kind: "mark_reconciliation_pending"; remoteUpdatedAt?: string }
  | { kind: "mark_local_finalize_pending"; remoteUpdatedAt?: string }
  | { kind: "mark_compensation_pending" };

export type CommentLifecycleAction =
  | { kind: "begin_preparation" }
  | { kind: "abort_before_remote_write" }
  | { kind: "start_normal_remote_write" }
  | { kind: "mark_commit_unknown" }
  | { kind: "assume_remote_commit"; commentId: number; projectId: number }
  | { kind: "abort_known_remote_failure" }
  | { kind: "record_remote_commit"; commentId?: number; projectId?: number }
  | { kind: "record_reconciled_identity"; commentId: number; projectId?: number }
  | { kind: "mark_reconciliation_pending" }
  | { kind: "mark_local_finalize_pending" };

export type LifecycleTransitionExpectation<Phase extends string> = {
  operationId: string;
  revision: number;
  attemptGeneration?: number;
  sourcePhase: Phase;
};

export const getOfflineSyncLifecycle = (
  operation: Pick<OfflineNewTicket | OfflineTicketUpdate, "phase">,
): OfflineSyncLifecycle => {
  if (operation.phase === "commit_unknown" || operation.phase === "remote_write_started") {
    return "commit_unknown";
  }
  if (operation.phase && operation.phase !== "queued" && operation.phase !== "completed") {
    return "recovery_pending";
  }
  return "queued";
};

const STORAGE_KEY = "redmine.offlineSyncQueue";
const storageKeyForScope = (scope?: string): string =>
  scope ? `${STORAGE_KEY}.${encodeURIComponent(scope)}` : STORAGE_KEY;

type QueueChangeListener = () => void;

const queueChangeListeners = new Set<QueueChangeListener>();

const notifyQueueChanged = (): void => {
  for (const listener of Array.from(queueChangeListeners)) {
    listener();
  }
};

export const onOfflineSyncQueueChanged = (
  listener: QueueChangeListener,
): (() => void) => {
  queueChangeListeners.add(listener);
  return () => {
    queueChangeListeners.delete(listener);
  };
};

type SerializedQueue = {
  version?: 2 | 3;
  operations?: SyncOperation[];
  /** v1 compatibility only. New snapshots persist `operations` as the source of truth. */
  tickets?: [number, OfflineTicketUpdate][];
  comments?: OfflineCommentUpdate[];
  newTickets?: OfflineNewTicket[];
};

let memento: Memento | undefined;
let activeScope = "";
export const getActiveScope = (): string => activeScope;
const queuesByScope = new Map<string, OfflineSyncQueue>();
const persistenceByScope = new Map<string, Promise<void>>();
const pendingSnapshotByScope = new Map<string, SerializedQueue>();

const emptyQueue = (): OfflineSyncQueue => ({
  tickets: new Map<number, OfflineTicketUpdate>(),
  comments: [],
  newTickets: [],
});

const primaryEffectKind = (kind: SyncOperationKind): DurableSyncEffectKind => {
  switch (kind) {
    case "ticketCreate": return "ticket_create";
    case "ticketUpdate": return "ticket_update";
    case "commentCreate": return "comment_create";
    case "commentUpdate": return "comment_update";
  }
};

const primaryEffectId = (kind: SyncOperationKind): string => {
  switch (kind) {
    case "ticketCreate": return "ticket-create";
    case "ticketUpdate": return "ticket-update";
    case "commentCreate": return "comment-create";
    case "commentUpdate": return "comment-update";
  }
};

const withPlannedPrimaryEffect = <T extends {
  revision?: number;
  attemptGeneration?: number;
  effects?: DurableSyncEffect[];
}>(operation: T, kind: SyncOperationKind, target: DurableSyncEffect["target"]): T => {
  const revision = operation.revision ?? 1;
  const attemptGeneration = getAttemptGeneration(operation);
  const effectId = primaryEffectId(kind);
  if (operation.effects?.some((effect) =>
    effect.effectId === effectId &&
    normalizeAttemptGeneration(effect.attemptGeneration) === attemptGeneration
  )) {
    return operation;
  }
  return {
    ...operation,
    effects: [...(operation.effects ?? []), {
      effectId,
      kind: primaryEffectKind(kind),
      operationRevision: revision,
      attemptGeneration,
      state: "planned",
      target,
    }],
  };
};

const withPrimaryEffectTransition = <T extends {
  revision?: number;
  attemptGeneration?: number;
  effects?: DurableSyncEffect[];
}>(
  operation: T,
  kind: SyncOperationKind,
  action: DurableSyncEffectAction,
  sourceState: DurableSyncEffectState,
): T | undefined => {
  const effectId = primaryEffectId(kind);
  const attemptGeneration = getAttemptGeneration(operation);
  let effects = operation.effects ?? [];
  let index = effects.findIndex((effect) =>
    effect.effectId === effectId &&
    normalizeAttemptGeneration(effect.attemptGeneration) === attemptGeneration
  );
  if (index === -1 && sourceState !== "planned") {
    effects = [...effects, {
      effectId,
      kind: primaryEffectKind(kind),
      operationRevision: operation.revision ?? 1,
      attemptGeneration,
      state: sourceState,
      target: {},
    }];
    index = effects.length - 1;
  }
  if (index === -1) { return undefined; }
  if (
    (action.kind === "commit" && effects[index].state === "committed" && (action.remoteId === undefined || effects[index].remoteId === action.remoteId)) ||
    (action.kind === "mark_commit_unknown" && effects[index].state === "commit_unknown")
  ) {
    return { ...operation, effects };
  }
  const transitioned = transitionDurableSyncEffect(effects[index], action, {
    operationRevision: operation.revision ?? 1,
    attemptGeneration,
    sourceState,
  });
  if (!transitioned) {
    return undefined;
  }
  const nextEffects = [...effects];
  nextEffects[index] = transitioned;
  return { ...operation, effects: nextEffects };
};

const normalizeOperationEffects = (input: {
  kind: SyncOperationKind;
  revision: number;
  attemptGeneration?: number;
  phase: SyncOperation["phase"];
  payload: OfflineNewTicket | OfflineTicketUpdate | OfflineCommentUpdate;
  effects?: DurableSyncEffect[];
}): DurableSyncEffect[] => {
  const attemptGeneration = normalizeAttemptGeneration(input.attemptGeneration);
  if (Array.isArray(input.effects)) {
    return input.effects.map((effect) => ({
      ...restoreDurableSyncEffect(effect),
      attemptGeneration: normalizeAttemptGeneration(effect.attemptGeneration ?? attemptGeneration),
    }));
  }
  const payloadEffects = input.payload.effects;
  if (Array.isArray(payloadEffects)) {
    return payloadEffects.map((effect) => ({
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
  return copy;
};

const operationFromTicketUpdate = (
  update: OfflineTicketUpdate,
  scope: string,
): SyncOperation => {
  const revision = update.revision ?? 1;
  const phase = update.phase ?? "queued";
  return ({
  operationId: update.operationId ?? `ticket:${update.ticketId}`,
  kind: "ticketUpdate",
  connectionScope: update.connectionScope ?? scope,
  revision,
  attemptGeneration: getAttemptGeneration(update),
  phase,
  documentUri: update.documentUri,
  createdAt: update.createdAt ?? 0,
  effects: normalizeOperationEffects({ kind: "ticketUpdate", revision, attemptGeneration: getAttemptGeneration(update), phase, payload: update, effects: update.effects }),
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
  payload: businessPayload(ticket),
  });
};

const operationFromComment = (
  comment: OfflineCommentUpdate,
  scope: string,
  index: number,
): SyncOperation => {
  const revision = comment.revision ?? 1;
  const phase = (comment.phase ?? "queued") as SyncOperation["phase"];
  const durablePrimaryKind = comment.effects?.find((effect) =>
    effect.kind === "comment_create" || effect.kind === "comment_update"
  )?.kind;
  const kind = durablePrimaryKind === "comment_create"
    ? "commentCreate"
    : durablePrimaryKind === "comment_update"
      ? "commentUpdate"
      : comment.commentId === undefined ? "commentCreate" : "commentUpdate";
  return ({
  operationId: comment.operationId ??
    `comment:${comment.ticketId}:${comment.commentId ?? comment.documentUri ?? index}`,
  kind,
  connectionScope: comment.connectionScope ?? scope,
  revision,
  attemptGeneration: getAttemptGeneration(comment),
  phase,
  documentUri: comment.documentUri,
  createdAt: comment.createdAt ?? 0,
  effects: normalizeOperationEffects({ kind, revision, attemptGeneration: getAttemptGeneration(comment), phase, payload: comment, effects: comment.effects }),
  payload: businessPayload(comment),
  });
};

const operationsFromQueue = (queue: OfflineSyncQueue, scope: string): SyncOperation[] => [
  ...queue.newTickets.map((ticket) => operationFromNewTicket(ticket, scope)),
  ...Array.from(queue.tickets.values()).map((update) => operationFromTicketUpdate(update, scope)),
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
        }));
        break;
      case "ticketUpdate": {
        const update: OfflineTicketUpdate = {
          ...(operation.payload as OfflineTicketUpdate),
          operationId: operation.operationId,
          connectionScope: operation.connectionScope,
          revision: operation.revision,
          attemptGeneration: operation.attemptGeneration,
          phase: operation.phase as TicketUpdateSyncPhase,
          createdAt: operation.createdAt,
          effects: normalizeOperationEffects({ ...operation, attemptGeneration: operation.attemptGeneration, effects: operation.effects }),
        };
        queue.tickets.set(update.ticketId, normalizeTicketUpdate(update.ticketId, update));
        break;
      }
      case "commentCreate":
      case "commentUpdate": {
        const comment = normalizeComment({
          ...(operation.payload as OfflineCommentUpdate),
          operationId: operation.operationId,
          connectionScope: operation.connectionScope,
          revision: operation.revision,
          attemptGeneration: operation.attemptGeneration,
          phase: (operation.phase === "remote_write_started" ? "commit_unknown" : operation.phase) as TicketUpdateSyncPhase,
          createdAt: operation.createdAt,
          effects: normalizeOperationEffects({ ...operation, attemptGeneration: operation.attemptGeneration, effects: operation.effects }),
        }, operation.connectionScope, queue.comments.length);
        queue.comments.push(comment);
        break;
      }
    }
  }
  return queue;
};

const getQueue = (scope = activeScope): OfflineSyncQueue => {
  let queue = queuesByScope.get(scope);
  if (!queue) {
    queue = memento ? loadQueue(memento, storageKeyForScope(scope)) : emptyQueue();
    queuesByScope.set(scope, queue);
  }
  return queue;
};

const serializeQueue = (scope: string): SerializedQueue => {
  const queue = getQueue(scope);
  return {
    version: 3,
    operations: operationsFromQueue(queue, scope),
  };
};

const schedulePersist = (
  scope: string,
  serialized: SerializedQueue,
  clearLegacy = false,
): Promise<void> => {
  pendingSnapshotByScope.set(scope, serialized);
  const targetMemento = memento;
  const previous = persistenceByScope.get(scope);
  const perform = async (): Promise<void> => {
    if (targetMemento) {
      await targetMemento.update(storageKeyForScope(scope), serialized);
      if (clearLegacy) {
        await targetMemento.update(STORAGE_KEY, undefined);
      }
    }
  };
  const current = previous
    ? previous.catch(() => undefined).then(perform)
    : perform();
  persistenceByScope.set(scope, current);
  void current.finally(() => {
    if (persistenceByScope.get(scope) === current) {
      persistenceByScope.delete(scope);
      pendingSnapshotByScope.delete(scope);
    }
  }).catch(() => undefined);
  return current;
};

export const persistAsync = async (scope = activeScope): Promise<void> => {
  const serialized = serializeQueue(scope);
  await schedulePersist(scope, serialized);
  notifyQueueChanged();
};

const persist = (scope = activeScope): void => {
  const serialized = serializeQueue(scope);
  const current = schedulePersist(scope, serialized);
  notifyQueueChanged();
  void current.catch((err: unknown) => {
    console.error("[vs-redmine-client] offlineSyncStore: persist failed", err);
  });
};

const promoteTicketIntent = (operation: OfflineTicketUpdate): OfflineTicketUpdate => {
  const next = operation.nextIntent;
  const effects = operation.effects ?? [];
  if (!next) {
    return { ...operation, phase: "queued", nextIntent: undefined, effects };
  }
  const reusableEffects = effects.filter((e) =>
    e.state === "committed" || e.state === "commit_unknown" || e.state === "compensation_unknown" || e.state === "compensation_started"
  );
  return {
    ...operation,
    subject: next.subject,
    description: next.description,
    content: next.content ?? operation.content,
    metadata: next.metadata,
    layout: next.layout,
    metadataBlock: next.metadataBlock,
    controlFields: next.controlFields,
    baseDir: next.baseDir ?? operation.baseDir,
    documentUri: next.documentUri ?? operation.documentUri,
    phase: "queued",
    revision: next.revision,
    nextIntent: undefined,
    effects: reusableEffects,
  };
};

const promoteNewTicketIntent = (operation: OfflineNewTicket): OfflineNewTicket => {
  const next = operation.nextIntent;
  const effects = operation.effects ?? [];
  if (!next) {
    return { ...operation, phase: "queued", nextIntent: undefined, effects };
  }
  const reusableEffects = effects.filter((e) =>
    e.state === "committed" || e.state === "commit_unknown" || e.state === "compensation_unknown" || e.state === "compensation_started"
  );
  return {
    ...operation,
    content: next.content,
    projectId: next.projectId ?? operation.projectId,
    documentUri: next.documentUri ?? operation.documentUri,
    baseDir: next.baseDir ?? operation.baseDir,
    phase: "queued",
    revision: next.revision,
    nextIntent: undefined,
    effects: reusableEffects,
  };
};

const normalizeTicketUpdate = (
  ticketId: number,
  update: OfflineTicketUpdate,
): OfflineTicketUpdate => {
  const revision = update.revision ?? 1;
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
  return restored.phase === "preparing" || restored.phase === "queued"
    ? promoteNewTicketIntent(restored)
    : restored;
};

const promoteCommentIntent = (operation: OfflineCommentUpdate): OfflineCommentUpdate => {
  const next = operation.nextIntent;
  const effects = operation.effects ?? [];
  if (!next) {
    return { ...operation, phase: "queued", nextIntent: undefined, effects };
  }
  const commentId = operation.commentId ?? (operation as any).createdRemoteId;
  const hasCommentId = commentId !== undefined;
  const reusableEffects = effects.filter((e) =>
    e.state === "committed" || e.state === "commit_unknown" || e.state === "compensation_unknown" || e.state === "compensation_started"
  );
  return {
    ...operation,
    commentId,
    body: next.body,
    baseBody: operation.finalizeDraft && hasCommentId
      ? operation.body
      : operation.baseBody,
    sourceNotesHash: operation.finalizeDraft && hasCommentId
      ? computeNotesHash(operation.body)
      : operation.sourceNotesHash,
    finalizeDraft: operation.finalizeDraft && hasCommentId
      ? false
      : operation.finalizeDraft,
    baseDir: next.baseDir ?? operation.baseDir,
    documentUri: next.documentUri ?? operation.documentUri,
    phase: "queued",
    revision: next.revision,
    nextIntent: undefined,
    effects: reusableEffects,
  };
};

const normalizeComment = (
  comment: OfflineCommentUpdate,
  scope: string,
  index: number,
): OfflineCommentUpdate => {
  const attemptGeneration = getAttemptGeneration(comment);
  const durablePrimaryKind = comment.effects?.find((effect) =>
    effect.kind === "comment_create" || effect.kind === "comment_update"
  )?.kind;
  const kind = durablePrimaryKind === "comment_create"
    ? "commentCreate"
    : durablePrimaryKind === "comment_update"
      ? "commentUpdate"
      : comment.commentId === undefined ? "commentCreate" : "commentUpdate";
  const revision = comment.revision ?? 1;
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
    attemptGeneration,
    phase: restoredPhase,
    effects,
  };
  return restored.phase === "preparing" || restored.phase === "queued"
    ? promoteCommentIntent(restored)
    : restored;
};

const deserializeQueue = (raw: SerializedQueue | undefined): OfflineSyncQueue => {
  if (raw && Array.isArray(raw.operations)) {
    const valid = raw.operations.filter((operation): operation is SyncOperation =>
      operation !== null &&
      typeof operation === "object" &&
      typeof operation.operationId === "string" &&
      typeof operation.kind === "string" &&
      operation.payload !== null &&
      typeof operation.payload === "object",
    );
    return queueFromOperations(valid);
  }
  return {
    tickets: new Map(
      raw && Array.isArray(raw.tickets)
        ? raw.tickets
          .map((e: any): [number, OfflineTicketUpdate] | undefined => {
            if (Array.isArray(e) && typeof e[0] === "number" && e[1] && typeof e[1] === "object") {
              return [e[0], normalizeTicketUpdate(e[0], e[1])];
            }
            if (e && typeof e === "object" && typeof e.ticketId === "number") {
              return [e.ticketId, normalizeTicketUpdate(e.ticketId, e)];
            }
            return undefined;
          })
          .filter((e): e is [number, OfflineTicketUpdate] => e !== undefined)
        : [],
    ),
    comments:
      raw && Array.isArray(raw.comments)
        ? raw.comments
          .filter((c) => c !== null && typeof c === "object")
          .map((comment, index) => normalizeComment(comment, activeScope, index))
        : [],
    newTickets:
      raw && Array.isArray(raw.newTickets)
        ? raw.newTickets
          .filter((t) => t !== null && typeof t === "object")
          .map(normalizeNewTicket)
        : [],
  };
};

/** Returns the canonical, persisted representation of pending work. */
export const listSyncOperations = (scope = activeScope): SyncOperation[] =>
  operationsFromQueue(getQueue(scope), scope).map((operation) => ({
    ...operation,
    payload: { ...operation.payload },
  }));

export const getSyncOperation = (
  operationId: string,
  scope = activeScope,
): SyncOperation | undefined => listSyncOperations(scope).find(
  (operation) => operation.operationId === operationId,
);

const findStoredOperation = (
  queue: OfflineSyncQueue,
  operationId: string,
): OfflineNewTicket | OfflineTicketUpdate | OfflineCommentUpdate | undefined => {
  const newTicket = queue.newTickets.find((op) =>
    op.operationId === operationId ||
    (op.queueId !== undefined && op.queueId === operationId) ||
    (op.documentUri !== undefined && (operationId.endsWith(`:${op.documentUri}`) || operationId === op.documentUri))
  );
  if (newTicket) { return newTicket; }

  const ticket = Array.from(queue.tickets.values()).find((op) =>
    op.operationId === operationId ||
    `ticket:${op.ticketId}` === operationId ||
    operationId.endsWith(`:${op.ticketId}`)
  );
  if (ticket) { return ticket; }

  return queue.comments.find((op) =>
    op.operationId === operationId ||
    (op.operationId !== undefined && (operationId.endsWith(`:${op.operationId}`) || op.operationId.endsWith(`:${operationId}`))) ||
    (op.commentId !== undefined && `comment:${op.ticketId}:${op.commentId}` === operationId) ||
    (op.commentId !== undefined && operationId.includes(`:${op.ticketId}:${op.commentId}`)) ||
    (op.documentUri !== undefined && (operationId.endsWith(`:${op.documentUri}`) || operationId === op.documentUri)) ||
    (op.ticketId !== undefined && operationId.includes(`:${op.ticketId}:`))
  );
};

export const planOfflineSyncEffectAsync = async (
  operationId: string,
  effect: DurableSyncEffect,
  scope: string,
  expectedRevision: number,
): Promise<DurableSyncEffect | undefined> => {
  const operation = findStoredOperation(getQueue(scope), operationId);
  if (
    !operation ||
    operation.revision !== expectedRevision ||
    effect.operationRevision !== expectedRevision ||
    (effect.attemptGeneration !== undefined &&
      normalizeAttemptGeneration(effect.attemptGeneration) !== getAttemptGeneration(operation)) ||
    (operation.connectionScope !== undefined && operation.connectionScope !== scope)
  ) {
    return undefined;
  }
  const existing = operation.effects?.find((candidate) =>
    candidate.effectId === effect.effectId &&
    normalizeAttemptGeneration(candidate.attemptGeneration) === getAttemptGeneration(operation)
  );
  if (existing) {
    return existing.operationRevision === expectedRevision ? { ...existing } : undefined;
  }
  const planned = {
    ...effect,
    attemptGeneration: getAttemptGeneration(operation),
    target: { ...effect.target },
  };
  operation.effects = [...(operation.effects ?? []), planned];
  await persistAsync(scope);
  return { ...planned, target: { ...planned.target } };
};

export const transitionOfflineSyncEffectAsync = async (
  operationId: string,
  effectId: string,
  action: DurableSyncEffectAction,
  scope: string,
  expected: {
    operationRevision: number;
    attemptGeneration?: number;
    sourceState: DurableSyncEffectState;
  },
): Promise<DurableSyncEffect | undefined> => {
  const operation = findStoredOperation(getQueue(scope), operationId);
  if (
    !operation ||
    operation.revision !== expected.operationRevision ||
    (expected.attemptGeneration !== undefined &&
      getAttemptGeneration(operation) !== normalizeAttemptGeneration(expected.attemptGeneration)) ||
    (operation.connectionScope !== undefined && operation.connectionScope !== scope)
  ) {
    return undefined;
  }
  const effects = operation.effects ?? [];
  const index = effects.findIndex((effect) =>
    effect.effectId === effectId &&
    normalizeAttemptGeneration(effect.attemptGeneration) === getAttemptGeneration(operation)
  );
  if (index === -1) { return undefined; }
  const transitioned = transitionDurableSyncEffect(effects[index], action, {
    ...expected,
    attemptGeneration: expected.attemptGeneration ?? getAttemptGeneration(operation),
  });
  if (!transitioned) { return undefined; }
  const nextEffects = [...effects];
  nextEffects[index] = transitioned;
  operation.effects = nextEffects;
  await persistAsync(scope);
  return { ...transitioned, target: { ...transitioned.target } };
};

function loadQueue(storage: Memento, storageKey: string): OfflineSyncQueue {
  return deserializeQueue(storage.get<SerializedQueue>(storageKey));
}

export const initializeOfflineSyncStore = (storage: Memento, scope?: string): void => {
  const sameStorage = memento === storage;
  const requestedScope = scope ?? "";
  const pendingSnapshot = sameStorage
    ? pendingSnapshotByScope.get(requestedScope)
    : undefined;
  memento = storage;
  activeScope = requestedScope;
  queuesByScope.clear();
  if (!sameStorage) {
    persistenceByScope.clear();
    pendingSnapshotByScope.clear();
  }
  const activeStorageKey = storageKeyForScope(activeScope);
  const scoped = storage.get<SerializedQueue>(activeStorageKey);
  const legacy = scope ? storage.get<SerializedQueue>(STORAGE_KEY) : undefined;
  const queue = deserializeQueue(pendingSnapshot ?? scoped ?? legacy);
  queuesByScope.set(activeScope, queue);
  if ((!scoped?.operations && (scoped || legacy))) {
    const current = schedulePersist(
      activeScope,
      serializeQueue(activeScope),
      Boolean(scope && !scoped && legacy),
    );
    void current.catch((err: unknown) => {
      console.error("[vs-redmine-client] offlineSyncStore: migration failed", err);
    });
  }
};

/** 接続先ごとのキューへ切り替え、別Redmineの未送信データを混在させない。 */
export const switchOfflineSyncStore = (scope: string): void => {
  if (!memento) {
    return;
  }
  activeScope = scope;
  getQueue(scope);
  notifyQueueChanged();
};

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
        layout: update.layout,
        metadataBlock: update.metadataBlock,
        controlFields: update.controlFields,
        baseDir: update.baseDir,
        documentUri: update.documentUri ?? existing.documentUri,
      },
    };
  }
  const fallbackContent = update.content ?? existing?.content ?? (update.subject ? buildTicketEditorContent(update) : update.description);
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
    revision: existing?.revision ?? update.revision ?? 1,
    createdAt: existing?.createdAt ?? update.createdAt ?? Date.now(),
  };
};

export const addOfflineTicketUpdate = (
  ticketId: number,
  update: OfflineTicketUpdate,
  scope = activeScope,
): void => {
  const queue = getQueue(scope);
  const existing = queue.tickets.get(ticketId);
  queue.tickets.set(ticketId, mergeOfflineTicketUpdate(ticketId, existing, update));
  persist(scope);
};

export const addOfflineCommentUpdate = (
  update: OfflineCommentUpdate,
  scope = activeScope,
): void => {
  const queue = getQueue(scope);
  const index = queue.comments.findIndex((item) =>
    (update.commentId !== undefined && item.commentId === update.commentId) ||
    (update.documentUri !== undefined && item.documentUri === update.documentUri),
  );
  if (index !== -1) {
    const existing = queue.comments[index];
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
      queue.comments[index] = normalizeComment({
        ...existing,
        ...update,
        operationId: existing.operationId,
        connectionScope: existing.connectionScope ?? scope,
        revision: existing.revision ?? update.revision ?? 1,
        createdAt: existing.createdAt ?? update.createdAt ?? Date.now(),
      }, scope, index);
    }
    persist(scope);
    return;
  }
  queue.comments.push(normalizeComment({
    ...update,
    operationId: update.operationId ?? `comment:${randomUUID()}`,
    connectionScope: update.connectionScope ?? scope,
    phase: update.phase ?? "queued",
    revision: update.revision ?? 1,
    createdAt: update.createdAt ?? Date.now(),
  }, scope, queue.comments.length));
  persist(scope);
};

const findNewTicketIndex = (
  queue: OfflineSyncQueue,
  key: { queueId?: string; documentUri?: string },
): number => {
  if (key.queueId) {
    const idx = queue.newTickets.findIndex((t) => t.queueId === key.queueId);
    if (idx !== -1) { return idx; }
  }
  if (key.documentUri) {
    return queue.newTickets.findIndex(
      (ticket) => sameDocumentIdentity(ticket.documentUri, key.documentUri),
    );
  }
  return -1;
};

const documentIdentity = (uri: string | undefined): string | undefined => {
  if (!uri) {
    return undefined;
  }
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === "file:" || parsed.protocol === "untitled:") {
      return decodeURIComponent(parsed.pathname).replace(/^\/[A-Za-z]:\//, (value) =>
        value.slice(1).toLowerCase());
    }
  } catch {
    // Fall back to exact identity for legacy or non-standard URI values.
  }
  return uri;
};

export const sameDocumentIdentity = (
  left: string | undefined,
  right: string | undefined,
): boolean => left !== undefined && right !== undefined &&
  documentIdentity(left) === documentIdentity(right);

export const addOfflineNewTicket = (
  update: Omit<OfflineNewTicket, "queueId">,
  scope = activeScope,
): void => {
  const queue = getQueue(scope);
  const index = update.documentUri
    ? queue.newTickets.findIndex(
      (item) => sameDocumentIdentity(item.documentUri, update.documentUri),
    )
    : -1;
  if (index !== -1) {
    const existing = queue.newTickets[index];
    queue.newTickets.splice(index, 1);
    if (existing.phase && existing.phase !== "queued" && existing.phase !== "completed") {
      const revision = Math.max(
        existing.revision ?? 1,
        existing.nextIntent?.revision ?? 0,
      ) + 1;
      queue.newTickets.unshift({
        ...existing,
        documentUri: existing.documentUri ?? update.documentUri,
        nextIntent: {
          revision,
          content: update.content,
          projectId: update.projectId ?? existing.projectId,
          documentUri: update.documentUri ?? existing.documentUri,
          baseDir: update.baseDir ?? existing.baseDir,
        },
      });
    } else {
      queue.newTickets.unshift({
        ...existing,
        ...update,
        revision: existing.revision ?? update.revision ?? 1,
      });
    }
  } else {
    const queueId = randomUUID();
    queue.newTickets.unshift({
      ...update,
      queueId,
      operationId: queueId,
      phase: update.phase ?? "queued",
      connectionScope: update.connectionScope ?? scope,
      revision: update.revision ?? 1,
      createdAt: update.createdAt ?? Date.now(),
    });
  }
  persist(scope);
};

export const addOfflineNewTicketAsync = async (
  update: Omit<OfflineNewTicket, "queueId"> & { queueId?: string },
  scope: string,
): Promise<OfflineNewTicket> => {
  const queue = getQueue(scope);
  const index = update.documentUri
    ? queue.newTickets.findIndex(
      (item) => sameDocumentIdentity(item.documentUri, update.documentUri),
    )
    : update.queueId
      ? queue.newTickets.findIndex((item) => item.queueId === update.queueId)
      : -1;
  const queueId = update.queueId ?? randomUUID();
  const existing = index === -1 ? undefined : queue.newTickets[index];
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
    : existing?.phase && existing.phase !== "queued" && existing.phase !== "completed"
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
      : {
        ...existing,
        ...update,
        queueId,
        revision: existing?.revision ?? update.revision ?? 1,
      };
  if (index === -1) {
    queue.newTickets.unshift(entry);
  } else {
    queue.newTickets[index] = entry;
  }
  await persistAsync(scope);
  return entry;
};

export const getOfflineSyncQueue = (scope = activeScope): OfflineSyncQueue => {
  const queue = getQueue(scope);
  return {
    tickets: new Map(queue.tickets),
    comments: [...queue.comments],
    newTickets: [...queue.newTickets],
  };
};

export const getOfflineNewTicket = (
  key: { queueId?: string; documentUri?: string },
  scope: string,
): OfflineNewTicket | undefined => {
  const queue = getQueue(scope);
  const index = findNewTicketIndex(queue, key);
  return index === -1 ? undefined : { ...queue.newTickets[index] };
};

export const clearOfflineSyncQueue = (scope = activeScope): void => {
  const queue = getQueue(scope);
  queue.tickets.clear();
  queue.comments = [];
  queue.newTickets = [];
  persist(scope);
};

export const replaceOfflineSyncQueue = (
  next: OfflineSyncQueue,
  scope = activeScope,
): void => {
  const queue = getQueue(scope);
  queue.tickets = new Map(next.tickets);
  queue.comments = [...next.comments];
  queue.newTickets = [...next.newTickets];
  persist(scope);
};

export const replaceOfflineSyncQueueAsync = async (
  next: OfflineSyncQueue,
  scope = activeScope,
): Promise<void> => {
  const serialized: SerializedQueue = {
    version: 3,
    operations: operationsFromQueue(next, scope),
  };
  await schedulePersist(scope, serialized);
  const queue = getQueue(scope);
  queue.tickets = new Map(next.tickets);
  queue.comments = [...next.comments];
  queue.newTickets = [...next.newTickets];
  notifyQueueChanged();
};

export const removeOfflineTicketUpdate = (ticketId: number, scope = activeScope): void => {
  const queue = getQueue(scope);
  queue.tickets.delete(ticketId);
  persist(scope);
};

export const updateOfflineNewTicket = (
  key: { queueId?: string; documentUri?: string },
  updates: Partial<Pick<OfflineNewTicket, "createdIssueId" | "status" | "phase" | "remoteUpdatedAt" | "createdChildIds">>,
  scope = activeScope,
): void => {
  const queue = getQueue(scope);
  const index = findNewTicketIndex(queue, key);
  if (index !== -1) {
    queue.newTickets[index] = { ...queue.newTickets[index], ...updates };
    persist(scope);
  }
};

export const updateOfflineNewTicketAsync = async (
  key: { queueId?: string; documentUri?: string },
  updates: Partial<Pick<OfflineNewTicket, "createdIssueId" | "status" | "phase" | "remoteUpdatedAt" | "createdChildIds">>,
  scope: string,
  expectedRevision?: number,
): Promise<OfflineNewTicket | undefined> => {
  const queue = getQueue(scope);
  const index = findNewTicketIndex(queue, key);
  if (index === -1 || (
    expectedRevision !== undefined && queue.newTickets[index].revision !== expectedRevision
  )) {
    return undefined;
  }
  if (updates.phase === "queued" && queue.newTickets[index].nextIntent) {
    return undefined;
  }
  const next = { ...queue.newTickets[index], ...updates };
  queue.newTickets[index] = next;
  await persistAsync(scope);
  return next;
};

const newTicketActionAllowsSource = (
  action: NewTicketLifecycleAction,
  source: NewTicketSyncPhase,
): boolean => {
  switch (action.kind) {
    case "begin_preparation": return source === "queued";
    case "abort_before_remote_write": return source === "preparing";
    case "start_normal_remote_write": return source === "preparing";
    case "start_explicit_retry_remote_write": return source === "commit_unknown" || source === "remote_write_started";
    case "mark_commit_unknown": return source === "remote_write_started";
    case "record_remote_created": return source === "remote_write_started";
    case "link_created_ticket": return source === "commit_unknown" || source === "remote_write_started";
    case "mark_reconciliation_pending":
      return source === "remote_created" || source === "reconciliation_pending" ||
        source === "local_finalize_pending";
    case "mark_local_finalize_pending":
      return source === "remote_created" || source === "reconciliation_pending" ||
        source === "local_finalize_pending";
    case "mark_compensation_pending":
      return source === "remote_created" || source === "reconciliation_pending";
    case "complete_compensation":
      return source === "remote_created";
  }
};

export const transitionOfflineNewTicketLifecycleAsync = async (
  key: { queueId?: string; documentUri?: string },
  action: NewTicketLifecycleAction,
  scope: string,
  expected: LifecycleTransitionExpectation<NewTicketSyncPhase>,
): Promise<OfflineNewTicket | undefined> => {
  const queue = getQueue(scope);
  const index = findNewTicketIndex(queue, key);
  const current = index === -1 ? undefined : queue.newTickets[index];
  if (
    !current ||
    (current.operationId !== undefined && expected.operationId !== undefined && current.operationId !== expected.operationId) ||
    current.revision !== expected.revision ||
    (expected.attemptGeneration !== undefined &&
      getAttemptGeneration(current) !== normalizeAttemptGeneration(expected.attemptGeneration)) ||
    current.phase !== expected.sourcePhase ||
    (current.connectionScope !== undefined && current.connectionScope !== scope) ||
    !newTicketActionAllowsSource(action, expected.sourcePhase)
  ) {
    return undefined;
  }
  let next: OfflineNewTicket;
  switch (action.kind) {
    case "begin_preparation":
      next = {
        ...withPlannedPrimaryEffect(current, "ticketCreate", {}),
        phase: "preparing",
      };
      break;
    case "abort_before_remote_write":
      next = promoteNewTicketIntent(current);
      break;
    case "start_normal_remote_write":
    case "start_explicit_retry_remote_write": {
      const transitioned = withPrimaryEffectTransition(
        current,
        "ticketCreate",
        action.kind === "start_normal_remote_write"
          ? { kind: "start" }
          : { kind: "start_explicit_retry" },
        action.kind === "start_normal_remote_write" ? "planned" : "commit_unknown",
      );
      if (!transitioned) { return undefined; }
      next = { ...transitioned, phase: "remote_write_started" };
      break;
    }
    case "mark_commit_unknown": {
      const transitioned = withPrimaryEffectTransition(
        current,
        "ticketCreate",
        { kind: "mark_commit_unknown" },
        "started",
      );
      if (!transitioned) { return undefined; }
      next = { ...transitioned, phase: "commit_unknown" };
      break;
    }
    case "record_remote_created":
    case "link_created_ticket": {
      const transitioned = withPrimaryEffectTransition(
        current,
        "ticketCreate",
        action.kind === "record_remote_created"
          ? { kind: "commit", remoteId: action.ticketId }
          : { kind: "assume_committed", remoteId: action.ticketId },
        action.kind === "record_remote_created" ? "started" : "commit_unknown",
      );
      if (!transitioned) { return undefined; }
      next = { ...transitioned, createdIssueId: action.ticketId, phase: "remote_created" };
      break;
    }
    case "mark_reconciliation_pending":
      next = {
        ...current,
        phase: "reconciliation_pending",
        remoteUpdatedAt: action.remoteUpdatedAt,
      };
      break;
    case "mark_local_finalize_pending":
      next = {
        ...current,
        phase: "local_finalize_pending",
        remoteUpdatedAt: action.remoteUpdatedAt,
      };
      break;
    case "mark_compensation_pending":
      next = { ...current, phase: "reconciliation_pending" };
      break;
    case "complete_compensation":
      if (
        current.effects?.find((effect) => effect.effectId === "ticket-create")?.state !==
          "compensated" ||
        current.effects?.some((effect) =>
          effect.kind === "child_create" &&
          effect.state !== "compensated" &&
          effect.state !== "failed"
        )
      ) {
        return undefined;
      }
      next = {
        ...current,
        createdIssueId: undefined,
        createdChildIds: undefined,
        attemptGeneration: getAttemptGeneration(current) + 1,
        phase: "queued",
        effects: [],
      };
      break;
  }
  queue.newTickets[index] = next;
  await persistAsync(scope);
  return next;
};

export const abortOfflineNewTicketBeforeRemoteWriteAsync = async (
  key: { queueId?: string; documentUri?: string },
  scope: string,
  expectedRevision: number,
): Promise<OfflineNewTicket | undefined> => {
  const queue = getQueue(scope);
  const index = findNewTicketIndex(queue, key);
  const current = index === -1 ? undefined : queue.newTickets[index];
  if (!current || current.revision !== expectedRevision || current.phase !== "preparing") {
    return undefined;
  }
  const next = promoteNewTicketIntent(current);
  queue.newTickets[index] = next;
  await persistAsync(scope);
  return next;
};

export const removeOfflineNewTicket = (
  key: { queueId?: string; documentUri?: string },
  scope = activeScope,
): void => {
  const queue = getQueue(scope);
  const previousLength = queue.newTickets.length;
  queue.newTickets = queue.newTickets.filter((ticket) => {
    if (key.queueId && ticket.queueId === key.queueId) {
      return false;
    }
    return !sameDocumentIdentity(ticket.documentUri, key.documentUri);
  });
  if (queue.newTickets.length !== previousLength) {
    persist(scope);
  }
};

export const removeOfflineNewTicketAsync = async (
  key: { queueId?: string; documentUri?: string },
  scope: string,
): Promise<void> => {
  const queue = getQueue(scope);
  const previousLength = queue.newTickets.length;
  queue.newTickets = queue.newTickets.filter((ticket) => {
    if (key.queueId && ticket.queueId === key.queueId) {
      return false;
    }
    return !sameDocumentIdentity(ticket.documentUri, key.documentUri);
  });
  if (queue.newTickets.length !== previousLength) {
    await persistAsync(scope);
  }
};

export const discardOfflineNewTicketAsync = async (
  key: { queueId?: string; documentUri?: string },
  scope: string,
): Promise<OfflineDiscardResult> => {
  const queue = getQueue(scope);
  const index = findNewTicketIndex(queue, key);
  if (index === -1) {
    return "not_found";
  }
  const operation = queue.newTickets[index];
  if (operation.phase && operation.phase !== "queued" && operation.phase !== "completed") {
    if (!operation.nextIntent) {
      return "recovery_required";
    }
    queue.newTickets[index] = { ...operation, nextIntent: undefined };
    await persistAsync(scope);
    return "discarded_next";
  }
  queue.newTickets.splice(index, 1);
  await persistAsync(scope);
  return "discarded";
};

export const completeOfflineNewTicketAsync = async (
  key: { queueId?: string; documentUri?: string },
  scope: string,
  promotion?: OfflineTicketUpdate & { sourceRevision?: number },
  expectedRevision?: number,
): Promise<boolean> => {
  const queue = getQueue(scope);
  const index = findNewTicketIndex(queue, key);
  if (index === -1) {
    return true;
  }
  const current = queue.newTickets[index];
  if (expectedRevision !== undefined && current.revision !== expectedRevision) {
    return false;
  }
  if (current.nextIntent) {
    if (!promotion || (current.nextIntent.revision !== undefined && promotion.sourceRevision !== current.nextIntent.revision)) {
      return false;
    }
  }
  // persist-first: まず next snapshotを構築してから永続化
  const nextNewTickets = queue.newTickets.filter((_, i) => i !== index);
  const nextTickets = new Map(queue.tickets);
  if (promotion) {
    const { sourceRevision: _sourceRevision, ...ticketUpdate } = promotion;
    nextTickets.set(promotion.ticketId, ticketUpdate);
  }
  const nextQueue: OfflineSyncQueue = { ...queue, newTickets: nextNewTickets, tickets: nextTickets };
  try {
    await replaceOfflineSyncQueueAsync(nextQueue, scope);
  } catch {
    return false;  // persist失敗時にmemoryを変更しない
  }
  return true;
};

export const updateOfflineTicketUpdateAsync = async (
  ticketId: number,
  updates: Partial<Pick<OfflineTicketUpdate, "phase" | "remoteUpdatedAt" | "createdChildIds">>,
  scope: string,
  expectedRevision?: number,
): Promise<OfflineTicketUpdate | undefined> => {
  const queue = getQueue(scope);
  const current = queue.tickets.get(ticketId);
  if (!current || (expectedRevision !== undefined && current.revision !== expectedRevision)) {
    return undefined;
  }
  if (updates.phase === "queued" && current.nextIntent) {
    return undefined;
  }
  const next = { ...current, ...updates };
  queue.tickets.set(ticketId, next);
  await persistAsync(scope);
  return next;
};

const ticketUpdateActionAllowsSource = (
  action: TicketUpdateLifecycleAction,
  source: TicketUpdateSyncPhase,
): boolean => {
  switch (action.kind) {
    case "begin_preparation": return source === "queued";
    case "abort_before_remote_write": return source === "preparing";
    case "start_normal_remote_write": return source === "preparing";
    case "start_explicit_retry_remote_write": return source === "commit_unknown" || source === "remote_write_started";
    case "mark_commit_unknown": return source === "remote_write_started";
    case "record_remote_commit": return source === "remote_write_started";
    case "assume_update_committed": return source === "commit_unknown" || source === "remote_write_started";
    case "mark_reconciliation_pending":
      return source === "remote_committed" || source === "reconciliation_pending" ||
        source === "local_finalize_pending";
    case "mark_local_finalize_pending":
      return source === "remote_committed" || source === "reconciliation_pending" ||
        source === "local_finalize_pending";
    case "mark_compensation_pending":
      return source === "preparing" || source === "remote_write_started" ||
        source === "reconciliation_pending";
  }
};

export const transitionOfflineTicketUpdateLifecycleAsync = async (
  ticketId: number,
  action: TicketUpdateLifecycleAction,
  scope: string,
  expected: LifecycleTransitionExpectation<TicketUpdateSyncPhase>,
): Promise<OfflineTicketUpdate | undefined> => {
  const queue = getQueue(scope);
  const current = queue.tickets.get(ticketId);
  if (
    !current ||
    current.operationId !== expected.operationId ||
    current.revision !== expected.revision ||
    (expected.attemptGeneration !== undefined &&
      getAttemptGeneration(current) !== normalizeAttemptGeneration(expected.attemptGeneration)) ||
    current.phase !== expected.sourcePhase ||
    (current.connectionScope !== undefined && current.connectionScope !== scope) ||
    !ticketUpdateActionAllowsSource(action, expected.sourcePhase)
  ) {
    return undefined;
  }
  let next: OfflineTicketUpdate;
  switch (action.kind) {
    case "begin_preparation":
      next = {
        ...withPlannedPrimaryEffect(current, "ticketUpdate", { ticketId }),
        phase: "preparing",
        remoteUpdatedAt: undefined,
      };
      break;
    case "abort_before_remote_write":
      next = promoteTicketIntent(current);
      break;
    case "start_normal_remote_write":
    case "start_explicit_retry_remote_write": {
      const transitioned = withPrimaryEffectTransition(
        current,
        "ticketUpdate",
        action.kind === "start_normal_remote_write"
          ? { kind: "start" }
          : { kind: "start_explicit_retry" },
        action.kind === "start_normal_remote_write" ? "planned" : "commit_unknown",
      );
      if (!transitioned) { return undefined; }
      next = { ...transitioned, phase: "remote_write_started", remoteUpdatedAt: undefined };
      break;
    }
    case "mark_commit_unknown": {
      const transitioned = withPrimaryEffectTransition(
        current,
        "ticketUpdate",
        { kind: "mark_commit_unknown" },
        "started",
      );
      if (!transitioned) { return undefined; }
      next = { ...transitioned, phase: "commit_unknown", remoteUpdatedAt: undefined };
      break;
    }
    case "record_remote_commit": {
      const transitioned = withPrimaryEffectTransition(
        current,
        "ticketUpdate",
        { kind: "commit" },
        "started",
      );
      if (!transitioned) { return undefined; }
      next = {
        ...transitioned,
        phase: "remote_committed",
        remoteUpdatedAt: undefined,
        createdChildIds: action.createdChildIds,
      };
      break;
    }
    case "assume_update_committed": {
      const transitioned = withPrimaryEffectTransition(
        current,
        "ticketUpdate",
        { kind: "assume_committed" },
        "commit_unknown",
      );
      if (!transitioned) { return undefined; }
      next = { ...transitioned, phase: "remote_committed", remoteUpdatedAt: undefined };
      break;
    }
    case "mark_reconciliation_pending":
      next = {
        ...current,
        phase: "reconciliation_pending",
        remoteUpdatedAt: action.remoteUpdatedAt,
      };
      break;
    case "mark_local_finalize_pending":
      next = {
        ...current,
        phase: "local_finalize_pending",
        remoteUpdatedAt: action.remoteUpdatedAt,
      };
      break;
    case "mark_compensation_pending":
      next = { ...current, phase: "reconciliation_pending" };
      break;
  }
  queue.tickets.set(ticketId, next);
  await persistAsync(scope);
  return next;
};

export const abortOfflineTicketUpdateBeforeRemoteWriteAsync = async (
  ticketId: number,
  scope: string,
  expectedRevision: number,
): Promise<OfflineTicketUpdate | undefined> => {
  const queue = getQueue(scope);
  const current = queue.tickets.get(ticketId);
  if (!current || current.revision !== expectedRevision || current.phase !== "preparing") {
    return undefined;
  }
  const next = promoteTicketIntent(current);
  queue.tickets.set(ticketId, next);
  await persistAsync(scope);
  return next;
};

export const removeOfflineTicketUpdateAsync = async (
  ticketId: number,
  scope: string,
): Promise<void> => {
  const queue = getQueue(scope);
  if (queue.tickets.delete(ticketId)) {
    await persistAsync(scope);
  }
};

export const discardOfflineTicketUpdateAsync = async (
  ticketId: number,
  scope: string,
): Promise<OfflineDiscardResult> => {
  const queue = getQueue(scope);
  const operation = queue.tickets.get(ticketId);
  if (!operation) {
    return "not_found";
  }
  queue.tickets.delete(ticketId);
  await persistAsync(scope);
  return "discarded";
};

export const completeOfflineTicketUpdateAsync = async (
  ticketId: number,
  scope: string,
  completion?: { canonical: TicketEditorContent; remoteUpdatedAt: string },
  expectedRevision?: number,
): Promise<boolean> => {
  const queue = getQueue(scope);
  const current = queue.tickets.get(ticketId);
  if (!current) {
    return true;
  }
  if (expectedRevision !== undefined && current.revision !== expectedRevision) {
    return false;
  }
  // next snapshotを構築
  const nextTickets = new Map(queue.tickets);
  if (current.nextIntent) {
    const next = current.nextIntent;
    const canonical = completion?.canonical;
    nextTickets.set(ticketId, {
      ticketId,
      baseSubject: canonical?.subject ?? current.baseSubject,
      baseDescription: canonical?.description ?? current.baseDescription,
      baseMetadata: canonical?.metadata ?? current.baseMetadata,
      lastKnownRemoteUpdatedAt: completion?.remoteUpdatedAt ?? current.lastKnownRemoteUpdatedAt,
      subject: next.subject,
      description: next.description,
      metadata: next.metadata,
      content: next.content ?? current.content,
      layout: next.layout ?? canonical?.layout ?? current.layout,
      metadataBlock: next.metadataBlock ?? canonical?.metadataBlock ?? current.metadataBlock,
      controlFields: next.controlFields ?? canonical?.controlFields ?? current.controlFields,
      baseDir: next.baseDir ?? current.baseDir,
      documentUri: next.documentUri ?? current.documentUri,
      operationId: current.operationId,
      connectionScope: current.connectionScope ?? scope,
      phase: "queued",
      revision: next.revision ?? (current.revision ?? 0) + 1,
    });
  } else {
    nextTickets.delete(ticketId);
  }
  const nextQueue: OfflineSyncQueue = { ...queue, tickets: nextTickets };
  try {
    await replaceOfflineSyncQueueAsync(nextQueue, scope);
  } catch {
    return false;
  }
  return true;
};

type CommentQueueKey = { ticketId: number; commentId?: number; documentUri?: string };

const findCommentIndex = (queue: OfflineSyncQueue, key: CommentQueueKey): number =>
  queue.comments.findIndex((comment) =>
    comment.ticketId === key.ticketId && (
      (key.documentUri !== undefined && comment.documentUri !== undefined && comment.documentUri === key.documentUri) ||
      (key.commentId !== undefined && comment.commentId === key.commentId) ||
      (key.commentId === undefined && comment.commentId === undefined)
    ),
  );

export const getOfflineCommentUpdate = (
  key: CommentQueueKey,
  scope = activeScope,
): OfflineCommentUpdate | undefined => {
  const queue = getQueue(scope);
  const index = findCommentIndex(queue, key);
  return index === -1 ? undefined : { ...queue.comments[index] };
};

const commentActionAllowsSource = (
  action: CommentLifecycleAction,
  source: TicketUpdateSyncPhase,
): boolean => {
  switch (action.kind) {
    case "begin_preparation": return source === "queued";
    case "abort_before_remote_write": return source === "preparing";
    case "start_normal_remote_write": return source === "preparing";
    case "mark_commit_unknown": return source === "remote_write_started";
    case "assume_remote_commit": return source === "commit_unknown";
    case "abort_known_remote_failure": return source === "remote_write_started";
    case "record_remote_commit": return source === "remote_write_started";
    case "record_reconciled_identity":
      return source === "remote_committed" || source === "reconciliation_pending" ||
        source === "local_finalize_pending";
    case "mark_reconciliation_pending":
      return source === "remote_committed" || source === "reconciliation_pending";
    case "mark_local_finalize_pending":
      return source === "remote_committed" || source === "reconciliation_pending" ||
        source === "local_finalize_pending";
  }
};

export const transitionOfflineCommentLifecycleAsync = async (
  key: CommentQueueKey,
  action: CommentLifecycleAction,
  scope: string,
  expected: LifecycleTransitionExpectation<TicketUpdateSyncPhase>,
): Promise<OfflineCommentUpdate | undefined> => {
  const queue = getQueue(scope);
  const index = findCommentIndex(queue, key);
  const current = index === -1 ? undefined : queue.comments[index];
  if (
    !current ||
    current.operationId !== expected.operationId ||
    current.revision !== expected.revision ||
    (expected.attemptGeneration !== undefined &&
      getAttemptGeneration(current) !== normalizeAttemptGeneration(expected.attemptGeneration)) ||
    current.phase !== expected.sourcePhase ||
    (current.connectionScope !== undefined && current.connectionScope !== scope) ||
    !commentActionAllowsSource(action, expected.sourcePhase)
  ) {
    return undefined;
  }
  const operationKind: SyncOperationKind = current.commentId === undefined
    ? "commentCreate"
    : "commentUpdate";
  let next: OfflineCommentUpdate;
  switch (action.kind) {
    case "begin_preparation":
      next = {
        ...withPlannedPrimaryEffect(current, operationKind, {
          ticketId: current.ticketId,
          commentId: current.commentId,
        }),
        phase: "preparing",
      };
      break;
    case "abort_before_remote_write":
    case "abort_known_remote_failure":
      next = promoteCommentIntent(current);
      break;
    case "start_normal_remote_write": {
      const transitioned = withPrimaryEffectTransition(
        current,
        operationKind,
        { kind: "start" },
        "planned",
      );
      if (!transitioned) { return undefined; }
      next = { ...transitioned, phase: "remote_write_started" };
      break;
    }
    case "mark_commit_unknown": {
      const transitioned = withPrimaryEffectTransition(
        current,
        operationKind,
        { kind: "mark_commit_unknown" },
        "started",
      );
      if (!transitioned) { return undefined; }
      next = { ...transitioned, phase: "commit_unknown" };
      break;
    }
    case "assume_remote_commit": {
      const transitioned = withPrimaryEffectTransition(
        current,
        operationKind,
        { kind: "assume_committed", remoteId: action.commentId },
        "commit_unknown",
      );
      if (!transitioned) { return undefined; }
      next = {
        ...transitioned,
        phase: "remote_committed",
        commentId: action.commentId,
        remoteProjectId: action.projectId,
      };
      break;
    }
    case "record_remote_commit": {
      const transitioned = withPrimaryEffectTransition(
        current,
        operationKind,
        { kind: "commit", remoteId: action.commentId },
        "started",
      );
      if (!transitioned) { return undefined; }
      next = {
        ...transitioned,
        phase: "remote_committed",
        commentId: action.commentId ?? current.commentId,
        remoteProjectId: action.projectId ?? current.remoteProjectId,
      };
      break;
    }
    case "record_reconciled_identity":
      next = {
        ...current,
        commentId: action.commentId,
        remoteProjectId: action.projectId ?? current.remoteProjectId,
        effects: current.effects?.map((effect) => effect.effectId === primaryEffectId(operationKind)
          ? { ...effect, remoteId: action.commentId }
          : effect),
      };
      break;
    case "mark_reconciliation_pending":
      next = { ...current, phase: "reconciliation_pending" };
      break;
    case "mark_local_finalize_pending":
      next = { ...current, phase: "local_finalize_pending" };
      break;
  }
  queue.comments[index] = next;
  await persistAsync(scope);
  return next;
};

export const completeOfflineCommentAsync = async (
  key: CommentQueueKey,
  scope: string,
  expectedRevision: number,
): Promise<boolean> => {
  const queue = getQueue(scope);
  const index = findCommentIndex(queue, key);
  if (index === -1) { return true; }
  const current = queue.comments[index];
  if (current.revision !== expectedRevision) { return false; }
  // next snapshotを構築
  const nextComments = current.nextIntent
    ? queue.comments.map((c, i) => i === index ? promoteCommentIntent(c) : c)
    : queue.comments.filter((_, i) => i !== index);
  const nextQueue: OfflineSyncQueue = { ...queue, comments: nextComments };
  try {
    await replaceOfflineSyncQueueAsync(nextQueue, scope);
  } catch {
    return false;
  }
  return true;
};

export const removeOfflineCommentEntry = (
  params: { commentId?: number; documentUri?: string },
  scope = activeScope,
): void => {
  const queue = getQueue(scope);
  queue.comments = queue.comments.filter((item) => {
    if (params.commentId !== undefined && item.commentId === params.commentId) {
      return false;
    }
    if (params.documentUri && item.documentUri === params.documentUri) {
      return false;
    }
    return true;
  });
  persist(scope);
};

/** Canonical write API for all pending synchronization operations. */
export const upsertSyncOperation = (
  operation: SyncOperation,
  scope = operation.connectionScope || activeScope,
): void => {
  switch (operation.kind) {
    case "ticketCreate": {
      const ticket = operation.payload as OfflineNewTicket;
      const { queueId: _queueId, ...update } = ticket;
      addOfflineNewTicket(update, scope);
      return;
    }
    case "ticketUpdate": {
      const update = operation.payload as OfflineTicketUpdate;
      addOfflineTicketUpdate(update.ticketId, update, scope);
      return;
    }
    case "commentCreate":
    case "commentUpdate":
      addOfflineCommentUpdate(operation.payload as OfflineCommentUpdate, scope);
      return;
  }
};

/** Canonical deletion API. Recovery-pending ticket operations remain protected. */
export const discardSyncOperation = async (
  operationId: string,
  scope = activeScope,
): Promise<OfflineDiscardResult> => {
  const operation = getSyncOperation(operationId, scope);
  if (!operation) {
    return "not_found";
  }
  switch (operation.kind) {
    case "ticketCreate":
      return discardOfflineNewTicketAsync(
        { queueId: (operation.payload as OfflineNewTicket).queueId },
        scope,
      );
    case "ticketUpdate":
      return discardOfflineTicketUpdateAsync(
        (operation.payload as OfflineTicketUpdate).ticketId,
        scope,
      );
    case "commentCreate":
    case "commentUpdate": {
      const comment = operation.payload as OfflineCommentUpdate;
      removeOfflineCommentEntry(
        { commentId: comment.commentId, documentUri: comment.documentUri },
        scope,
      );
      return "discarded";
    }
  }
};
