import {
  GenericLifecycleAction,
  GenericSyncPhase,
  LifecycleExpectation,
  SyncOperationKey,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import {
  applyGenericTransition,
} from "./syncStateMachine";
import {
  addOfflineCommentUpdate,
  addOfflineNewTicketAsync,
  addOfflineTicketUpdate,
  completeOfflineCommentAsync,
  completeOfflineNewTicketAsync,
  completeOfflineTicketUpdateAsync,
  getOfflineSyncQueue,
  removeOfflineCommentEntry,
  removeOfflineNewTicketAsync,
  removeOfflineTicketUpdateAsync,
  type OfflineCommentUpdate,
  type OfflineNewTicket,
  type OfflineTicketUpdate,
} from "../../views/offlineSyncStore";

export interface SyncOperationRepository {
  getOperation(key: SyncOperationKey, scope: string): UnifiedSyncOperation | undefined;
  listOperations(scope: string): UnifiedSyncOperation[];
  saveOperation(
    operation: UnifiedSyncOperation,
    scope: string,
    expectedPersistenceVersion?: number,
  ): Promise<UnifiedSyncOperation | undefined>;
  transitionOperation(
    key: SyncOperationKey,
    action: GenericLifecycleAction,
    scope: string,
    expected?: LifecycleExpectation,
  ): Promise<UnifiedSyncOperation | undefined>;
  completeOperation(
    key: SyncOperationKey,
    scope: string,
    expectedRevision?: number,
  ): Promise<boolean>;
  deleteOperation(key: SyncOperationKey, scope: string): Promise<boolean>;
}

export const toUnifiedOperationFromTicket = (
  ticket: OfflineTicketUpdate,
  scope: string,
): UnifiedSyncOperation => ({
  operationId: ticket.operationId ?? `${scope}:ticket:${ticket.ticketId}`,
  kind: "ticket_update",
  key: { kind: "ticket", ticketId: ticket.ticketId },
  connectionScope: scope,
  phase: (ticket.phase ?? "queued") as GenericSyncPhase,
  revision: ticket.revision ?? 1,
  intentRevision: ticket.revision ?? 1,
  version: ticket.revision ?? 1,
  persistenceVersion: ticket.revision ?? 1,
  ticketId: ticket.ticketId,
  documentUri: ticket.documentUri,
  createdChildIds: ticket.createdChildIds,
  effects: ticket.effects,
  payload: ticket,
  intent: {
    ticketId: ticket.ticketId,
    baseSubject: ticket.baseSubject,
    baseDescription: ticket.baseDescription,
    baseMetadata: ticket.baseMetadata,
    subject: ticket.subject,
    description: ticket.description,
    metadata: ticket.metadata,
    layout: ticket.layout,
    metadataBlock: ticket.metadataBlock,
    controlFields: ticket.controlFields,
    baseDir: ticket.baseDir,
    documentUri: ticket.documentUri,
    lastKnownRemoteUpdatedAt: ticket.lastKnownRemoteUpdatedAt,
  },
  nextIntent: ticket.nextIntent ? {
    ticketId: ticket.ticketId,
    baseSubject: ticket.baseSubject,
    baseDescription: ticket.baseDescription,
    baseMetadata: ticket.baseMetadata,
    subject: ticket.nextIntent.subject,
    description: ticket.nextIntent.description,
    metadata: ticket.nextIntent.metadata,
    layout: ticket.nextIntent.layout,
    metadataBlock: ticket.nextIntent.metadataBlock,
    controlFields: ticket.nextIntent.controlFields,
    baseDir: ticket.nextIntent.baseDir,
    documentUri: ticket.nextIntent.documentUri,
    lastKnownRemoteUpdatedAt: ticket.lastKnownRemoteUpdatedAt,
  } : undefined,
  remoteUpdatedAt: ticket.lastKnownRemoteUpdatedAt,
  createdAt: ticket.createdAt ?? Date.now(),
  updatedAt: ticket.createdAt ?? Date.now(),
});

export const toUnifiedOperationFromNewTicket = (
  ticket: OfflineNewTicket,
  scope: string,
): UnifiedSyncOperation => ({
  operationId: ticket.operationId ?? `${scope}:newTicket:${ticket.queueId ?? ticket.documentUri}`,
  kind: "ticket_create",
  key: { kind: "newTicket", queueId: ticket.queueId, documentUri: ticket.documentUri },
  connectionScope: scope,
  phase: (ticket.phase ?? "queued") as GenericSyncPhase,
  revision: ticket.revision ?? 1,
  intentRevision: ticket.revision ?? 1,
  version: ticket.revision ?? 1,
  persistenceVersion: ticket.revision ?? 1,
  projectId: ticket.projectId,
  documentUri: ticket.documentUri,
  createdRemoteId: ticket.createdIssueId,
  createdChildIds: ticket.createdChildIds,
  effects: ticket.effects,
  payload: ticket,
  intent: {
    projectId: ticket.projectId ?? 0,
    subject: "",
    description: ticket.content,
    metadata: { tracker: "", priority: "", status: "", start_date: "", due_date: "", children: [] },
    baseDir: ticket.baseDir,
    documentUri: ticket.documentUri,
  },
  nextIntent: ticket.nextIntent ? {
    projectId: ticket.nextIntent.projectId ?? ticket.projectId ?? 0,
    subject: "",
    description: ticket.nextIntent.content,
    metadata: { tracker: "", priority: "", status: "", start_date: "", due_date: "", children: [] },
    baseDir: ticket.nextIntent.baseDir,
    documentUri: ticket.nextIntent.documentUri,
  } : undefined,
  createdAt: ticket.createdAt ?? Date.now(),
  updatedAt: ticket.createdAt ?? Date.now(),
});

export const toUnifiedOperationFromComment = (
  comment: OfflineCommentUpdate,
  scope: string,
): UnifiedSyncOperation => ({
  operationId: comment.operationId ?? `${scope}:comment:${comment.ticketId}:${comment.commentId ?? comment.documentUri}`,
  kind: comment.commentId !== undefined ? "comment_update" : "comment_create",
  key: { kind: "comment", ticketId: comment.ticketId, commentId: comment.commentId, documentUri: comment.documentUri },
  connectionScope: scope,
  phase: (comment.phase ?? "queued") as GenericSyncPhase,
  revision: comment.revision ?? 1,
  intentRevision: comment.revision ?? 1,
  version: comment.revision ?? 1,
  persistenceVersion: comment.revision ?? 1,
  ticketId: comment.ticketId,
  commentId: comment.commentId,
  documentUri: comment.documentUri,
  createdRemoteId: comment.commentId,
  projectId: comment.remoteProjectId,
  effects: comment.effects,
  payload: comment,
  intent: {
    ticketId: comment.ticketId,
    commentId: comment.commentId ?? 0,
    baseBody: comment.baseBody,
    body: comment.body,
    baseDir: comment.baseDir,
    documentUri: comment.documentUri,
    sourceNotesHash: comment.sourceNotesHash,
    finalizeDraft: comment.finalizeDraft,
    lastKnownRemoteUpdatedAt: comment.lastKnownRemoteUpdatedAt,
  },
  nextIntent: comment.nextIntent ? {
    ticketId: comment.ticketId,
    commentId: comment.commentId ?? 0,
    baseBody: comment.baseBody,
    body: comment.nextIntent.body,
    baseDir: comment.nextIntent.baseDir,
    documentUri: comment.nextIntent.documentUri,
    sourceNotesHash: comment.sourceNotesHash,
    lastKnownRemoteUpdatedAt: comment.lastKnownRemoteUpdatedAt,
  } : undefined,
  createdAt: comment.createdAt ?? Date.now(),
  updatedAt: comment.createdAt ?? Date.now(),
});

export class DefaultSyncOperationRepository implements SyncOperationRepository {
  public getOperation(key: SyncOperationKey, scope: string): UnifiedSyncOperation | undefined {
    const queue = getOfflineSyncQueue(scope);
    if (key.kind === "ticket") {
      const ticket = queue.tickets.get(key.ticketId);
      return ticket ? toUnifiedOperationFromTicket(ticket, scope) : undefined;
    }
    if (key.kind === "newTicket") {
      const ticket = queue.newTickets.find(
        (t) => (key.queueId && t.queueId === key.queueId) || (key.documentUri && t.documentUri === key.documentUri),
      );
      return ticket ? toUnifiedOperationFromNewTicket(ticket, scope) : undefined;
    }
    if (key.kind === "comment") {
      const comment = queue.comments.find(
        (c) =>
          c.ticketId === key.ticketId &&
          ((key.commentId !== undefined && c.commentId === key.commentId) ||
            (key.documentUri && c.documentUri === key.documentUri)),
      );
      return comment ? toUnifiedOperationFromComment(comment, scope) : undefined;
    }
    return undefined;
  }

  public listOperations(scope: string): UnifiedSyncOperation[] {
    const queue = getOfflineSyncQueue(scope);
    const operations: UnifiedSyncOperation[] = [];

    for (const ticket of queue.tickets.values()) {
      operations.push(toUnifiedOperationFromTicket(ticket, scope));
    }
    for (const newTicket of queue.newTickets) {
      operations.push(toUnifiedOperationFromNewTicket(newTicket, scope));
    }
    for (const comment of queue.comments) {
      operations.push(toUnifiedOperationFromComment(comment, scope));
    }

    return operations;
  }

  public async saveOperation(
    operation: UnifiedSyncOperation,
    scope: string,
    expectedPersistenceVersion?: number,
  ): Promise<UnifiedSyncOperation | undefined> {
    const current = this.getOperation(operation.key ?? { kind: "ticket", ticketId: operation.ticketId ?? 0 }, scope);

    // CAS チェック (INV-06)
    if (expectedPersistenceVersion !== undefined && current) {
      const currentVersion = current.version ?? current.persistenceVersion ?? 1;
      if (currentVersion !== expectedPersistenceVersion) {
        return undefined; // バージョン不一致で競合防止
      }
    }

    const nextVersion = (operation.version ?? operation.persistenceVersion ?? (current?.version ?? 0)) + 1;
    const updated: UnifiedSyncOperation = {
      ...operation,
      version: nextVersion,
      persistenceVersion: nextVersion,
      updatedAt: Date.now(),
    };

    if (operation.kind === "ticket_update" && operation.ticketId !== undefined) {
      const payload: OfflineTicketUpdate = {
        ...(operation.payload ?? {}),
        ticketId: operation.ticketId,
        operationId: operation.operationId,
        phase: operation.phase as any,
        revision: updated.version,
        createdChildIds: operation.createdChildIds,
        effects: operation.effects,
      };
      addOfflineTicketUpdate(operation.ticketId, payload, scope);
    } else if (operation.kind === "ticket_create") {
      const payload: OfflineNewTicket = {
        ...(operation.payload ?? {}),
        queueId: (operation.key?.kind === "newTicket" ? operation.key.queueId : undefined) ?? operation.operationId,
        operationId: operation.operationId,
        phase: operation.phase as any,
        revision: updated.version,
        projectId: operation.projectId,
        documentUri: operation.documentUri,
        createdIssueId: operation.createdRemoteId,
        createdChildIds: operation.createdChildIds,
        effects: operation.effects,
      };
      await addOfflineNewTicketAsync(payload, scope);
    } else if (operation.kind === "comment_create" || operation.kind === "comment_update") {
      const payload: OfflineCommentUpdate = {
        ...(operation.payload ?? {}),
        ticketId: operation.ticketId ?? (operation.key?.kind === "comment" ? operation.key.ticketId : 0),
        commentId: operation.commentId ?? (operation.key?.kind === "comment" ? operation.key.commentId : undefined),
        operationId: operation.operationId,
        phase: operation.phase as any,
        revision: updated.version,
        documentUri: operation.documentUri,
        effects: operation.effects,
      };
      addOfflineCommentUpdate(payload, scope);
    }

    return updated;
  }

  public async transitionOperation(
    key: SyncOperationKey,
    action: GenericLifecycleAction,
    scope: string,
    expected?: LifecycleExpectation,
  ): Promise<UnifiedSyncOperation | undefined> {
    const current = this.getOperation(key, scope);
    if (!current) {
      return undefined;
    }

    if (expected) {
      if (expected.operationId && current.operationId !== expected.operationId) {
        return undefined;
      }
      if (expected.sourcePhase && current.phase !== expected.sourcePhase) {
        return undefined;
      }
      if (expected.revision !== undefined) {
        const currentRev = current.intentRevision ?? current.revision;
        if (currentRev !== expected.revision) {
          return undefined;
        }
      }
    }

    const next = applyGenericTransition(current, action);
    if (!next) {
      return undefined;
    }

    return this.saveOperation(next, scope, current.version ?? current.persistenceVersion);
  }

  public async completeOperation(
    key: SyncOperationKey,
    scope: string,
    expectedRevision?: number,
  ): Promise<boolean> {
    const current = this.getOperation(key, scope);
    if (!current) {
      return true;
    }

    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      return false;
    }

    // nextIntent があれば新世代 operation として昇格 (INV-07)
    if (current.nextIntent) {
      const promoted: UnifiedSyncOperation = {
        ...current,
        operationId: `${scope}:${current.kind}:${Date.now()}`,
        phase: "queued",
        intent: current.nextIntent,
        payload: current.nextIntent,
        nextIntent: undefined,
        intentRevision: (current.intentRevision ?? current.revision ?? 0) + 1,
        revision: (current.intentRevision ?? current.revision ?? 0) + 1,
        version: (current.version ?? current.persistenceVersion ?? 0) + 1,
        persistenceVersion: (current.version ?? current.persistenceVersion ?? 0) + 1,
        effects: [],
        createdRemoteId: undefined,
        remoteUpdatedAt: undefined,
        createdChildIds: undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await this.saveOperation(promoted, scope);
      return true;
    }

    // 削除
    return this.deleteOperation(key, scope);
  }

  public async deleteOperation(key: SyncOperationKey, scope: string): Promise<boolean> {
    if (key.kind === "ticket") {
      await removeOfflineTicketUpdateAsync(key.ticketId, scope);
      return true;
    }
    if (key.kind === "newTicket") {
      const queue = getOfflineSyncQueue(scope);
      const ticket = queue.newTickets.find(
        (t) => (key.queueId && t.queueId === key.queueId) || (key.documentUri && t.documentUri === key.documentUri),
      );
      if (ticket) {
        await removeOfflineNewTicketAsync({ queueId: ticket.queueId }, scope);
      }
      return true;
    }
    if (key.kind === "comment") {
      removeOfflineCommentEntry(
        { commentId: key.commentId, documentUri: key.documentUri },
        scope,
      );
      return true;
    }
    return false;
  }
}

export const createSyncOperationRepository = (): SyncOperationRepository =>
  new DefaultSyncOperationRepository();

