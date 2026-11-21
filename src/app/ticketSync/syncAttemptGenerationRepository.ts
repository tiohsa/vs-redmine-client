import type {
  GenericLifecycleAction,
  LifecycleExpectation,
  SyncIntent,
  SyncOperationKey,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import {
  DurableSyncEffect,
  DurableSyncEffectAction,
  DurableSyncEffectState,
  getAttemptGeneration,
  normalizeAttemptGeneration,
} from "../syncEffects";

import { getOperationKey } from "./syncOperationKey";
import type { PrimaryRemoteTransition, SaveOperationOptions, SyncOperationRepository } from "./syncRepositoryTypes";

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

