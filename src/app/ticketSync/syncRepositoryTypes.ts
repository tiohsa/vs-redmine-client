import type {
  GenericLifecycleAction,
  LifecycleExpectation,
  SyncIntent,
  SyncOperationKey,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import type {
  DurableSyncEffect,
  DurableSyncEffectAction,
  DurableSyncEffectState,
  EffectFailureInfo,
  SyncEffectRequestSnapshot,
} from "../syncEffects";

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
      kind: "reconcile";
      remoteId: number;
      projectId?: number;
      remoteUpdatedAt?: string;
    }
  | {
      kind: "assume_committed";
      remoteId?: number;
      projectId?: number;
      remoteUpdatedAt?: string;
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

export interface SaveOperationOptions {
  requireExisting?: boolean;
}

