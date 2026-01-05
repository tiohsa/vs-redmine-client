import { IssueMetadata } from "./ticketMetadataTypes";

export type OfflineTicketUpdate = {
  ticketId: number;
  baseSubject: string;
  baseDescription: string;
  baseMetadata: IssueMetadata;
  lastKnownRemoteUpdatedAt?: string;
  subject: string;
  description: string;
  metadata: IssueMetadata;
  layout?: string[];
  metadataBlock?: string[];
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
};

export type OfflineSyncQueue = {
  tickets: Map<number, OfflineTicketUpdate>;
  comments: OfflineCommentUpdate[];
  newTickets: Array<{
    content: string;
    projectId?: number;
    documentUri?: string;
    baseDir?: string;
  }>;
};

const queue: OfflineSyncQueue = {
  tickets: new Map<number, OfflineTicketUpdate>(),
  comments: [],
  newTickets: [],
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
      return;
    }
  }
  queue.comments.push(update);
};

export const addOfflineNewTicket = (update: {
  content: string;
  projectId?: number;
  documentUri?: string;
  baseDir?: string;
}): void => {
  if (update.documentUri) {
    const index = queue.newTickets.findIndex(
      (item) => item.documentUri === update.documentUri,
    );
    if (index !== -1) {
      queue.newTickets[index] = { ...queue.newTickets[index], ...update };
      return;
    }
  }
  queue.newTickets.push(update);
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
};

export const replaceOfflineSyncQueue = (next: OfflineSyncQueue): void => {
  queue.tickets = new Map(next.tickets);
  queue.comments = [...next.comments];
  queue.newTickets = [...next.newTickets];
};
