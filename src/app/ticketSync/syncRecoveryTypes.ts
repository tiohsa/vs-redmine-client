import type { EffectResolution, OperationHandler, OperationHandlerDeps } from "./operationHandlerTypes";
import type { SyncOperationRepository } from "./syncRepositoryTypes";
import type { SyncOperationKey, SyncOutcome, UnifiedSyncOperation } from "./syncOperationTypes";
import type { SyncContext } from "./ports";
import type { DurableSyncEffectState } from "../syncEffects";

export type SyncRecoveryInput = {
  key: SyncOperationKey;
  operationId: string;
  operationRevision: number;
  attemptGeneration: number;
  context: SyncContext;
  deps?: OperationHandlerDeps;
};

export type SyncEffectRecoveryInput = SyncRecoveryInput & {
  effectId: string;
  expectedEffectState: DurableSyncEffectState;
  resolution: EffectResolution;
};

export interface SyncRecoveryDependencies {
  repository: SyncOperationRepository;
  handlers: Record<UnifiedSyncOperation["kind"], OperationHandler>;
  inFlight: Map<string, Promise<SyncOutcome>>;
}

export interface CommitUnknownRecoveryDependencies extends SyncRecoveryDependencies {
  resolveEffect(input: SyncEffectRecoveryInput): Promise<SyncOutcome>;
  executeSyncLifecycle(operation: UnifiedSyncOperation, context: SyncContext, options: { deps: OperationHandlerDeps }): Promise<SyncOutcome>;
}

export type CommitUnknownRecoveryInput = SyncRecoveryInput & {
  resolution?:
    | { kind: "reconcile_remote" }
    | { kind: "link_remote_comment"; commentId: number; explicitLink?: boolean }
    | { kind: "link_remote_ticket"; ticketId: number; explicitLink?: boolean }
    | { kind: "link_created_ticket"; ticketId: number; explicitLink?: boolean }
    | { kind: "assume_update_committed" }
    | { kind: "retry_remote_write" }
    | { kind: "reconcile_compensation" };
};
