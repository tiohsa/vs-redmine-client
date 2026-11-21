import { AsyncLocalStorage } from "async_hooks";
import {
  GenericLifecycleAction,
  LifecycleExpectation,
  SyncIntent,
  SyncOperationKey,
  TicketCreateIntent,
  TicketUpdateIntent,
  CommentCreateIntent,
  CommentUpdateIntent,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import { applyGenericTransition } from "./syncStateMachine";
import {
  areSnapshotsEqual,
  DurableSyncEffect,
  DurableSyncEffectAction,
  DurableSyncEffectState,
  getAttemptGeneration,
  getPrimaryEffectForRevision,
  normalizeAttemptGeneration,
  isPrimaryEffectKind,
  evaluateAttemptClosure,
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
  isAbandoned,
  mutateOfflineSyncQueueAsync,
  removeOfflineCommentEntryAsync,
  removeOfflineNewTicketAsync,
  removeOfflineTicketUpdateAsync,
  resolveStoredOfflineOperation,
  sameDocumentIdentity,
  type OfflineCommentUpdate,
  type OfflineNewTicket,
  type OfflineTicketUpdate,
} from "../../views/offlineSyncStore";
import {
  parseTicketEditorContent,
  buildTicketEditorContent,
} from "../../views/ticketEditorContent";

import { getOperationKey, getOpKeyString } from "./syncOperationKey";
import { applyPrimaryRemoteTransition } from "./syncPrimaryRemoteTransition";
import type { PrimaryRemoteTransition, SaveOperationOptions, SyncOperationRepository } from "./syncRepositoryTypes";
import {
  getOperationFromQueue,
  toUnifiedOperationFromStored,
  toUnifiedOperationFromTicket,
  toUnifiedOperationFromNewTicket,
  toUnifiedOperationFromComment,
} from "./syncStoredOperationMapping";

export { AttemptGenerationFencedRepository, withAttemptGenerationFence } from "./syncAttemptGenerationRepository";
export type { PrimaryRemoteTransition, SaveOperationOptions, SyncOperationRepository } from "./syncRepositoryTypes";
export { toUnifiedOperationFromTicket, toUnifiedOperationFromNewTicket, toUnifiedOperationFromComment } from "./syncStoredOperationMapping";

export class DefaultSyncOperationRepository implements SyncOperationRepository {
  private readonly mutexByScope = new Map<string, Promise<any>>();

  public getOperation<I extends SyncIntent = SyncIntent>(key: SyncOperationKey, scope: string): UnifiedSyncOperation<I> | undefined {
    const queue = getOfflineSyncQueue(scope);
    const stored = resolveStoredOfflineOperation(queue, key);
    if (stored && isAbandoned(stored.value)) { return undefined; }
    if (key.kind === "ticket" && !stored &&
        (queue.abandonedTickets ?? []).some((item) => item.ticketId === key.ticketId)) {
      return undefined;
    }
    const operation = stored ? toUnifiedOperationFromStored(stored, scope) : undefined;
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
      if (isAbandoned(ticket)) { continue; }
      operations.push(toUnifiedOperationFromTicket(ticket, scope));
    }
    for (const newTicket of queue.newTickets) {
      if (isAbandoned(newTicket)) { continue; }
      operations.push(toUnifiedOperationFromNewTicket(newTicket, scope));
    }
    for (const comment of queue.comments) {
      if (isAbandoned(comment)) { continue; }
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
    if (key.kind === "ticket") {
      const active = nextQueue.tickets.get(key.ticketId);
      if ((active && active.operationId !== operation.operationId) ||
          (!active && (nextQueue.abandonedTickets ?? []).some((item) => item.ticketId === key.ticketId))) {
        return undefined;
      }
    }
    const stored = resolveStoredOfflineOperation(nextQueue, key)?.value;
    if (stored && isAbandoned(stored)) { return undefined; }
    const current = getOperationFromQueue(nextQueue, key, scope);
    if (current && current.operationId !== operation.operationId) { return undefined; }

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
        attachments: intent?.attachments,
        uploadTokens: intent?.uploadTokens,
        childTickets: intent?.childTickets,
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
          attachments: nextIntent.attachments,
          uploadTokens: nextIntent.uploadTokens,
          childTickets: nextIntent.childTickets,
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
        preparationFailure: operation.phase === "queued" ? operation.errorMessage : undefined,
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
        remoteProjectId: operation.projectId,
        finalizeDraft: (intentObj as any)?.finalizeDraft ?? (operation as any).finalizeDraft,
        sourceNotesHash: (intentObj as any)?.sourceNotesHash ?? (operation as any).sourceNotesHash,
        lastKnownRemoteUpdatedAt: (intentObj as any)?.lastKnownRemoteUpdatedAt ?? operation.remoteUpdatedAt,
        effects: operation.effects ?? nextQueue.comments.find((c) => c.operationId === operation.operationId)?.effects,
        nextIntent: nextIntentObj ? {
          body: nextIntentObj.body,
          revision: (nextIntentObj as any)?.revision ?? (intentRevision + 1),
          documentUri: nextIntentObj.documentUri ?? operation.documentUri,
          baseDir: nextIntentObj.baseDir ?? intentObj?.baseDir,
        } : undefined,
      } as any;
      const idx = nextQueue.comments.findIndex((c) => c.operationId === payload.operationId);
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

      if ((action.kind === "record_reconciled_identity" || action.kind === "assume_remote_commit") &&
          getPrimaryEffectForRevision(current)?.state === "commit_unknown") {
        // 照合済みidentityとPrimary Effectの確定も同じ永続transactionで公開する。
        return this.transitionPrimaryRemoteWrite(key, action.kind === "record_reconciled_identity"
          ? { ...action, kind: "reconcile" }
          : { ...action, kind: "assume_committed" }, scope, expected);
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

      const nextOp = applyPrimaryRemoteTransition(current, transition, expected);
      if (!nextOp) {
        return undefined;
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
            operationId: key.operationId,
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
      // Completion without the callback's original revision is ambiguous: the
      // current operation may already contain a newer nextIntent. Fail closed
      // instead of deleting or promoting that newer intent.
      if (current && expectedRevision === undefined) {
        return false;
      }
      const revision = expectedRevision ?? current?.intentRevision ?? current?.revision ?? 1;

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
              allowEmptyStatus: true,
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
            intentRevision: next.revision ?? (current.intentRevision ?? current.revision ?? 0) + 1,
            attemptGeneration: getAttemptGeneration(current),
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
          { commentId: key.commentId, documentUri: key.documentUri, ticketId: key.ticketId, operationId: key.operationId },
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
          { ticketId: key.ticketId, commentId: key.commentId, documentUri: key.documentUri, operationId: key.operationId },
          scope,
        );
        return true;
      }
      return false;
    });
  }
}

export const createSyncOperationRepository = (): SyncOperationRepository =>
  new DefaultSyncOperationRepository();
