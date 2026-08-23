import { AsyncLocalStorage } from "async_hooks";
import {
  GenericLifecycleAction,
  GenericSyncPhase,
  LifecycleExpectation,
  SyncIntent,
  SyncOperationKey,
  TicketCreateIntent,
  TicketUpdateIntent,
  CommentCreateIntent,
  CommentUpdateIntent,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import {
  applyGenericTransition,
  retainDurableEffectsForRetry,
} from "./syncStateMachine";
import {
  areSnapshotsEqual,
  DurableSyncEffect,
  DurableSyncEffectAction,
  DurableSyncEffectState,
  EffectFailureInfo,
  getAttemptGeneration,
  normalizeAttemptGeneration,
  isPrimaryEffectKind,
  evaluateAttemptClosure,
  SyncEffectRequestSnapshot,
  transitionDurableSyncEffect,
} from "../syncEffects";
import {
  addOfflineCommentUpdateAsync,
  addOfflineNewTicketAsync,
  addOfflineTicketUpdateAsync,
  completeOfflineCommentAsync,
  completeOfflineNewTicketAsync,
  completeOfflineTicketUpdateAsync,
  getOfflineSyncQueue,
  mutateOfflineSyncQueueAsync,
  removeOfflineCommentEntryAsync,
  removeOfflineNewTicketAsync,
  removeOfflineTicketUpdateAsync,
  sameDocumentIdentity,
  type OfflineCommentUpdate,
  type OfflineNewTicket,
  type OfflineTicketUpdate,
} from "../../views/offlineSyncStore";
import {
  parseTicketEditorContent,
  buildTicketEditorContent,
  type TicketEditorContent,
} from "../../views/ticketEditorContent";

const getOpKeyString = (key: SyncOperationKey): string => {
  if (key.kind === "ticket") {
    return `ticket:${key.ticketId}`;
  }
  if (key.kind === "newTicket") {
    return `newTicket:${key.queueId ?? key.documentUri ?? "0"}`;
  }
  return `comment:${key.ticketId}:${key.commentId ?? key.documentUri ?? "new"}`;
};

const getOperationKey = (operation: UnifiedSyncOperation): SyncOperationKey => operation.key ?? (
  operation.kind === "ticket_create"
    ? { kind: "newTicket", queueId: operation.operationId, documentUri: operation.documentUri }
    : operation.kind === "comment_create" || operation.kind === "comment_update"
      ? { kind: "comment", ticketId: operation.ticketId ?? 0, commentId: operation.commentId, documentUri: operation.documentUri }
      : { kind: "ticket", ticketId: operation.ticketId ?? 0 }
);

export type PrimaryRemoteTransition =
  | {
      kind: "start";
      requestSnapshot: SyncEffectRequestSnapshot;
    }
  | {
      kind: "start_explicit_retry";
      requestSnapshot?: SyncEffectRequestSnapshot;
    }
  | {
      kind: "commit";
      remoteId?: number;
      projectId?: number;
      remoteUpdatedAt?: string;
      requestSnapshot?: SyncEffectRequestSnapshot;
    }
  | {
      kind: "commit_unknown";
      detail?: string;
    }
  | {
      kind: "failed";
      failure: EffectFailureInfo;
    };

export interface SyncOperationRepository {
  getOperation<I extends SyncIntent = SyncIntent>(key: SyncOperationKey, scope: string): UnifiedSyncOperation<I> | undefined;
  listOperations(scope: string): UnifiedSyncOperation[];
  saveOperation(
    operation: UnifiedSyncOperation,
    scope: string,
    expectedPersistenceVersion?: number,
    options?: SaveOperationOptions,
  ): Promise<UnifiedSyncOperation | undefined>;
  transitionOperation(
    key: SyncOperationKey,
    action: GenericLifecycleAction,
    scope: string,
    expected?: LifecycleExpectation,
  ): Promise<UnifiedSyncOperation | undefined>;
  transitionPrimaryRemoteWrite(
    key: SyncOperationKey,
    transition: PrimaryRemoteTransition,
    scope: string,
    expected?: LifecycleExpectation,
  ): Promise<UnifiedSyncOperation | undefined>;
  planEffect(
    key: SyncOperationKey,
    effect: DurableSyncEffect,
    scope: string,
    expectedRevision?: number,
    options?: SaveOperationOptions,
  ): Promise<UnifiedSyncOperation | undefined>;
  transitionEffect(
    key: SyncOperationKey,
    effectId: string,
    action: DurableSyncEffectAction,
    scope: string,
    expected?: {
      operationRevision?: number;
      attemptGeneration?: number;
      sourceState: DurableSyncEffectState;
    },
  ): Promise<UnifiedSyncOperation | undefined>;
  completeOperation(
    key: SyncOperationKey,
    scope: string,
    expectedRevision?: number,
    completion?: { canonical?: any; remoteUpdatedAt?: string },
    expectedAttemptGeneration?: number,
  ): Promise<boolean>;
  deleteOperation(key: SyncOperationKey, scope: string, expectedAttemptGeneration?: number): Promise<boolean>;
}

/**
 * Internal persistence fences used by stale Attempt callbacks.
 * Normal saves may still create an initial Operation; fenced saves must not.
 */
export interface SaveOperationOptions {
  requireExisting?: boolean;
}

export const toUnifiedOperationFromTicket = (
  ticket: OfflineTicketUpdate,
  scope: string,
): UnifiedSyncOperation<TicketUpdateIntent> => ({
  operationId: ticket.operationId ?? `${scope}:ticket:${ticket.ticketId}`,
  kind: "ticket_update",
  key: { kind: "ticket", ticketId: ticket.ticketId },
  connectionScope: scope,
  phase: (ticket.phase ?? "queued") as GenericSyncPhase,
  revision: (ticket as any).intentRevision ?? ticket.revision ?? 1,
  intentRevision: (ticket as any).intentRevision ?? ticket.revision ?? 1,
  version: (ticket as any).version ?? (ticket as any).persistenceVersion ?? ticket.revision ?? 1,
  persistenceVersion: (ticket as any).persistenceVersion ?? (ticket as any).version ?? ticket.revision ?? 1,
  attemptGeneration: getAttemptGeneration(ticket),
  ticketId: ticket.ticketId,
  projectId: (ticket as any).projectId ?? (ticket as any).metadata?.project_id,
  documentUri: ticket.documentUri,
  createdChildIds: ticket.createdChildIds,
  effects: ticket.effects,
  intent: {
    ticketId: ticket.ticketId,
    baseSubject: ticket.baseSubject,
    baseDescription: ticket.baseDescription,
    baseMetadata: ticket.baseMetadata,
    subject: ticket.subject ?? (ticket as any).baseSubject ?? "",
    description: ticket.description ?? (ticket as any).baseDescription ?? "",
    metadata: ticket.metadata ?? ticket.baseMetadata,
    content: ticket.content,
    attachments: (ticket as any).attachments,
    uploadTokens: (ticket as any).uploadTokens,
    childTickets: (ticket as any).childTickets,
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
    content: ticket.nextIntent.content,
    metadata: ticket.nextIntent.metadata,
    revision: ticket.nextIntent.revision,
    layout: ticket.nextIntent.layout ?? ticket.layout,
    metadataBlock: ticket.nextIntent.metadataBlock ?? ticket.metadataBlock,
    controlFields: ticket.nextIntent.controlFields ?? ticket.controlFields,
    baseDir: ticket.nextIntent.baseDir ?? ticket.baseDir,
    documentUri: ticket.nextIntent.documentUri ?? ticket.documentUri,
  } : undefined,
  remoteUpdatedAt: ticket.lastKnownRemoteUpdatedAt,
  createdAt: ticket.createdAt ?? Date.now(),
  updatedAt: ticket.createdAt ?? Date.now(),
});

export const toUnifiedOperationFromNewTicket = (
  ticket: OfflineNewTicket,
  scope: string,
): UnifiedSyncOperation<TicketCreateIntent> => {
  let parsed: TicketEditorContent | undefined;
  if (ticket.content) {
    try {
      parsed = parseTicketEditorContent(ticket.content, {
        allowMissingMetadata: true,
        allowMissingSubject: true,
        fallbackMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
      });
    } catch {
      parsed = {
        subject: (ticket as any).subject ?? "",
        description: ticket.content,
        metadata: (ticket as any).metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
      };
    }
  }

  let nextParsed: TicketEditorContent | undefined;
  if (ticket.nextIntent?.content) {
    try {
      nextParsed = parseTicketEditorContent(ticket.nextIntent.content, {
        allowMissingMetadata: true,
        allowMissingSubject: true,
        fallbackMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
      });
    } catch {
      nextParsed = {
        subject: (ticket.nextIntent as any).subject ?? "",
        description: ticket.nextIntent.content,
        metadata: (ticket.nextIntent as any).metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
      };
    }
  }

  const rawPhase = ticket.phase ?? "queued";
  const phase: GenericSyncPhase =
    rawPhase === "remote_created" ||
    (rawPhase === "local_finalize_pending" && ticket.createdIssueId !== undefined && !(ticket as any).canonical?.ticket)
      ? "remote_committed"
      : (rawPhase as GenericSyncPhase);

  return {
    operationId: ticket.operationId ?? ticket.queueId ?? `${scope}:newTicket:${ticket.documentUri ?? ticket.projectId ?? "0"}`,
    kind: "ticket_create",
    key: { kind: "newTicket", queueId: ticket.queueId, documentUri: ticket.documentUri },
    connectionScope: scope,
    phase,
    revision: (ticket as any).intentRevision ?? (ticket.revision !== undefined && ticket.revision > 0 ? ticket.revision : 1),
    intentRevision: (ticket as any).intentRevision ?? (ticket.revision !== undefined && ticket.revision > 0 ? ticket.revision : 1),
    version: (ticket as any).version ?? (ticket as any).persistenceVersion ?? ticket.revision ?? 1,
    persistenceVersion: (ticket as any).persistenceVersion ?? (ticket as any).version ?? ticket.revision ?? 1,
    attemptGeneration: getAttemptGeneration(ticket),
    projectId: ticket.projectId,
    documentUri: ticket.documentUri,
    createdRemoteId: ticket.createdIssueId,
    effects: ticket.effects,
    intent: {
      projectId: ticket.projectId ?? 0,
      content: ticket.content ?? "",
      baseDir: ticket.baseDir,
      documentUri: ticket.documentUri,
      subject: parsed?.subject ?? (ticket as any).subject ?? "",
      description: parsed?.description ?? ticket.content ?? "",
      metadata: parsed?.metadata ?? (ticket as any).metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
      attachments: (ticket as any).attachments,
      uploadTokens: (ticket as any).uploadTokens,
      childTickets: (ticket as any).childTickets,
      layout: parsed?.layout ?? (ticket as any).layout,
      metadataBlock: parsed?.metadataBlock ?? (ticket as any).metadataBlock,
      controlFields: parsed?.controlFields ?? (ticket as any).controlFields,
    },
    nextIntent: ticket.nextIntent ? {
      projectId: ticket.nextIntent.projectId ?? ticket.projectId ?? 0,
      content: ticket.nextIntent.content,
      revision: ticket.nextIntent.revision,
      baseDir: ticket.nextIntent.baseDir ?? ticket.baseDir,
      documentUri: ticket.nextIntent.documentUri ?? ticket.documentUri,
      subject: nextParsed?.subject ?? (ticket.nextIntent as any).subject ?? "",
      description: nextParsed?.description ?? ticket.nextIntent.content ?? "",
      metadata: nextParsed?.metadata ?? (ticket.nextIntent as any).metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
      layout: nextParsed?.layout ?? (ticket.nextIntent as any).layout,
      metadataBlock: nextParsed?.metadataBlock ?? (ticket.nextIntent as any).metadataBlock,
      controlFields: nextParsed?.controlFields ?? (ticket.nextIntent as any).controlFields,
    } : undefined,
    createdAt: ticket.createdAt ?? Date.now(),
    updatedAt: ticket.createdAt ?? Date.now(),
  };
};

export const toUnifiedOperationFromComment = (
  comment: OfflineCommentUpdate,
  scope: string,
): UnifiedSyncOperation<CommentCreateIntent | CommentUpdateIntent> => ({
  operationId: comment.operationId ?? `${scope}:comment:${comment.ticketId}:${comment.commentId ?? comment.documentUri}`,
  kind: comment.commentId !== undefined ? "comment_update" : "comment_create",
  key: { kind: "comment", ticketId: comment.ticketId, commentId: comment.commentId, documentUri: comment.documentUri },
  connectionScope: scope,
  phase: (comment.phase ?? "queued") as GenericSyncPhase,
  revision: (comment as any).intentRevision ?? comment.revision ?? 1,
  intentRevision: (comment as any).intentRevision ?? comment.revision ?? 1,
  version: (comment as any).version ?? (comment as any).persistenceVersion ?? comment.revision ?? 1,
  persistenceVersion: (comment as any).persistenceVersion ?? (comment as any).version ?? comment.revision ?? 1,
  attemptGeneration: getAttemptGeneration(comment),
  ticketId: comment.ticketId,
  commentId: comment.commentId,
  documentUri: comment.documentUri,
  createdRemoteId: undefined,
  projectId: comment.remoteProjectId,
  effects: comment.effects,
  intent: (comment.commentId !== undefined ? {
    ticketId: comment.ticketId,
    commentId: comment.commentId,
    baseBody: comment.baseBody,
    body: comment.body ?? "",
    baseDir: comment.baseDir,
    documentUri: comment.documentUri,
    sourceNotesHash: comment.sourceNotesHash,
    finalizeDraft: comment.finalizeDraft,
    lastKnownRemoteUpdatedAt: comment.lastKnownRemoteUpdatedAt,
  } : {
    ticketId: comment.ticketId,
    body: comment.body ?? "",
    baseDir: comment.baseDir,
    documentUri: comment.documentUri,
    sourceNotesHash: comment.sourceNotesHash,
    finalizeDraft: comment.finalizeDraft,
  }) as any,
  nextIntent: comment.nextIntent ? (comment.commentId !== undefined ? {
    ticketId: comment.ticketId,
    commentId: comment.commentId,
    baseBody: comment.baseBody,
    body: comment.nextIntent.body,
    baseDir: comment.nextIntent.baseDir,
    documentUri: comment.nextIntent.documentUri,
    sourceNotesHash: comment.sourceNotesHash,
    lastKnownRemoteUpdatedAt: comment.lastKnownRemoteUpdatedAt,
  } : {
    ticketId: comment.ticketId,
    body: comment.nextIntent.body,
    baseDir: comment.nextIntent.baseDir,
    documentUri: comment.nextIntent.documentUri,
    sourceNotesHash: comment.sourceNotesHash,
  }) as any : undefined,
  createdAt: comment.createdAt ?? Date.now(),
  updatedAt: comment.createdAt ?? Date.now(),
});

const getOperationFromQueue = (
  queue: ReturnType<typeof getOfflineSyncQueue>,
  key: SyncOperationKey,
  scope: string,
): UnifiedSyncOperation | undefined => {
  if (key.kind === "ticket") {
    const ticket = queue.tickets.get(key.ticketId);
    return ticket ? toUnifiedOperationFromTicket(ticket, scope) : undefined;
  }
  if (key.kind === "newTicket") {
    const ticket = key.documentUri
      ? queue.newTickets.find((candidate) =>
        candidate.documentUri !== undefined &&
        sameDocumentIdentity(candidate.documentUri, key.documentUri))
      : key.queueId !== undefined
        ? queue.newTickets.find((candidate) =>
          candidate.queueId === key.queueId ||
          candidate.operationId === key.queueId ||
          Boolean(candidate.operationId?.endsWith(`:${key.queueId}`)))
        : queue.newTickets[0];
    return ticket ? toUnifiedOperationFromNewTicket(ticket, scope) : undefined;
  }
  const comment = queue.comments.find((candidate) =>
    (key.documentUri !== undefined && candidate.documentUri === key.documentUri) ||
    (candidate.ticketId === key.ticketId &&
      ((key.commentId !== undefined && candidate.commentId === key.commentId) ||
        (key.commentId === undefined && candidate.commentId === undefined))),
  );
  return comment ? toUnifiedOperationFromComment(comment, scope) : undefined;
};

export class DefaultSyncOperationRepository implements SyncOperationRepository {
  private readonly mutexByScope = new Map<string, Promise<any>>();

  public getOperation<I extends SyncIntent = SyncIntent>(key: SyncOperationKey, scope: string): UnifiedSyncOperation<I> | undefined {
    const queue = getOfflineSyncQueue(scope);
    const operation = getOperationFromQueue(queue, key, scope);
    if (operation) {
      return operation as UnifiedSyncOperation<I>;
    }
    const cacheKey = `${scope}:${getOpKeyString(key)}`;
    return this.completedOperations.get(cacheKey) as UnifiedSyncOperation<I> | undefined;
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

  private static lockStorage = new AsyncLocalStorage<Set<string>>();
  private completedOperations = new Map<string, UnifiedSyncOperation>();

  private runExclusive<T>(
    scope: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const activeScopes = DefaultSyncOperationRepository.lockStorage.getStore();
    if (activeScopes && activeScopes.has(scope)) {
      return fn();
    }
    const prev = this.mutexByScope.get(scope) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => {
      const nextScopes = new Set(activeScopes ?? []);
      nextScopes.add(scope);
      return DefaultSyncOperationRepository.lockStorage.run(nextScopes, fn);
    });
    this.mutexByScope.set(scope, next.catch(() => undefined) as Promise<unknown>);
    return next;
  }

  private async saveOperationInternal(
    operation: UnifiedSyncOperation,
    scope: string,
    expectedPersistenceVersion?: number,
    allowAttemptGenerationAdvance = false,
    options?: SaveOperationOptions,
  ): Promise<UnifiedSyncOperation | undefined> {
    try {
      return await mutateOfflineSyncQueueAsync(scope, (nextQueue) => {
    const key = getOperationKey(operation);
    const current = getOperationFromQueue(nextQueue, key, scope);

    if (options?.requireExisting && !current) {
      return undefined;
    }

    // CAS チェック (INV-06)
    if (expectedPersistenceVersion !== undefined && current) {
      const currentVersion = current.version ?? current.persistenceVersion ?? 1;
      if (currentVersion !== expectedPersistenceVersion) {
        return undefined; // バージョン不一致で競合防止
      }
    }

    const nextVersion = operation.version !== undefined && operation.version > (current?.version ?? 0)
      ? operation.version
      : (current?.version ?? current?.persistenceVersion ?? 0) + 1;
    const intentRevision = operation.intentRevision ?? operation.revision ?? current?.intentRevision ?? current?.revision ?? 1;
    const attemptGeneration = getAttemptGeneration(operation);
    if (
      current &&
      operation.attemptGeneration !== undefined &&
      normalizeAttemptGeneration(operation.attemptGeneration) !==
        getAttemptGeneration(current)
    ) {
      if (
        !allowAttemptGenerationAdvance ||
        normalizeAttemptGeneration(operation.attemptGeneration) !== getAttemptGeneration(current) + 1
      ) {
        return undefined;
      }
    }
    const updated: UnifiedSyncOperation = {
      ...operation,
      attemptGeneration,
      intentRevision,
      version: nextVersion,
      persistenceVersion: nextVersion,
      updatedAt: Date.now(),
    };

    if (operation.kind === "ticket_update" && operation.ticketId !== undefined) {
      const intent = operation.intent as TicketUpdateIntent | undefined;
      const nextIntent = operation.nextIntent as TicketUpdateIntent | undefined;
      const payload: OfflineTicketUpdate = {
        ticketId: operation.ticketId,
        operationId: operation.operationId,
        phase: operation.phase as any,
        revision: intentRevision,
        attemptGeneration,
        intentRevision,
        version: nextVersion,
        persistenceVersion: nextVersion,
        projectId: operation.projectId ?? (intent?.metadata as any)?.project_id,
        content: intent?.content ?? intent?.description,
        baseSubject: intent?.baseSubject ?? nextQueue.tickets.get(operation.ticketId)?.baseSubject ?? "",
        baseDescription: intent?.baseDescription ?? nextQueue.tickets.get(operation.ticketId)?.baseDescription ?? "",
        subject: intent?.subject,
        description: intent?.description,
        createdChildIds: operation.createdChildIds,
        effects: operation.effects ?? nextQueue.tickets.get(operation.ticketId)?.effects,
        metadata: intent?.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
        baseMetadata: intent?.baseMetadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
        layout: intent?.layout,
        metadataBlock: intent?.metadataBlock,
        controlFields: intent?.controlFields,
        baseDir: intent?.baseDir,
        documentUri: intent?.documentUri ?? operation.documentUri,
        lastKnownRemoteUpdatedAt: intent?.lastKnownRemoteUpdatedAt ?? operation.remoteUpdatedAt,
        nextIntent: nextIntent ? {
          revision: nextIntent.revision ?? (intentRevision + 1),
          subject: nextIntent.subject,
          description: nextIntent.description,
          content: nextIntent.content ?? nextIntent.description,
          metadata: nextIntent.metadata,
          layout: nextIntent.layout,
          metadataBlock: nextIntent.metadataBlock,
          controlFields: nextIntent.controlFields,
          baseDir: nextIntent.baseDir,
          documentUri: nextIntent.documentUri,
        } : undefined,
      } as any;
      nextQueue.tickets.set(operation.ticketId, payload);
    } else if (operation.kind === "ticket_create") {
      const intentObj = operation.intent as TicketCreateIntent | undefined;
      const content = intentObj?.content
        ? intentObj.content
        : ((intentObj?.subject !== undefined || intentObj?.metadata !== undefined)
            ? buildTicketEditorContent({
                subject: intentObj?.subject ?? "",
                description: intentObj?.description ?? "",
                metadata: intentObj?.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
                layout: intentObj?.layout,
                metadataBlock: intentObj?.metadataBlock,
                controlFields: intentObj?.controlFields,
              })
            : "");

      const nextIntentObj = operation.nextIntent as TicketCreateIntent | undefined;
      const nextContent = nextIntentObj
        ? (nextIntentObj.content
            ? nextIntentObj.content
            : ((nextIntentObj.subject !== undefined || nextIntentObj.metadata !== undefined)
                ? buildTicketEditorContent({
                    subject: nextIntentObj.subject ?? "",
                    description: nextIntentObj.description ?? "",
                    metadata: nextIntentObj.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
                    layout: nextIntentObj.layout,
                    metadataBlock: nextIntentObj.metadataBlock,
                    controlFields: nextIntentObj.controlFields,
                  })
                : undefined))
        : undefined;

      const payload: OfflineNewTicket = {
        queueId: (operation.key?.kind === "newTicket" ? operation.key.queueId : undefined) ?? operation.operationId,
        operationId: operation.operationId,
        phase: operation.phase as any,
        revision: intentRevision,
        attemptGeneration,
        intentRevision,
        version: nextVersion,
        persistenceVersion: nextVersion,
        projectId: operation.projectId ?? intentObj?.projectId,
        content,
        documentUri: operation.documentUri ?? intentObj?.documentUri,
        baseDir: intentObj?.baseDir,
        createdIssueId: operation.createdRemoteId,
        createdChildIds: operation.createdChildIds,
        effects: operation.effects ?? nextQueue.newTickets.find((t) => (operation.operationId && t.operationId === operation.operationId) || (operation.key?.kind === "newTicket" && operation.key.queueId !== undefined && t.queueId === operation.key.queueId) || (operation.documentUri && t.documentUri && sameDocumentIdentity(t.documentUri, operation.documentUri)))?.effects,
        attachments: intentObj?.attachments,
        uploadTokens: intentObj?.uploadTokens,
        childTickets: intentObj?.childTickets,
        nextIntent: nextIntentObj ? {
          content: nextContent ?? nextIntentObj.content ?? "",
          projectId: nextIntentObj.projectId ?? operation.projectId ?? intentObj?.projectId,
          documentUri: nextIntentObj.documentUri ?? operation.documentUri,
          baseDir: nextIntentObj.baseDir ?? intentObj?.baseDir,
          revision: nextIntentObj.revision ?? (intentRevision + 1),
        } : undefined,
      } as any;
      const idx = nextQueue.newTickets.findIndex((t) =>
        (payload.operationId && t.operationId && t.operationId === payload.operationId) ||
        (payload.queueId !== undefined && t.queueId === payload.queueId) ||
        (payload.documentUri !== undefined && t.documentUri !== undefined && sameDocumentIdentity(t.documentUri, payload.documentUri)) ||
        (payload.queueId === undefined && payload.documentUri === undefined && t.queueId === undefined && t.documentUri === undefined),
      );
      if (idx !== -1) {
        nextQueue.newTickets[idx] = payload;
      } else {
        nextQueue.newTickets.push(payload);
      }
    } else if (operation.kind === "comment_create" || operation.kind === "comment_update") {
      const intentObj = operation.intent as (CommentCreateIntent | CommentUpdateIntent) | undefined;
      const nextIntentObj = operation.nextIntent as (CommentCreateIntent | CommentUpdateIntent) | undefined;
      const payload: OfflineCommentUpdate = {
        commentId: operation.commentId ?? (intentObj as CommentUpdateIntent | undefined)?.commentId,
        ticketId: operation.ticketId ?? (operation.key?.kind === "comment" ? operation.key.ticketId : 0) ?? intentObj?.ticketId ?? 0,
        operationId: operation.operationId,
        phase: operation.phase as any,
        revision: intentRevision,
        attemptGeneration,
        intentRevision,
        version: nextVersion,
        persistenceVersion: nextVersion,
        body: intentObj?.body ?? "",
        baseBody: (intentObj as CommentUpdateIntent | undefined)?.baseBody,
        baseDir: intentObj?.baseDir,
        documentUri: operation.documentUri ?? intentObj?.documentUri,
        createdRemoteId: operation.createdRemoteId,
        finalizeDraft: (intentObj as any)?.finalizeDraft ?? (operation as any).finalizeDraft,
        sourceNotesHash: (intentObj as any)?.sourceNotesHash ?? (operation as any).sourceNotesHash,
        lastKnownRemoteUpdatedAt: (intentObj as any)?.lastKnownRemoteUpdatedAt ?? operation.remoteUpdatedAt,
        effects: operation.effects ?? nextQueue.comments.find((c) => (operation.operationId && c.operationId === operation.operationId) || (operation.documentUri && c.documentUri === operation.documentUri) || (c.ticketId === operation.ticketId && c.commentId === operation.commentId))?.effects,
        nextIntent: nextIntentObj ? {
          body: nextIntentObj.body,
          revision: (nextIntentObj as any)?.revision ?? (intentRevision + 1),
          documentUri: nextIntentObj.documentUri ?? operation.documentUri,
          baseDir: nextIntentObj.baseDir ?? intentObj?.baseDir,
        } : undefined,
      } as any;
      const idx = nextQueue.comments.findIndex((c) =>
        (payload.operationId && c.operationId && c.operationId === payload.operationId) ||
        (payload.documentUri !== undefined && c.documentUri !== undefined && sameDocumentIdentity(c.documentUri, payload.documentUri)) ||
        (c.ticketId === payload.ticketId &&
          ((payload.commentId !== undefined && c.commentId === payload.commentId) ||
            (payload.commentId === undefined && c.commentId === undefined))),
      );
      if (idx !== -1) {
        nextQueue.comments[idx] = payload;
      } else {
        nextQueue.comments.push(payload);
      }
    }

      return updated;
      });
    } catch {
      return undefined;
    }
  }

  public async saveOperation(
    operation: UnifiedSyncOperation,
    scope: string,
    expectedPersistenceVersion?: number,
    options?: SaveOperationOptions,
  ): Promise<UnifiedSyncOperation | undefined> {
    return this.runExclusive(scope, () => this.saveOperationInternal(operation, scope, expectedPersistenceVersion, false, options));
  }

  public async transitionOperation(
    key: SyncOperationKey,
    action: GenericLifecycleAction,
    scope: string,
    expected?: LifecycleExpectation,
  ): Promise<UnifiedSyncOperation | undefined> {
    return this.runExclusive(scope, async () => {
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
        if (
          expected.attemptGeneration !== undefined &&
          getAttemptGeneration(current) !== normalizeAttemptGeneration(expected.attemptGeneration)
        ) {
          return undefined;
        }
      }

      const next = applyGenericTransition(current, action);
      if (!next) {
        return undefined;
      }

      return this.saveOperationInternal(next, scope, current.version ?? current.persistenceVersion);
    });
  }

  public async transitionPrimaryRemoteWrite(
    key: SyncOperationKey,
    transition: PrimaryRemoteTransition,
    scope: string,
    expected?: LifecycleExpectation,
  ): Promise<UnifiedSyncOperation | undefined> {
    return this.runExclusive(scope, async () => {
      const current = this.getOperation(key, scope);
      if (!current) {
        return undefined;
      }

      if (expected) {
        if (expected.operationId && current.operationId !== expected.operationId) {
          return undefined;
        }
        if (expected.sourcePhase && current.phase !== expected.sourcePhase) {
          const isStartedMatch =
            (expected.sourcePhase === "queued" || expected.sourcePhase === "preparing") &&
            (current.phase === "queued" || current.phase === "preparing" || current.phase === "remote_write_started");
          const isRetryMatch =
            (expected.sourcePhase === "commit_unknown" || expected.sourcePhase === "queued") &&
            (current.phase === "commit_unknown" || current.phase === "queued" || current.phase === "remote_write_started");
          if (!isStartedMatch && !isRetryMatch) {
            return undefined;
          }
        }
        if (expected.revision !== undefined) {
          const currentRev = current.revision;
          if (currentRev !== expected.revision) {
            return undefined;
          }
        }
        if (
          expected.attemptGeneration !== undefined &&
          getAttemptGeneration(current) !== normalizeAttemptGeneration(expected.attemptGeneration)
        ) {
          return undefined;
        }
      }

      const currentRevision = current.revision ?? current.intentRevision ?? 1;
      const currentAttemptGeneration = getAttemptGeneration(current);
      const pId = current.kind === "ticket_create"
        ? "ticket-create"
        : current.kind === "ticket_update"
          ? "ticket-update"
          : current.kind === "comment_create"
            ? "comment-create"
            : "comment-update";
      const pKind = current.kind === "ticket_create"
        ? "ticket_create"
        : current.kind === "ticket_update"
          ? "ticket_update"
          : current.kind === "comment_create"
            ? "comment_create"
            : "comment_update";

      let opAction: GenericLifecycleAction;
      let effectAction: DurableSyncEffectAction;

      switch (transition.kind) {
        case "start":
          opAction = { kind: "start_normal_remote_write" };
          effectAction = { kind: "start", requestSnapshot: transition.requestSnapshot };
          break;
        case "start_explicit_retry":
          opAction = { kind: "start_explicit_retry_remote_write" };
          effectAction = { kind: "start_explicit_retry", requestSnapshot: transition.requestSnapshot };
          break;
        case "commit":
          opAction = {
            kind: "record_remote_commit",
            createdRemoteId: transition.remoteId,
            projectId: transition.projectId,
            remoteUpdatedAt: transition.remoteUpdatedAt,
          };
          effectAction = {
            kind: "commit",
            remoteId: transition.remoteId,
            requestSnapshot: transition.requestSnapshot,
          };
          break;
        case "commit_unknown":
          opAction = { kind: "mark_commit_unknown", message: transition.detail };
          effectAction = { kind: "mark_commit_unknown", detail: transition.detail };
          break;
        case "failed":
          opAction = { kind: "abort_known_remote_failure" };
          effectAction = {
            kind: "mark_failed",
            detail: transition.failure.detail,
            disposition: transition.failure.disposition,
            category: transition.failure.category,
          };
          break;
      }

      const currentEffects = [...(current.effects ?? [])];
      const pIndex = currentEffects.findIndex(
        (e) =>
          (e.effectId === pId || isPrimaryEffectKind(e.kind)) &&
          (e.operationRevision ?? currentRevision) === currentRevision &&
          normalizeAttemptGeneration(e.attemptGeneration) === currentAttemptGeneration,
      );

      let updatedEffect: DurableSyncEffect | undefined;
      if (pIndex === -1) {
        if (transition.kind === "start" || transition.kind === "start_explicit_retry") {
          const initialEffect: DurableSyncEffect = {
            effectId: pId,
            kind: pKind,
            operationRevision: currentRevision,
            attemptGeneration: currentAttemptGeneration,
            state: "planned",
            target: { documentUri: current.documentUri, ticketId: current.ticketId, commentId: current.commentId },
            requestSnapshot: transition.requestSnapshot,
          };
          updatedEffect = transitionDurableSyncEffect(initialEffect, effectAction, {
            operationRevision: currentRevision,
            attemptGeneration: currentAttemptGeneration,
            sourceState: "planned",
          });
          if (updatedEffect) {
            currentEffects.push(updatedEffect);
          }
        } else if (transition.kind === "commit") {
          const initialEffect: DurableSyncEffect = {
            effectId: pId,
            kind: pKind,
            operationRevision: currentRevision,
            attemptGeneration: currentAttemptGeneration,
            state: "started",
            target: { documentUri: current.documentUri, ticketId: current.ticketId, commentId: current.commentId },
            requestSnapshot: transition.requestSnapshot,
          };
          updatedEffect = transitionDurableSyncEffect(initialEffect, effectAction, {
            operationRevision: currentRevision,
            attemptGeneration: currentAttemptGeneration,
            sourceState: "started",
          });
          if (updatedEffect) {
            currentEffects.push(updatedEffect);
          }
        } else if (transition.kind === "failed" || transition.kind === "commit_unknown") {
          const initialEffect: DurableSyncEffect = {
            effectId: pId,
            kind: pKind,
            operationRevision: currentRevision,
            attemptGeneration: currentAttemptGeneration,
            state: "started",
            target: { documentUri: current.documentUri, ticketId: current.ticketId, commentId: current.commentId },
          };
          updatedEffect = transitionDurableSyncEffect(initialEffect, effectAction, {
            operationRevision: currentRevision,
            attemptGeneration: currentAttemptGeneration,
            sourceState: "started",
          });
          if (updatedEffect) {
            currentEffects.push(updatedEffect);
          }
        }
      } else {
        const existing = currentEffects[pIndex];
          updatedEffect = transitionDurableSyncEffect(existing, effectAction, {
            operationRevision: currentRevision,
            attemptGeneration: currentAttemptGeneration,
            sourceState: existing.state,
        });
        if (updatedEffect) {
          currentEffects[pIndex] = updatedEffect;
        }
      }

      if (!updatedEffect) {
        return undefined;
      }

      let nextOp: UnifiedSyncOperation | undefined;
      if (current.phase === "remote_write_started" && (transition.kind === "start" || transition.kind === "start_explicit_retry")) {
        nextOp = { ...current };
        nextOp.version = (current.version ?? current.persistenceVersion ?? 0) + 1;
        nextOp.persistenceVersion = nextOp.version;
        nextOp.updatedAt = new Date().toISOString();
      } else if (current.phase === "remote_committed" && transition.kind === "commit") {
        nextOp = { ...current };
        nextOp.version = (current.version ?? current.persistenceVersion ?? 0) + 1;
        nextOp.persistenceVersion = nextOp.version;
        nextOp.updatedAt = new Date().toISOString();
      } else {
        nextOp = applyGenericTransition(current, opAction);
      }
      if (!nextOp) {
        return undefined;
      }

      nextOp.effects = (transition.kind === "failed" || transition.kind === "commit_unknown")
        ? retainDurableEffectsForRetry(currentEffects)
        : currentEffects;
      if (transition.kind === "commit" && transition.remoteId !== undefined) {
        nextOp.createdRemoteId = transition.remoteId;
      }

      return this.saveOperationInternal(nextOp, scope, current.version ?? current.persistenceVersion);
    });
  }

  public async planEffect(
    key: SyncOperationKey,
    effect: DurableSyncEffect,
    scope: string,
    expectedRevision?: number,
    options?: SaveOperationOptions,
  ): Promise<UnifiedSyncOperation | undefined> {
    return this.runExclusive(scope, async () => {
      let current = this.getOperation(key, scope);
      if (!current) {
        if (options?.requireExisting) {
          return undefined;
        }
        if (key.kind === "ticket") {
          await addOfflineTicketUpdateAsync(key.ticketId, {
            ticketId: key.ticketId,
            phase: "queued",
            revision: expectedRevision ?? 1,
            baseSubject: "",
            baseDescription: "",
            baseMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
            subject: "",
            description: "",
            metadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
          }, scope);
        } else if (key.kind === "newTicket") {
          await addOfflineNewTicketAsync({
            queueId: key.queueId,
            documentUri: key.documentUri,
            phase: "queued",
            revision: expectedRevision ?? 1,
            content: "",
          }, scope);
        } else if (key.kind === "comment") {
          await addOfflineCommentUpdateAsync({
            ticketId: key.ticketId,
            commentId: key.commentId,
            documentUri: key.documentUri,
            phase: "queued",
            revision: expectedRevision ?? 1,
            body: "",
          }, scope);
        }
        current = this.getOperation(key, scope);
      }
      if (!current) {
        return undefined;
      }
      const currentRevision = current.intentRevision ?? current.revision ?? 1;
      if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
        return undefined;
      }
      const revision = currentRevision;
      const attemptGeneration = getAttemptGeneration(current);
      if (
        effect.attemptGeneration !== undefined &&
        normalizeAttemptGeneration(effect.attemptGeneration) !== attemptGeneration
      ) {
        return undefined;
      }

      const effects = [...(current.effects ?? [])];
      const existingIndex = effects.findIndex(
        (e) =>
          e.effectId === effect.effectId &&
          (e.operationRevision ?? currentRevision) === currentRevision &&
          normalizeAttemptGeneration(e.attemptGeneration) === attemptGeneration,
      );
      if (existingIndex !== -1) {
        const existing = effects[existingIndex];
        if (existing.state !== "planned" && existing.state !== "compensated") {
          // D-03: committed/started/failed/commit_unknown など non-planned な既存 Effect は planned に巻き戻さない
          if (
            effect.requestSnapshot &&
            existing.requestSnapshot &&
            !areSnapshotsEqual(effect.requestSnapshot, existing.requestSnapshot)
          ) {
            // same revision / different snapshot の場合は拒絶
            return undefined;
          }
          // 既存の証拠・ステートを保持
          effects[existingIndex] = {
            ...existing,
            operationRevision: revision,
            attemptGeneration,
          };
        } else {
          // planned 状態 (R-10.1):
          if (
            effect.requestSnapshot &&
            existing.requestSnapshot &&
            !areSnapshotsEqual(effect.requestSnapshot, existing.requestSnapshot)
          ) {
            // same revision / different snapshot は拒絶
            return undefined;
          }
          effects[existingIndex] = {
            ...effect,
            operationRevision: revision,
            attemptGeneration,
            state: "planned",
          };
        }
      } else {
        effects.push({
          ...effect,
          operationRevision: revision,
          attemptGeneration,
          state: "planned",
        });
      }

      const updated: UnifiedSyncOperation = {
        ...current,
        effects,
      };
      try {
        return await this.saveOperationInternal(
          updated,
          scope,
          current.version ?? current.persistenceVersion,
        );
      } catch {
        return undefined;
      }
    });
  }

  public async transitionEffect(
    key: SyncOperationKey,
    effectId: string,
    action: DurableSyncEffectAction,
    scope: string,
    expected?: {
      operationRevision?: number;
      attemptGeneration?: number;
      sourceState: DurableSyncEffectState;
    },
  ): Promise<UnifiedSyncOperation | undefined> {
    return this.runExclusive(scope, async () => {
      const current = this.getOperation(key, scope);
      if (!current) {
        return undefined;
      }

      const currentRevision = current.intentRevision ?? current.revision ?? 1;
      const currentAttemptGeneration = getAttemptGeneration(current);
      const targetRevision = expected?.operationRevision ?? currentRevision;
      const targetAttemptGeneration = normalizeAttemptGeneration(
        expected?.attemptGeneration ?? currentAttemptGeneration,
      );
      if (targetAttemptGeneration !== currentAttemptGeneration) {
        return undefined;
      }
      const effects = [...(current.effects ?? [])];
      const existingIndex = effects.findIndex(
        (e) =>
          e.effectId === effectId &&
          (e.operationRevision ?? targetRevision) === targetRevision &&
          normalizeAttemptGeneration(e.attemptGeneration) === targetAttemptGeneration,
      );

      let effect: DurableSyncEffect | undefined = existingIndex !== -1 ? effects[existingIndex] : undefined;
      if (!effect) {
        if (action.kind === "start" || action.kind === "start_explicit_retry") {
          effect = {
            effectId,
            kind: effectId.includes("comment") ? (effectId.includes("update") ? "comment_update" : "comment_create") : (effectId.includes("update") ? "ticket_update" : "ticket_create"),
            operationRevision: currentRevision,
            attemptGeneration: currentAttemptGeneration,
            state: "planned",
            target: { documentUri: current.documentUri, ticketId: current.ticketId, commentId: current.commentId },
            requestSnapshot: (action as any).requestSnapshot,
          };
        } else {
          return undefined;
        }
      }

      if (expected?.sourceState !== undefined && effect.state !== expected.sourceState) {
        return undefined;
      }

      if (expected?.operationRevision !== undefined) {
        if (expected.operationRevision !== currentRevision) {
          return undefined;
        }
        if (effect.operationRevision !== undefined && effect.operationRevision !== expected.operationRevision) {
          return undefined;
        }
      }
      if (normalizeAttemptGeneration(effect.attemptGeneration) !== targetAttemptGeneration) {
        return undefined;
      }

      const isPrimaryClosureRetry =
        action.kind === "complete_compensation" &&
        expected?.sourceState === "compensated" &&
        effect.state === "compensated" &&
        (isPrimaryEffectKind(effect.kind) ||
          effect.effectId === "ticket-create" ||
          effect.effectId === "ticket-update" ||
          effect.effectId === "comment-create" ||
          effect.effectId === "comment-update");
      const nextEffect = isPrimaryClosureRetry
        ? effect
        : transitionDurableSyncEffect(effect, action, {
          operationRevision: targetRevision,
          attemptGeneration: targetAttemptGeneration,
          sourceState: expected?.sourceState ?? effect.state,
        });
      if (!nextEffect) {
        return undefined;
      }

      if (existingIndex !== -1) {
        effects[existingIndex] = nextEffect;
      } else {
        effects.push(nextEffect);
      }

      const closureDecision = evaluateAttemptClosure(
        { ...current, effects },
        currentRevision,
        currentAttemptGeneration,
      );
      if (isPrimaryClosureRetry && !closureDecision.closable) {
        return undefined;
      }
      const closesAttempt = closureDecision.closable;
      const nextAttemptGeneration = closesAttempt
        ? currentAttemptGeneration + 1
        : currentAttemptGeneration;
      const activeEffects = closesAttempt
        ? effects.filter((candidate) =>
          normalizeAttemptGeneration(candidate.attemptGeneration) > currentAttemptGeneration
        )
        : effects;
        const updated: UnifiedSyncOperation = {
          ...current,
          attemptGeneration: nextAttemptGeneration,
          phase: closesAttempt ? "queued" : current.phase,
        effects: activeEffects,
        createdRemoteId:
          nextEffect.kind === "ticket_create" && nextEffect.state === "committed" && nextEffect.remoteId !== undefined
            ? nextEffect.remoteId
            : closesAttempt
              ? undefined  // compensation完了時にatomicにcreatedRemoteIdを消去
              : current.createdRemoteId,
        createdChildIds: closesAttempt ? undefined : current.createdChildIds,
        errorMessage: closesAttempt ? undefined : current.errorMessage,
        remoteUpdatedAt: closesAttempt ? undefined : current.remoteUpdatedAt,
      };
      if (closesAttempt && current.nextIntent) {
        updated.intent = current.nextIntent;
        updated.nextIntent = undefined;
        updated.intentRevision = (current.nextIntent as { revision?: number }).revision ?? currentRevision + 1;
        updated.revision = updated.intentRevision;
        updated.projectId = (current.nextIntent as { projectId?: number }).projectId ?? current.projectId;
        updated.documentUri = (current.nextIntent as { documentUri?: string }).documentUri ?? current.documentUri;
      }
      try {
        return await this.saveOperationInternal(
          updated,
          scope,
          current.version ?? current.persistenceVersion,
          closesAttempt,
        );
      } catch {
        return undefined;
      }
    });
  }

  public async completeOperation(
    key: SyncOperationKey,
    scope: string,
    expectedRevision?: number,
    completion?: { canonical?: any; remoteUpdatedAt?: string },
    expectedAttemptGeneration?: number,
  ): Promise<boolean> {
    return this.runExclusive(scope, async () => {
      const current = this.getOperation(key, scope);
      const revision = expectedRevision ?? current?.revision ?? 1;

      if (
        current &&
        expectedAttemptGeneration !== undefined &&
        getAttemptGeneration(current) !== normalizeAttemptGeneration(expectedAttemptGeneration)
      ) {
        return false;
      }

      const publishCompletedCache = (): void => {
        if (!current) {
          return;
        }
        const completedOp: UnifiedSyncOperation = {
          ...current,
          phase: "completed",
        };
        const cacheKey = `${scope}:${getOpKeyString(key)}`;
        this.completedOperations.set(cacheKey, completedOp);
        if (key.kind === "newTicket") {
          if (key.queueId) {
            this.completedOperations.set(`${scope}:newTicket:${key.queueId}`, completedOp);
          }
          if (key.documentUri) {
            this.completedOperations.set(`${scope}:newTicket:${key.documentUri}`, completedOp);
          }
          if (current.operationId) {
            this.completedOperations.set(`${scope}:newTicket:${current.operationId}`, completedOp);
          }
        }
      };

      if (key.kind === "ticket") {
        const rawCanonical = completion?.canonical;
        const canonical = rawCanonical
          ? (rawCanonical.ticket
              ? {
                  subject: rawCanonical.ticket.subject,
                  description: rawCanonical.ticket.description,
                  metadata: rawCanonical.ticket.metadata ?? { tracker: rawCanonical.ticket.trackerName ?? "", priority: rawCanonical.ticket.priorityName ?? "", status: rawCanonical.ticket.statusName ?? "", due_date: "", children: [] },
                }
              : rawCanonical)
          : (current ? {
              subject: (current.intent as any)?.baseSubject ?? (current.intent as any)?.subject ?? "",
              description: (current.intent as any)?.baseDescription ?? (current.intent as any)?.description ?? "",
              metadata: (current.intent as any)?.baseMetadata ?? (current.intent as any)?.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
            } : undefined);
        const completed = await completeOfflineTicketUpdateAsync(
          key.ticketId,
          scope,
          canonical ? { canonical, remoteUpdatedAt: completion?.remoteUpdatedAt ?? current?.remoteUpdatedAt ?? new Date().toISOString() } : undefined,
          revision,
        );
        if (completed) {
          publishCompletedCache();
        }
        return completed;
      }
      if (key.kind === "newTicket") {
        let promotion: (OfflineTicketUpdate & { sourceRevision?: number }) | undefined = undefined;
        const createdId = current?.createdRemoteId;
        if (current?.nextIntent && createdId) {
          const next = current.nextIntent as any;
          const nextContent = typeof next.content === "string" ? next.content : (typeof next.description === "string" ? next.description : "");
          let parsedNext: any;
          try {
            parsedNext = parseTicketEditorContent(nextContent, {
              allowMissingMetadata: true,
              fallbackMetadata: next.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
              allowMissingSubject: true,
            });
          } catch {
            parsedNext = next;
          }
          const canonicalSubject = completion?.canonical?.ticket?.subject ?? completion?.canonical?.subject ?? (current as any)?.canonical?.ticket?.subject ?? (current as any)?.canonical?.subject ?? "Canonical subject";
          const canonicalDescription = completion?.canonical?.ticket?.description ?? completion?.canonical?.description ?? (current as any)?.canonical?.ticket?.description ?? (current as any)?.canonical?.description ?? (current.intent as any)?.description ?? "";
          const canonicalMetadata = completion?.canonical?.ticket?.metadata ?? completion?.canonical?.metadata ?? (current as any)?.canonical?.ticket?.metadata ?? (current as any)?.canonical?.metadata ?? (current.intent as any)?.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] };

          promotion = {
            ticketId: createdId,
            baseSubject: canonicalSubject,
            baseDescription: canonicalDescription,
            baseMetadata: canonicalMetadata,
            lastKnownRemoteUpdatedAt: completion?.remoteUpdatedAt ?? current.remoteUpdatedAt ?? new Date().toISOString(),
            subject: parsedNext.subject ?? next.subject ?? "",
            description: parsedNext.description ?? next.description ?? "",
            content: nextContent,
            metadata: parsedNext.metadata ?? next.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
            layout: parsedNext.layout ?? next.layout,
            metadataBlock: parsedNext.metadataBlock ?? next.metadataBlock,
            controlFields: parsedNext.controlFields ?? next.controlFields,
            baseDir: next.baseDir,
            documentUri: next.documentUri ?? current.documentUri,
            operationId: current.operationId,
            connectionScope: scope,
            phase: "queued",
            revision: next.revision ?? (current.revision ?? 0) + 1,
            sourceRevision: next.revision,
          };
        }
        const completed = await completeOfflineNewTicketAsync(
          { queueId: key.queueId, documentUri: key.documentUri },
          scope,
          promotion,
          revision,
        );
        if (completed) {
          publishCompletedCache();
        }
        return completed;
      }
      if (key.kind === "comment") {
        const completed = await completeOfflineCommentAsync(
          { commentId: key.commentId, documentUri: key.documentUri, ticketId: key.ticketId },
          scope,
          revision,
        );
        if (completed) {
          publishCompletedCache();
        }
        return completed;
      }
      publishCompletedCache();
      return true;
    });
  }

  public async deleteOperation(
    key: SyncOperationKey,
    scope: string,
    expectedAttemptGeneration?: number,
  ): Promise<boolean> {
    return this.runExclusive(scope, async () => {
      if (expectedAttemptGeneration !== undefined) {
        const current = this.getOperation(key, scope);
        if (!current || getAttemptGeneration(current) !== normalizeAttemptGeneration(expectedAttemptGeneration)) {
          return false;
        }
      }
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
        await removeOfflineCommentEntryAsync(
          { commentId: key.commentId, documentUri: key.documentUri },
          scope,
        );
        return true;
      }
      return false;
    });
  }
}

/**
 * Handler が保持している operation snapshot の Attempt 世代を、すべての
 * 永続 transition に付与する。Remote write 後に次 Attempt が開始されても、
 * 古い callback は generation mismatch で fail-closed になる。
 */
export class AttemptGenerationFencedRepository implements SyncOperationRepository {
  public constructor(
    private readonly repository: SyncOperationRepository,
    private readonly attemptGeneration: number,
  ) {}

  public getOperation<I extends SyncIntent = SyncIntent>(key: SyncOperationKey, scope: string): UnifiedSyncOperation<I> | undefined {
    return this.repository.getOperation<I>(key, scope);
  }

  public listOperations(scope: string): UnifiedSyncOperation[] {
    return this.repository.listOperations(scope);
  }

  public saveOperation(
    operation: UnifiedSyncOperation,
    scope: string,
    expectedPersistenceVersion?: number,
    options?: SaveOperationOptions,
  ): Promise<UnifiedSyncOperation | undefined> {
    const current = this.repository.getOperation(getOperationKey(operation), scope);
    if (
      !current ||
      current.phase === "completed" ||
      getAttemptGeneration(current) !== this.attemptGeneration ||
      getAttemptGeneration(operation) !== this.attemptGeneration
    ) {
      return Promise.resolve(undefined);
    }
    return this.repository.saveOperation(
      { ...operation, attemptGeneration: this.attemptGeneration },
      scope,
      expectedPersistenceVersion,
      { ...options, requireExisting: true },
    );
  }

  public transitionOperation(
    key: SyncOperationKey,
    action: GenericLifecycleAction,
    scope: string,
    expected?: LifecycleExpectation,
  ): Promise<UnifiedSyncOperation | undefined> {
    return this.repository.transitionOperation(
      key,
      action,
      scope,
      { ...expected, attemptGeneration: this.attemptGeneration } as LifecycleExpectation,
    );
  }

  public transitionPrimaryRemoteWrite(
    key: SyncOperationKey,
    transition: PrimaryRemoteTransition,
    scope: string,
    expected?: LifecycleExpectation,
  ): Promise<UnifiedSyncOperation | undefined> {
    return this.repository.transitionPrimaryRemoteWrite(
      key,
      transition,
      scope,
      { ...expected, attemptGeneration: this.attemptGeneration } as LifecycleExpectation,
    );
  }

  public planEffect(
    key: SyncOperationKey,
    effect: DurableSyncEffect,
    scope: string,
    expectedRevision?: number,
    options?: SaveOperationOptions,
  ): Promise<UnifiedSyncOperation | undefined> {
    const current = this.repository.getOperation(key, scope);
    if (
      !current ||
      current.phase === "completed" ||
      getAttemptGeneration(current) !== this.attemptGeneration ||
      effect.attemptGeneration !== undefined &&
      normalizeAttemptGeneration(effect.attemptGeneration) !== this.attemptGeneration
    ) {
      return Promise.resolve(undefined);
    }
    return this.repository.planEffect(
      key,
      { ...effect, attemptGeneration: this.attemptGeneration },
      scope,
      expectedRevision,
      { ...options, requireExisting: true },
    );
  }

  public transitionEffect(
    key: SyncOperationKey,
    effectId: string,
    action: DurableSyncEffectAction,
    scope: string,
    expected?: {
      operationRevision?: number;
      attemptGeneration?: number;
      sourceState: DurableSyncEffectState;
    },
  ): Promise<UnifiedSyncOperation | undefined> {
    if (
      expected?.attemptGeneration !== undefined &&
      normalizeAttemptGeneration(expected.attemptGeneration) !== this.attemptGeneration
    ) {
      return Promise.resolve(undefined);
    }
    return this.repository.transitionEffect(
      key,
      effectId,
      action,
      scope,
      { ...expected, attemptGeneration: this.attemptGeneration } as {
        operationRevision?: number;
        attemptGeneration?: number;
        sourceState: DurableSyncEffectState;
      },
    );
  }

  public completeOperation(
    key: SyncOperationKey,
    scope: string,
    expectedRevision?: number,
    completion?: { canonical?: any; remoteUpdatedAt?: string },
    _expectedAttemptGeneration?: number,
  ): Promise<boolean> {
    return this.repository.completeOperation(
      key,
      scope,
      expectedRevision,
      completion,
      this.attemptGeneration,
    );
  }

  public deleteOperation(key: SyncOperationKey, scope: string, _expectedAttemptGeneration?: number): Promise<boolean> {
    return this.repository.deleteOperation(key, scope, this.attemptGeneration);
  }
}

export const withAttemptGenerationFence = (
  repository: SyncOperationRepository,
  attemptGeneration: number | undefined,
): SyncOperationRepository => new AttemptGenerationFencedRepository(
  repository,
  normalizeAttemptGeneration(attemptGeneration),
);

export const createSyncOperationRepository = (): SyncOperationRepository =>
  new DefaultSyncOperationRepository();
