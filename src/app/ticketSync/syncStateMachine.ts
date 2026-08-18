import type {
  GenericLifecycleAction,
  GenericSyncPhase,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import { type DurableSyncEffect, restoreDurableSyncEffect } from "../syncEffects";

/**
 * abort/retry rollback時にdurableなEffectを保持するフィルター (INV-N11, F-17)
 * committed/commit_unknown/failed/compensation_* は次回retry・明示的リカバリ時に再利用可能なため保持する。
 * Primaryがcommit前にabortする場合でも、アップロード済みtokenや失敗証拠等を失わない。
 */
export const retainDurableEffectsForRetry = (
  effects: DurableSyncEffect[],
): DurableSyncEffect[] =>
  effects.filter(
    (e) =>
      e.state === "committed" ||
      e.state === "commit_unknown" ||
      e.state === "failed" ||
      e.state === "compensation_started" ||
      e.state === "compensation_unknown",
  );

/**
 * 許可される状態遷移テーブル (INV-04, INV-09, INV-10, INV-11)
 */
const ALLOWED_TRANSITIONS: Record<GenericSyncPhase, GenericLifecycleAction["kind"][]> = {
  queued: [
    "begin_preparation",
    "start_normal_remote_write",
    "abort_before_remote_write",
    "start_explicit_retry_remote_write",
  ],
  preparing: [
    "start_normal_remote_write",
    "abort_before_remote_write",
    "start_explicit_retry_remote_write",
  ],
  remote_write_started: [
    "record_remote_commit",
    "mark_commit_unknown",
    "abort_known_remote_failure",
    "assume_remote_commit",
    "record_reconciled_identity",
    "start_explicit_retry_remote_write",
  ],
  commit_unknown: ["assume_remote_commit", "record_reconciled_identity", "start_explicit_retry_remote_write"],
  remote_committed: [
    "record_remote_commit",
    "mark_reconciliation_pending",
    "mark_local_finalize_pending",
    "record_reconciled_identity",
    "abort_known_remote_failure",
  ],
  reconciliation_pending: ["mark_reconciliation_pending", "mark_local_finalize_pending", "record_reconciled_identity"],
  local_finalize_pending: ["mark_local_finalize_pending", "complete"],
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

  const next: UnifiedSyncOperation = { ...operation };
  next.version = (operation.version ?? operation.persistenceVersion ?? 0) + 1;
  next.persistenceVersion = next.version;
  next.updatedAt = new Date().toISOString();

  switch (action.kind) {
    case "begin_preparation":
      next.phase = "preparing";
      return next;

    case "start_normal_remote_write":
    case "start_explicit_retry_remote_write": {
      next.phase = "remote_write_started";
      return next;
    }

    case "record_remote_commit": {
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
    }

    case "mark_commit_unknown": {
      next.phase = "commit_unknown";
      if (action.message) {
        next.errorMessage = action.message;
      }
      return next;
    }

    case "abort_before_remote_write": {
      // Remote mutation が開始される前にのみ安全にロールバック可能
      const primaryEffect = (next.effects ?? []).find(
        (e) =>
          e.kind === "ticket_create" ||
          e.kind === "ticket_update" ||
          e.kind === "comment_create" ||
          e.kind === "comment_update" ||
          e.effectId === "ticket-create" ||
          e.effectId === "ticket-update" ||
          e.effectId === "comment-create" ||
          e.effectId === "comment-update",
      );
      if (primaryEffect?.state === "committed") {
        return undefined; // Primary committed がある場合はロールバック拒絶 (INV-N01)
      }
      next.phase = "queued";
      next.createdRemoteId = undefined;
      next.createdChildIds = undefined;
      // INV-N11, F-17: committed/commit_unknown/failed/compensation_* なEffectは保持する
      next.effects = retainDurableEffectsForRetry(next.effects ?? []);
      if (next.nextIntent) {
        next.intent = next.nextIntent;
        next.nextIntent = undefined;
        next.intentRevision = (next.intentRevision ?? next.revision ?? 0) + 1;
        next.revision = next.intentRevision;
      }
      return next;
    }

    case "abort_known_remote_failure": {
      // Primary Remote mutation 自体が既知失敗した場合専用
      const primaryEffect = (next.effects ?? []).find(
        (e) =>
          e.kind === "ticket_create" ||
          e.kind === "ticket_update" ||
          e.kind === "comment_create" ||
          e.kind === "comment_update" ||
          e.effectId === "ticket-create" ||
          e.effectId === "ticket-update" ||
          e.effectId === "comment-create" ||
          e.effectId === "comment-update",
      );
      if (primaryEffect?.state === "committed" || (primaryEffect?.state !== "compensated" && next.createdRemoteId !== undefined && next.createdRemoteId > 0)) {
        // Primary が既に committed なら Primary 証拠を失わせてはならない (INV-N01)
        return undefined;
      }
      next.phase = "queued";
      next.createdRemoteId = undefined;
      next.createdChildIds = undefined;
      // INV-N11, F-17: Primaryが完全補償された場合は全Effectをリセット。それ以外は committed/commit_unknown/failed/compensation_* を保持
      next.effects = primaryEffect?.state === "compensated" ? [] : retainDurableEffectsForRetry(next.effects ?? []);
      if (next.nextIntent) {
        // 次の intent があれば昇格 (INV-07)
        next.intent = next.nextIntent;
        next.nextIntent = undefined;
        next.intentRevision = (next.intentRevision ?? next.revision ?? 0) + 1;
        next.revision = next.intentRevision;
      }
      return next;
    }

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

    case "record_reconciled_identity": {
      next.phase = "local_finalize_pending";
      const resolvedId = action.remoteId;
      if (resolvedId !== undefined) {
        next.createdRemoteId = resolvedId;
        if (operation.kind === "comment_create" || operation.kind === "comment_update" || operation.commentId !== undefined) {
          next.commentId = resolvedId;
        }
      }
      if (action.projectId !== undefined) {
        next.projectId = action.projectId;
      }
      if (action.remoteUpdatedAt !== undefined) {
        next.remoteUpdatedAt = action.remoteUpdatedAt;
      }
      if ((action as any).canonical !== undefined) {
        (next as any).canonical = (action as any).canonical;
      }
      return next;
    }

    case "mark_reconciliation_pending":
      next.phase = "reconciliation_pending";
      if (action.message) {
        next.errorMessage = action.message;
      }
      return next;

    case "mark_local_finalize_pending":
      next.phase = "local_finalize_pending";
      if ((action as any).canonical !== undefined) {
        (next as any).canonical = (action as any).canonical;
      }
      return next;

    case "complete":
      next.phase = "completed";
      return next;
  }
};

/**
 * プロセス再起動時の正規化 (INV-03 / INV-14, D-07)
 */
export const normalizeOperationOnRestart = (
  operation: UnifiedSyncOperation,
): UnifiedSyncOperation => {
  const normalized: UnifiedSyncOperation = { ...operation };
  normalized.version = (operation.version ?? operation.persistenceVersion ?? 0) + 1;
  normalized.persistenceVersion = normalized.version;
  normalized.updatedAt = new Date().toISOString();

  if (normalized.phase === "remote_write_started") {
    // 実行中だった remote write は不確定 (commit_unknown) に正規化 (INV-03)
    normalized.phase = "commit_unknown";
  } else if (normalized.phase === "preparing") {
    // 準備中だったものは queued に巻き戻し、nextIntent があれば昇格
    normalized.phase = "queued";
    if (normalized.nextIntent) {
      normalized.intent = normalized.nextIntent;
      normalized.nextIntent = undefined;
      normalized.intentRevision = (normalized.intentRevision ?? normalized.revision ?? 0) + 1;
      normalized.revision = normalized.intentRevision;
    }
  }

  // secondary effect の started は commit_unknown に正規化 (syncEffects.ts の restoreDurableSyncEffect を正本とする)
  if (normalized.effects && normalized.effects.length > 0) {
    normalized.effects = normalized.effects.map(restoreDurableSyncEffect);
  }

  return normalized;
};

