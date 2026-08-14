import type {
  GenericLifecycleAction,
  GenericSyncPhase,
  UnifiedSyncOperation,
} from "./syncOperationTypes";

/**
 * 許可される状態遷移テーブル
 */
const ALLOWED_TRANSITIONS: Record<GenericSyncPhase, GenericLifecycleAction["kind"][]> = {
  queued: ["begin_preparation"],
  preparing: ["start_normal_remote_write", "abort_before_remote_write"],
  remote_write_started: [
    "record_remote_commit",
    "mark_commit_unknown",
    "abort_known_remote_failure",
  ],
  commit_unknown: ["retry_commit_unknown", "assume_remote_commit", "record_reconciled_identity"],
  remote_committed: [
    "mark_reconciliation_pending",
    "mark_local_finalize_pending",
    "complete",
  ],
  reconciliation_pending: ["mark_local_finalize_pending", "record_reconciled_identity", "complete"],
  local_finalize_pending: ["complete"],
  completed: [],
};

export const isTransitionAllowed = (
  fromPhase: GenericSyncPhase,
  actionKind: GenericLifecycleAction["kind"],
): boolean => {
  const allowed = ALLOWED_TRANSITIONS[fromPhase];
  return allowed ? allowed.includes(actionKind) : false;
};

export const applyGenericTransition = (
  operation: UnifiedSyncOperation,
  action: GenericLifecycleAction,
): UnifiedSyncOperation | undefined => {
  if (!isTransitionAllowed(operation.phase, action.kind)) {
    return undefined;
  }

  const next = { ...operation };
  next.persistenceVersion = (operation.persistenceVersion || 0) + 1;
  next.updatedAt = new Date().toISOString();

  switch (action.kind) {
    case "begin_preparation":
      next.phase = "preparing";
      return next;

    case "start_normal_remote_write":
      next.phase = "remote_write_started";
      return next;

    case "record_remote_commit":
      next.phase = "remote_committed";
      if (action.createdRemoteId !== undefined) {
        next.createdRemoteId = action.createdRemoteId;
      }
      if (action.projectId !== undefined) {
        next.projectId = action.projectId;
      }
      if (action.remoteUpdatedAt !== undefined) {
        next.remoteUpdatedAt = action.remoteUpdatedAt;
      }
      return next;

    case "mark_commit_unknown":
      next.phase = "commit_unknown";
      return next;

    case "abort_before_remote_write":
    case "abort_known_remote_failure":
      next.phase = "queued";
      if (next.nextIntent) {
        // 次の intent があれば昇格
        next.payload = next.nextIntent;
        next.nextIntent = undefined;
        next.revision = (next.revision || 0) + 1;
      }
      return next;

    case "retry_commit_unknown":
      next.phase = "remote_write_started";
      return next;

    case "assume_remote_commit":
      next.phase = "remote_committed";
      if (action.remoteId !== undefined) {
        next.createdRemoteId = action.remoteId;
      }
      if (action.projectId !== undefined) {
        next.projectId = action.projectId;
      }
      if (action.remoteUpdatedAt !== undefined) {
        next.remoteUpdatedAt = action.remoteUpdatedAt;
      }
      return next;

    case "record_reconciled_identity":
      next.phase = "local_finalize_pending";
      next.createdRemoteId = action.remoteId;
      if (action.projectId !== undefined) {
        next.projectId = action.projectId;
      }
      if (action.remoteUpdatedAt !== undefined) {
        next.remoteUpdatedAt = action.remoteUpdatedAt;
      }
      return next;

    case "mark_reconciliation_pending":
      next.phase = "reconciliation_pending";
      return next;

    case "mark_local_finalize_pending":
      next.phase = "local_finalize_pending";
      return next;

    case "complete":
      next.phase = "completed";
      return next;
  }
};

/**
 * プロセス再起動時の正規化 (INV-03 / INV-14)
 */
export const normalizeOperationOnRestart = (
  operation: UnifiedSyncOperation,
): UnifiedSyncOperation => {
  const normalized = { ...operation };
  if (normalized.phase === "remote_write_started") {
    // 実行中だった remote write は不確定 (commit_unknown) に正規化
    normalized.phase = "commit_unknown";
    normalized.updatedAt = new Date().toISOString();
  } else if (normalized.phase === "preparing") {
    // 準備中だったものは queued に巻き戻し、nextIntent があれば昇格
    normalized.phase = "queued";
    if (normalized.nextIntent) {
      normalized.payload = normalized.nextIntent;
      normalized.nextIntent = undefined;
      normalized.revision = (normalized.revision || 0) + 1;
    }
    normalized.updatedAt = new Date().toISOString();
  }
  return normalized;
};
