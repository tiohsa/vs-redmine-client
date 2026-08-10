import { randomUUID } from "crypto";
import type { Memento } from "vscode";
import { IssueMetadata } from "./ticketMetadataTypes";
import { TicketEditorLayout, TicketEditorMetadataBlock } from "./ticketEditorContent";
import type { FrontmatterControlFields } from "./ticketMetadataControlFields";

export type TicketUpdateSyncPhase =
  | "queued"
  | "remote_committed"
  | "reconciliation_pending"
  | "local_finalize_pending"
  | "completed";

export type NewTicketSyncPhase =
  | "queued"
  | "remote_created"
  | "reconciliation_pending"
  | "local_finalize_pending"
  | "completed";

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
};

export type OfflineSyncQueue = {
  tickets: Map<number, OfflineTicketUpdate>;
  comments: OfflineCommentUpdate[];
  newTickets: OfflineNewTicket[];
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

const persistAsync = async (scope = activeScope): Promise<void> => {
  const serialized = serializeQueue(scope);
  const previous = persistenceByScope.get(scope);
  const perform = async (): Promise<void> => {
      if (memento) {
        await memento.update(storageKeyForScope(scope), serialized);
      }
  };
  const current = previous
    ? previous.catch(() => undefined).then(perform)
    : perform();
  persistenceByScope.set(scope, current);
  try {
    await current;
    notifyQueueChanged();
  } finally {
    if (persistenceByScope.get(scope) === current) {
      persistenceByScope.delete(scope);
    }
  }
};

const persist = (scope = activeScope): void => {
  const serialized = serializeQueue(scope);
  const current = memento
    ? Promise.resolve(memento.update(storageKeyForScope(scope), serialized))
    : Promise.resolve();
  persistenceByScope.set(scope, current);
  notifyQueueChanged();
  void current.catch((err: unknown) => {
      console.error("[vs-redmine-client] offlineSyncStore: persist failed", err);
  }).finally(() => {
    if (persistenceByScope.get(scope) === current) {
      persistenceByScope.delete(scope);
    }
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
          { ...update, phase: update.phase ?? "queued" },
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
  memento = storage;
  activeScope = scope ?? "";
  queuesByScope.clear();
  persistenceByScope.clear();
  const activeStorageKey = storageKeyForScope(activeScope);
  const scoped = storage.get<SerializedQueue>(activeStorageKey);
  const legacy = scope ? storage.get<SerializedQueue>(STORAGE_KEY) : undefined;
  if (!scoped && legacy) {
    void storage.update(activeStorageKey, legacy);
    void storage.update(STORAGE_KEY, undefined);
  }
  queuesByScope.set(activeScope, deserializeQueue(scoped ?? legacy));
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

export const addOfflineTicketUpdate = (
  ticketId: number,
  update: OfflineTicketUpdate,
  scope = activeScope,
): void => {
  const queue = getQueue(scope);
  const existing = queue.tickets.get(ticketId);
  queue.tickets.set(ticketId, {
    ...(existing ?? update),
    ...update,
    baseSubject: existing?.baseSubject ?? update.baseSubject,
    baseDescription: existing?.baseDescription ?? update.baseDescription,
    baseMetadata: existing?.baseMetadata ?? update.baseMetadata,
    lastKnownRemoteUpdatedAt:
      existing?.lastKnownRemoteUpdatedAt ?? update.lastKnownRemoteUpdatedAt,
    operationId: existing?.operationId ?? update.operationId,
    connectionScope: existing?.connectionScope ?? update.connectionScope,
    phase: existing?.phase && existing.phase !== "queued"
      ? existing.phase
      : update.phase ?? existing?.phase,
    remoteUpdatedAt: existing?.remoteUpdatedAt ?? update.remoteUpdatedAt,
    createdChildIds: existing?.createdChildIds ?? update.createdChildIds,
  });
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
    queue.newTickets.unshift({ ...existing, ...update });
  } else {
    const queueId = randomUUID();
    queue.newTickets.unshift({
      ...update,
      queueId,
      operationId: queueId,
      phase: update.phase ?? "queued",
      connectionScope: update.connectionScope ?? scope,
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
  const entry: OfflineNewTicket = index === -1
    ? {
      ...update,
      queueId,
      operationId: update.operationId ?? queueId,
      phase: update.phase ?? "queued",
      connectionScope: update.connectionScope ?? scope,
    }
    : { ...queue.newTickets[index], ...update };
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
