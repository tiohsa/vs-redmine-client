import { randomUUID } from "crypto";
import type { Memento } from "vscode";
import { IssueMetadata } from "./ticketMetadataTypes";
import { TicketEditorLayout, TicketEditorMetadataBlock } from "./ticketEditorContent";

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
  baseDir?: string;
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
  content: string;
  projectId?: number;
  documentUri?: string;
  baseDir?: string;
  createdIssueId?: number;
  status?: "queued" | "created_rewrite_failed";
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

const persist = (scope = activeScope): void => {
  const queue = getQueue(scope);
  if (memento) {
    const serialized: SerializedQueue = {
      tickets: Array.from(queue.tickets.entries()),
      comments: queue.comments,
      newTickets: queue.newTickets,
    };
    Promise.resolve(memento.update(storageKeyForScope(scope), serialized)).catch((err: unknown) => {
      console.error("[vs-redmine-client] offlineSyncStore: persist failed", err);
    });
  }
  notifyQueueChanged();
};

function loadQueue(storage: Memento, storageKey: string): OfflineSyncQueue {
  const raw = storage.get<SerializedQueue>(storageKey);
  return {
    tickets: new Map(
      raw && Array.isArray(raw.tickets)
        ? raw.tickets.filter(
          (e): e is [number, OfflineTicketUpdate] =>
            Array.isArray(e) &&
            typeof e[0] === "number" &&
            e[1] !== null &&
            typeof e[1] === "object",
        )
        : [],
    ),
    comments:
      raw && Array.isArray(raw.comments)
        ? raw.comments.filter((c) => c !== null && typeof c === "object")
        : [],
    newTickets:
      raw && Array.isArray(raw.newTickets)
        ? raw.newTickets.filter((t) => t !== null && typeof t === "object")
        : [],
  };
}

export const initializeOfflineSyncStore = (storage: Memento, scope?: string): void => {
  memento = storage;
  activeScope = scope ?? "";
  queuesByScope.clear();
  const activeStorageKey = storageKeyForScope(activeScope);
  const scoped = storage.get<SerializedQueue>(activeStorageKey);
  const legacy = scope ? storage.get<SerializedQueue>(STORAGE_KEY) : undefined;
  if (!scoped && legacy) {
    void storage.update(activeStorageKey, legacy);
    void storage.update(STORAGE_KEY, undefined);
  }
  queuesByScope.set(
    activeScope,
    loadQueue(storage, scoped ? activeStorageKey : legacy ? STORAGE_KEY : activeStorageKey),
  );
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
    return queue.newTickets.findIndex((t) => t.documentUri === key.documentUri);
  }
  return -1;
};

export const addOfflineNewTicket = (
  update: Omit<OfflineNewTicket, "queueId">,
  scope = activeScope,
): void => {
  const queue = getQueue(scope);
  const index = update.documentUri
    ? queue.newTickets.findIndex((item) => item.documentUri === update.documentUri)
    : -1;
  if (index !== -1) {
    const existing = queue.newTickets[index];
    queue.newTickets.splice(index, 1);
    queue.newTickets.unshift({ ...existing, ...update });
  } else {
    queue.newTickets.unshift({ ...update, queueId: randomUUID() });
  }
  persist(scope);
};

export const getOfflineSyncQueue = (scope = activeScope): OfflineSyncQueue => {
  const queue = getQueue(scope);
  return {
    tickets: new Map(queue.tickets),
    comments: [...queue.comments],
    newTickets: [...queue.newTickets],
  };
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
  updates: Partial<Pick<OfflineNewTicket, "createdIssueId" | "status">>,
  scope = activeScope,
): void => {
  const queue = getQueue(scope);
  const index = findNewTicketIndex(queue, key);
  if (index !== -1) {
    queue.newTickets[index] = { ...queue.newTickets[index], ...updates };
    persist(scope);
  }
};

export const removeOfflineNewTicket = (
  key: { queueId?: string; documentUri?: string },
  scope = activeScope,
): void => {
  const queue = getQueue(scope);
  const index = findNewTicketIndex(queue, key);
  if (index !== -1) {
    queue.newTickets.splice(index, 1);
    persist(scope);
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
