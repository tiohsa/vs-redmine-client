import type {
  CommentQueueKey,
  OfflineCommentUpdate,
  OfflineDiscardKey,
  OfflineNewTicket,
  OfflineSyncQueue,
  OfflineTicketUpdate,
  ResolvedStoredOperation,
  StoredOfflineOperation,
} from "./offlineSyncTypes";

export const findNewTicketIndex = (
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
  }
  return uri;
};

export const sameDocumentIdentity = (
  left: string | undefined,
  right: string | undefined,
): boolean => left !== undefined && right !== undefined &&
  documentIdentity(left) === documentIdentity(right);

export const resolveStoredOfflineOperation = (
  queue: OfflineSyncQueue,
  key: OfflineDiscardKey,
): ResolvedStoredOperation | undefined => {
  if (key.kind === "ticket") {
    const value = queue.tickets.get(key.ticketId);
    return value ? { kind: "ticket", value } : undefined;
  }
  if (key.kind === "newTicket") {
    if (key.queueId === undefined && key.documentUri === undefined) { return undefined; }
    const matches = queue.newTickets.filter((candidate) =>
      (key.queueId === undefined || candidate.queueId === key.queueId ||
        candidate.operationId === key.queueId ||
        Boolean(candidate.operationId?.endsWith(`:${key.queueId}`))) &&
      (key.documentUri === undefined || sameDocumentIdentity(candidate.documentUri, key.documentUri)));
    return matches.length === 1 ? { kind: "newTicket", value: matches[0] } : undefined;
  }
  if (key.commentId === undefined && key.documentUri === undefined && key.operationId === undefined) {
    const legacy = queue.comments.filter((candidate) => candidate.ticketId === key.ticketId);
    return legacy.length === 1 ? { kind: "comment", value: legacy[0] } : undefined;
  }
  const matches = queue.comments.filter((candidate) =>
    candidate.ticketId === key.ticketId &&
    (key.operationId === undefined || candidate.operationId === key.operationId) &&
    (key.commentId === undefined || candidate.commentId === key.commentId) &&
    (key.documentUri === undefined || candidate.documentUri === key.documentUri));
  return matches.length === 1 ? { kind: "comment", value: matches[0] } : undefined;
};

export const findCommentIndex = (queue: OfflineSyncQueue, key: CommentQueueKey): number => {
  const resolved = resolveStoredOfflineOperation(queue, { kind: "comment", ...key });
  return resolved?.kind === "comment" ? queue.comments.indexOf(resolved.value) : -1;
};

export const findStoredOperation = (
  queue: OfflineSyncQueue,
  operationId: string,
): OfflineNewTicket | OfflineTicketUpdate | OfflineCommentUpdate | undefined => {
  const operations = [
    ...queue.newTickets,
    ...queue.tickets.values(),
    ...queue.comments,
  ];
  const exact = operations.filter((op) => op.operationId === operationId);
  if (exact.length > 0) { return exact.length === 1 ? exact[0] : undefined; }
  const aliases = operations.filter((op) =>
    ("queueId" in op && op.queueId === operationId) ||
    (op.operationId !== undefined && operationId.endsWith(`:${op.operationId}`)));
  return aliases.length === 1 ? aliases[0] : undefined;
};

export const replaceStoredOperationInQueue = (
  queue: OfflineSyncQueue,
  current: StoredOfflineOperation,
  next: StoredOfflineOperation,
): void => {
  const newTicketIndex = queue.newTickets.findIndex((entry) => entry === current);
  if (newTicketIndex !== -1) {
    queue.newTickets[newTicketIndex] = next as OfflineNewTicket;
    return;
  }
  const ticketEntry = Array.from(queue.tickets.entries()).find(([, entry]) => entry === current);
  if (ticketEntry) {
    queue.tickets.set(ticketEntry[0], next as OfflineTicketUpdate);
    return;
  }
  const commentIndex = queue.comments.findIndex((entry) => entry === current);
  if (commentIndex !== -1) {
    queue.comments[commentIndex] = next as OfflineCommentUpdate;
  }
};
