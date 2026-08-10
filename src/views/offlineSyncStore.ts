import { randomUUID } from "crypto";
import type { Memento } from "vscode";
import { IssueMetadata } from "./ticketMetadataTypes";
import {
  TicketEditorContent,
  TicketEditorLayout,
  TicketEditorMetadataBlock,
} from "./ticketEditorContent";
import type { FrontmatterControlFields } from "./ticketMetadataControlFields";

export type TicketUpdateSyncPhase =
  | "queued"
  | "remote_write_started"
  | "commit_unknown"
  | "remote_committed"
  | "reconciliation_pending"
  | "local_finalize_pending"
  | "completed";

export type NewTicketSyncPhase =
  | "queued"
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
  layout?: TicketEditorLayout;
  metadataBlock?: TicketEditorMetadataBlock;
  controlFields?: FrontmatterControlFields;
  baseDir?: string;
  documentUri?: string;
  operationId?: string;
  connectionScope?: string;
  phase?: TicketUpdateSyncPhase;
  remoteUpdatedAt?: string;
  createdChildIds?: number[];
  revision?: number;
  nextIntent?: TicketUpdateIntentSnapshot;
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
  remoteUpdatedAt?: string;
  createdChildIds?: number[];
  revision?: number;
  nextIntent?: NewTicketIntentSnapshot;
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
  tickets: [number, OfflineTicketUpdate][];
  comments: OfflineCommentUpdate[];
  newTickets: OfflineNewTicket[];
};

let memento: Memento | undefined;
let activeScope = "";
const queuesByScope = new Map<string, OfflineSyncQueue>();
const persistenceByScope = new Map<string, Promise<void>>();
const pendingSnapshotByScope = new Map<string, SerializedQueue>();

const emptyQueue = (): OfflineSyncQueue => ({
  tickets: new Map<number, OfflineTicketUpdate>(),
  comments: [],
  newTickets: [],
});

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
    tickets: Array.from(queue.tickets.entries()).map(
      ([ticketId, update]) => [ticketId, { ...update }] as [number, OfflineTicketUpdate],
    ),
    comments: queue.comments.map((comment) => ({ ...comment })),
    newTickets: queue.newTickets.map((ticket) => ({ ...ticket })),
  };
};

const schedulePersist = (
  scope: string,
  serialized: SerializedQueue,
): Promise<void> => {
  pendingSnapshotByScope.set(scope, serialized);
  const targetMemento = memento;
  const previous = persistenceByScope.get(scope);
  const perform = async (): Promise<void> => {
    if (targetMemento) {
      await targetMemento.update(storageKeyForScope(scope), serialized);
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

const persistAsync = async (scope = activeScope): Promise<void> => {
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

const deserializeQueue = (raw: SerializedQueue | undefined): OfflineSyncQueue => {
  return {
    tickets: new Map(
      raw && Array.isArray(raw.tickets)
        ? raw.tickets.filter(
          (e): e is [number, OfflineTicketUpdate] =>
            Array.isArray(e) &&
            typeof e[0] === "number" &&
            e[1] !== null &&
            typeof e[1] === "object",
        ).map(([ticketId, update]) => [
          ticketId,
          {
            ...update,
            phase: update.phase ?? "queued",
            revision: update.revision ?? 1,
          },
        ] as [number, OfflineTicketUpdate])
        : [],
    ),
    comments:
      raw && Array.isArray(raw.comments)
        ? raw.comments.filter((c) => c !== null && typeof c === "object")
        : [],
    newTickets:
      raw && Array.isArray(raw.newTickets)
        ? raw.newTickets
          .filter((t) => t !== null && typeof t === "object")
          .map((ticket) => ({
            ...ticket,
            operationId: ticket.operationId ?? ticket.queueId,
            revision: ticket.revision ?? 1,
            phase: ticket.phase ?? (
              ticket.createdIssueId !== undefined || ticket.status === "created_rewrite_failed"
                ? "local_finalize_pending"
                : "queued"
            ),
          }))
        : [],
  };
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
  if (!scoped && legacy) {
    void storage.update(activeStorageKey, legacy);
    void storage.update(STORAGE_KEY, undefined);
  }
  queuesByScope.set(activeScope, deserializeQueue(pendingSnapshot ?? scoped ?? legacy));
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
    return {
      ...existing,
      documentUri: existing.documentUri ?? update.documentUri,
      nextIntent: {
        revision,
        subject: update.subject,
        description: update.description,
        metadata: update.metadata,
        layout: update.layout,
        metadataBlock: update.metadataBlock,
        controlFields: update.controlFields,
        baseDir: update.baseDir,
        documentUri: update.documentUri ?? existing.documentUri,
      },
    };
  }
  return {
    ...(existing ?? update),
    ...update,
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

const replaceFirstMatch = (
  updates: OfflineCommentUpdate[],
  matcher: (candidate: OfflineCommentUpdate) => boolean,
  update: OfflineCommentUpdate,
): boolean => {
  const index = updates.findIndex(matcher);
  if (index === -1) {
    return false;
  }
  updates[index] = { ...updates[index], ...update };
  return true;
};

export const addOfflineCommentUpdate = (
  update: OfflineCommentUpdate,
  scope = activeScope,
): void => {
  const queue = getQueue(scope);
  if (update.commentId !== undefined) {
    if (replaceFirstMatch(queue.comments, (item) => item.commentId === update.commentId, update)) {
      persist(scope);
      return;
    }
  }
  if (update.documentUri) {
    if (
      replaceFirstMatch(
        queue.comments,
        (item) => item.documentUri === update.documentUri,
        update,
      )
    ) {
      persist(scope);
      return;
    }
  }
  queue.comments.push(update);
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

const sameDocumentIdentity = (
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
): Promise<OfflineNewTicket | undefined> => {
  const queue = getQueue(scope);
  const index = findNewTicketIndex(queue, key);
  if (index === -1) {
    return undefined;
  }
  queue.newTickets[index] = { ...queue.newTickets[index], ...updates };
  await persistAsync(scope);
  return queue.newTickets[index];
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
): Promise<boolean> => {
  const queue = getQueue(scope);
  const index = findNewTicketIndex(queue, key);
  if (index === -1) {
    return true;
  }
  const current = queue.newTickets[index];
  if (current.nextIntent) {
    if (!promotion || promotion.sourceRevision !== current.nextIntent.revision) {
      return false;
    }
  }
  queue.newTickets.splice(index, 1);
  if (promotion) {
    const { sourceRevision: _sourceRevision, ...ticketUpdate } = promotion;
    queue.tickets.set(promotion.ticketId, ticketUpdate);
  }
  await persistAsync(scope);
  return true;
};

export const updateOfflineTicketUpdateAsync = async (
  ticketId: number,
  updates: Partial<Pick<OfflineTicketUpdate, "phase" | "remoteUpdatedAt" | "createdChildIds">>,
  scope: string,
): Promise<OfflineTicketUpdate | undefined> => {
  const queue = getQueue(scope);
  const current = queue.tickets.get(ticketId);
  if (!current) {
    return undefined;
  }
  const next = { ...current, ...updates };
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
  if (operation.phase && operation.phase !== "queued" && operation.phase !== "completed") {
    if (!operation.nextIntent) {
      return "recovery_required";
    }
    queue.tickets.set(ticketId, { ...operation, nextIntent: undefined });
    await persistAsync(scope);
    return "discarded_next";
  }
  queue.tickets.delete(ticketId);
  await persistAsync(scope);
  return "discarded";
};

export const completeOfflineTicketUpdateAsync = async (
  ticketId: number,
  scope: string,
  completion?: { canonical: TicketEditorContent; remoteUpdatedAt: string },
): Promise<boolean> => {
  const queue = getQueue(scope);
  const current = queue.tickets.get(ticketId);
  if (!current) {
    return true;
  }
  if (current.nextIntent && completion) {
    const next = current.nextIntent;
    queue.tickets.set(ticketId, {
      ticketId,
      baseSubject: completion.canonical.subject,
      baseDescription: completion.canonical.description,
      baseMetadata: completion.canonical.metadata,
      lastKnownRemoteUpdatedAt: completion.remoteUpdatedAt,
      subject: next.subject,
      description: next.description,
      metadata: next.metadata,
      layout: next.layout ?? completion.canonical.layout,
      metadataBlock: next.metadataBlock ?? completion.canonical.metadataBlock,
      controlFields: next.controlFields ?? completion.canonical.controlFields,
      baseDir: next.baseDir ?? current.baseDir,
      documentUri: next.documentUri ?? current.documentUri,
      operationId: current.operationId,
      connectionScope: current.connectionScope ?? scope,
      phase: "queued",
      revision: next.revision,
    });
  } else {
    queue.tickets.delete(ticketId);
  }
  await persistAsync(scope);
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
