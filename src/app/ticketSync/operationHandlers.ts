import * as vscode from "vscode";
import type { IssueDetailResult } from "../../redmine/issues";
import type { UploadToken } from "../../redmine/types";
import {
  applyQueuedTicketUpdate,
  queueNewTicketDraftContent,
} from "../../views/ticketSync/ticketQueueSync";
import {
  createTicketFromQueuedContent,
} from "../../views/ticketSync/ticketCreateSync";
import {
  applyQueuedCommentUpdate,
  finalizeNewCommentDraftDocument,
  reconcileCommentCommitUnknown,
} from "../../views/commentSaveSync";
import {
  finalizeNewCommentDraftFileAfterSync,
  updateCommentUpdateFileAfterSync,
} from "../../views/commentUpdateFile";
import type { TicketCreateDependencies, TicketSaveDependencies } from "../../views/ticketSync/types";
import type { CommentSaveDependencies } from "../../views/commentSaveSync";
import type { SyncOutcome, UnifiedSyncOperation } from "./syncOperationTypes";
import { defaultDeps as defaultTicketDeps } from "../../views/ticketSync/ticketSyncDeps";

export interface OperationHandlerContext {
  connectionScope: string;
}

export interface OperationHandlerDeps {
  ticketCreate?: Partial<TicketCreateDependencies>;
  ticketUpdate?: Partial<TicketSaveDependencies>;
  comment?: Partial<CommentSaveDependencies>;
}

export interface OperationHandler<TPrepared = any> {
  prepare(
    operation: UnifiedSyncOperation,
    context: OperationHandlerContext,
    deps: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: TPrepared } | { ok: false; outcome: SyncOutcome }>;

  executeRemoteWrite(
    operation: UnifiedSyncOperation,
    prepared: TPrepared,
    context: OperationHandlerContext,
    deps: OperationHandlerDeps,
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
    operation: UnifiedSyncOperation,
    context: OperationHandlerContext,
    deps: OperationHandlerDeps,
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
    operation: UnifiedSyncOperation,
    reconciled: any,
    context: OperationHandlerContext,
    deps: OperationHandlerDeps,
  ): Promise<{ ok: true } | { ok: false; message: string; pending: "local_finalize" }>;
}
