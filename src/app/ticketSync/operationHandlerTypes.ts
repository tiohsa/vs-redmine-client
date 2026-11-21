import type { IssueUploadInput } from "../../redmine/issues";
import { type SyncOperationRepository } from "./syncRepository";
import type { TicketCreateDependencies, TicketSaveDependencies } from "../../views/ticketSync/types";
import { type CommentSaveDependencies } from "../../views/commentSaveSync";
import { type FailureDisposition } from "../syncEffects";
import type { SyncIntent, SyncOperationKey, SyncOutcome, UnifiedSyncOperation } from "./syncOperationTypes";
import type { DocumentPort, UploadSpoolStore } from "./ports";

export interface OperationHandlerContext {
  connectionScope: string;
}

export interface OperationHandlerDeps {
  ticketCreate?: Partial<TicketCreateDependencies>;
  ticketUpdate?: Partial<TicketSaveDependencies>;
  comment?: Partial<CommentSaveDependencies>;
  documents?: DocumentPort;
  repository?: SyncOperationRepository;
  uploadSpoolStore?: UploadSpoolStore;
  localState?: any;
  skipDocumentRewrite?: boolean;
}

export interface OperationHandler<TIntent extends SyncIntent = any, TPrepared = any> {
  prepare(
    operation: UnifiedSyncOperation<TIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: TPrepared } | { ok: false; outcome: SyncOutcome }>;

  executeSecondaryEffects?(
    operation: UnifiedSyncOperation<TIntent>,
    prepared: TPrepared,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; uploadTokens?: IssueUploadInput[] } | { ok: false; error: Error; commitUnknown?: boolean; outcome?: SyncOutcome }>;

  executeRemoteWrite(
    operation: UnifiedSyncOperation<TIntent>,
    prepared: TPrepared,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{
    ok: true;
    createdRemoteId?: number;
    projectId?: number;
    remoteUpdatedAt?: string;
  } | {
    ok: false;
    commitUnknown: boolean;
    error: Error;
    outcome?: SyncOutcome;
  }>;

  reconcileRemote(
    operation: UnifiedSyncOperation<TIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{
    ok: true;
    remoteId?: number;
    projectId?: number;
    remoteUpdatedAt?: string;
    canonical?: any;
  } | {
    ok: false;
    message: string;
  }>;

  finalizeLocal(
    operation: UnifiedSyncOperation<TIntent>,
    reconciled: any,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true } | { ok: false; message: string; pending: "local_finalize" }>;
  resolveEffect?(input: {
    key: SyncOperationKey;
    effectId: string;
    operation: UnifiedSyncOperation<TIntent>;
    context: OperationHandlerContext;
    deps: OperationHandlerDeps & { repository: SyncOperationRepository };
    resolution: EffectResolution;
  }): Promise<SyncOutcome>;
}

export type EffectResolution =
  | { kind: "retry_effect" }
  | { kind: "assume_committed"; remoteId?: number; token?: string }
  | { kind: "link_remote_child"; remoteId: number }
  | { kind: "reconcile_compensation"; remoteId?: number }
  | { kind: "mark_failed"; disposition?: FailureDisposition; category?: string };
