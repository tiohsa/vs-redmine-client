import type {
  CommentLifecycleAction,
  NewTicketLifecycleAction,
  NewTicketSyncPhase,
  OfflineCommentUpdate,
  OfflineDiscardMode,
  OfflineNewTicket,
  OfflineSyncLifecycle,
  OfflineSyncPolicy,
  OfflineTicketUpdate,
  SyncDisposition,
  TicketUpdateLifecycleAction,
  TicketUpdateSyncPhase,
} from "./offlineSyncTypes";

export const isAbandoned = (operation: { disposition?: SyncDisposition }): boolean =>
  operation.disposition?.kind === "abandoned";

export const getOfflineSyncLifecycle = (
  operation: Pick<OfflineNewTicket | OfflineTicketUpdate | OfflineCommentUpdate, "phase">,
): OfflineSyncLifecycle => {
  if (operation.phase === "commit_unknown" || operation.phase === "remote_write_started") {
    return "commit_unknown";
  }
  if (operation.phase && operation.phase !== "queued" && operation.phase !== "completed") {
    return "recovery_pending";
  }
  return "queued";
};

type OfflineDiscardPolicyInput =
  Pick<OfflineNewTicket | OfflineTicketUpdate | OfflineCommentUpdate, "phase" | "nextIntent" | "effects"> &
  Pick<OfflineNewTicket, "remoteUpdatedAt" | "createdChildIds" | "createdIssueId" | "status"> &
  Pick<OfflineCommentUpdate, "remoteProjectId" | "commentId" | "finalizeDraft"> &
  { createdRemoteId?: number };

const hasRetainedRemoteEvidence = (operation: OfflineDiscardPolicyInput): boolean =>
  operation.remoteUpdatedAt !== undefined ||
    (operation.createdChildIds?.length ?? 0) > 0 ||
    operation.createdIssueId !== undefined ||
    operation.createdRemoteId !== undefined ||
    operation.status === "created_rewrite_failed" ||
    operation.remoteProjectId !== undefined ||
    (operation.finalizeDraft === true && operation.commentId !== undefined) ||
    (operation.effects ?? []).some((effect) =>
      effect.state !== "planned" || effect.remoteId !== undefined ||
      effect.token !== undefined || effect.target.token !== undefined,
    );

export const evaluateOfflineSyncPolicy = (
  operation: OfflineDiscardPolicyInput,
): OfflineSyncPolicy => {
  const lifecycle = getOfflineSyncLifecycle(operation);
  const hasEvidence = hasRetainedRemoteEvidence(operation);
  const discardMode: OfflineDiscardMode = lifecycle === "queued" && !hasEvidence
    ? "active"
    : operation.nextIntent !== undefined
      ? "nextIntent"
      : "none";
  return { lifecycle, canDiscard: discardMode !== "none", discardMode };
};

export const newTicketActionAllowsSource = (
  action: NewTicketLifecycleAction,
  source: NewTicketSyncPhase,
): boolean => {
  switch (action.kind) {
    case "begin_preparation": return source === "queued";
    case "abort_before_remote_write": return source === "preparing";
    case "start_normal_remote_write": return source === "preparing";
    case "start_explicit_retry_remote_write": return source === "commit_unknown" || source === "remote_write_started";
    case "mark_commit_unknown": return source === "remote_write_started";
    case "record_remote_created": return source === "remote_write_started";
    case "link_created_ticket": return source === "commit_unknown" || source === "remote_write_started";
    case "mark_reconciliation_pending":
      return source === "remote_created" || source === "reconciliation_pending" ||
        source === "local_finalize_pending";
    case "mark_local_finalize_pending":
      return source === "remote_created" || source === "reconciliation_pending" ||
        source === "local_finalize_pending";
    case "mark_compensation_pending":
      return source === "remote_created" || source === "reconciliation_pending";
    case "complete_compensation":
      return source === "remote_created";
  }
};

export const ticketUpdateActionAllowsSource = (
  action: TicketUpdateLifecycleAction,
  source: TicketUpdateSyncPhase,
): boolean => {
  switch (action.kind) {
    case "begin_preparation": return source === "queued";
    case "abort_before_remote_write": return source === "preparing";
    case "start_normal_remote_write": return source === "preparing";
    case "start_explicit_retry_remote_write": return source === "commit_unknown" || source === "remote_write_started";
    case "mark_commit_unknown": return source === "remote_write_started";
    case "record_remote_commit": return source === "remote_write_started";
    case "assume_update_committed": return source === "commit_unknown" || source === "remote_write_started";
    case "mark_reconciliation_pending":
      return source === "remote_committed" || source === "reconciliation_pending" ||
        source === "local_finalize_pending";
    case "mark_local_finalize_pending":
      return source === "remote_committed" || source === "reconciliation_pending" ||
        source === "local_finalize_pending";
    case "mark_compensation_pending":
      return source === "preparing" || source === "remote_write_started" ||
        source === "reconciliation_pending";
  }
};

export const commentActionAllowsSource = (
  action: CommentLifecycleAction,
  source: TicketUpdateSyncPhase,
): boolean => {
  switch (action.kind) {
    case "begin_preparation": return source === "queued";
    case "abort_before_remote_write": return source === "preparing";
    case "start_normal_remote_write": return source === "preparing";
    case "mark_commit_unknown": return source === "remote_write_started";
    case "assume_remote_commit": return source === "commit_unknown";
    case "abort_known_remote_failure": return source === "remote_write_started";
    case "record_remote_commit": return source === "remote_write_started";
    case "record_reconciled_identity":
      return source === "remote_committed" || source === "reconciliation_pending" ||
        source === "local_finalize_pending";
    case "mark_reconciliation_pending":
      return source === "remote_committed" || source === "reconciliation_pending";
    case "mark_local_finalize_pending":
      return source === "remote_committed" || source === "reconciliation_pending" ||
        source === "local_finalize_pending";
  }
};
