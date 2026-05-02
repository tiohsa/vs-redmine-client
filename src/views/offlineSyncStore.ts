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

const queue: OfflineSyncQueue = {
  tickets: new Map<number, OfflineTicketUpdate>(),
  comments: [],
  newTickets: [],
};

let memento: Memento | undefined;

const persist = (): void => {
  if (memento) {
    const serialized: SerializedQueue = {
      tickets: Array.from(queue.tickets.entries()),
      comments: queue.comments,
      newTickets: queue.newTickets,
    };
    Promise.resolve(memento.update(STORAGE_KEY, serialized)).catch((err: unknown) => {
      console.error("[vs-redmine-client] offlineSyncStore: persist failed", err);
    });
  }
  notifyQueueChanged();
};

export const initializeOfflineSyncStore = (storage: Memento): void => {
  memento = storage;
  const raw = storage.get<SerializedQueue>(STORAGE_KEY);
  queue.tickets = new Map(
    raw && Array.isArray(raw.tickets)
      ? raw.tickets.filter(
          (e): e is [number, OfflineTicketUpdate] =>
            Array.isArray(e) &&
            typeof e[0] === "number" &&
            e[1] !== null &&
            typeof e[1] === "object",
        )
      : [],
  );
  queue.comments =
    raw && Array.isArray(raw.comments)
      ? raw.comments.filter((c) => c !== null && typeof c === "object")
      : [];
  queue.newTickets =
    raw && Array.isArray(raw.newTickets)
      ? raw.newTickets.filter((t) => t !== null && typeof t === "object")
      : [];
};

export const addOfflineTicketUpdate = (
  ticketId: number,
  update: OfflineTicketUpdate,
): void => {
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
  persist();
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

export const addOfflineCommentUpdate = (update: OfflineCommentUpdate): void => {
  if (update.commentId !== undefined) {
    if (replaceFirstMatch(queue.comments, (item) => item.commentId === update.commentId, update)) {
      persist();
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
      persist();
      return;
    }
  }
  queue.comments.push(update);
  persist();
};

export const addOfflineNewTicket = (update: OfflineNewTicket): void => {
  if (update.documentUri) {
    const index = queue.newTickets.findIndex(
      (item) => item.documentUri === update.documentUri,
    );
    if (index !== -1) {
      const existing = queue.newTickets[index];
      queue.newTickets.splice(index, 1);
      queue.newTickets.unshift({ ...existing, ...update });
      persist();
      return;
    }
  }
  queue.newTickets.unshift(update);
  persist();
};

export const getOfflineSyncQueue = (): OfflineSyncQueue => ({
  tickets: new Map(queue.tickets),
  comments: [...queue.comments],
  newTickets: [...queue.newTickets],
});

export const clearOfflineSyncQueue = (): void => {
  queue.tickets.clear();
  queue.comments = [];
  queue.newTickets = [];
  persist();
};

export const replaceOfflineSyncQueue = (next: OfflineSyncQueue): void => {
  queue.tickets = new Map(next.tickets);
  queue.comments = [...next.comments];
  queue.newTickets = [...next.newTickets];
  persist();
};

export const removeOfflineTicketUpdate = (ticketId: number): void => {
  queue.tickets.delete(ticketId);
  persist();
};

export const updateOfflineNewTicket = (
  documentUri: string,
  updates: Partial<Pick<OfflineNewTicket, "createdIssueId" | "status">>,
): void => {
  const index = queue.newTickets.findIndex((item) => item.documentUri === documentUri);
  if (index !== -1) {
    queue.newTickets[index] = { ...queue.newTickets[index], ...updates };
    persist();
  }
};

export const removeOfflineNewTicket = (documentUri: string): void => {
  queue.newTickets = queue.newTickets.filter((item) => item.documentUri !== documentUri);
  persist();
};

export const removeOfflineCommentEntry = (params: { commentId?: number; documentUri?: string }): void => {
  queue.comments = queue.comments.filter((item) => {
    if (params.commentId !== undefined && item.commentId === params.commentId) {
      return false;
    }
    if (params.documentUri && item.documentUri === params.documentUri) {
      return false;
    }
    return true;
  });
  persist();
};
