import type { IssueCreateInput, IssueUpdateInput, IssueUploadInput } from "../redmine/issues";
import type { UploadToken } from "../redmine/types";

export type DurableSyncEffectKind =
  | "ticket_create"
  | "ticket_update"
  | "child_create"
  | "comment_create"
  | "comment_update"
  | "attachment_upload"
  | "image_upload"
  | "ticket_delete"
  | "local_finalize";

export type DurableSyncEffectState =
  | "planned"
  | "started"
  | "failed"
  | "committed"
  | "commit_unknown"
  | "compensation_started"
  | "compensated"
  | "compensation_unknown";

export type FailureDisposition = "retryable" | "non_retriable";

export type EffectFailureInfo = {
  disposition: FailureDisposition;
  category?: string;
  detail?: string;
};

export type DurableSyncEffectTarget = {
  ticketId?: number;
  parentTicketId?: number;
  commentId?: number;
  documentUri?: string;
  ordinal?: number;
  subjectHash?: string;
  filePath?: string;
  filename?: string;
  token?: string;
  imageUri?: string;
  replacementUri?: string;
  submittedBody?: string;
};

export type CommentCreateRequestSnapshot = {
  kind: "comment_create";
  request: {
    ticketId: number;
    notes: string;
    uploads?: UploadToken[];
  };
  submittedBody?: string;
  submittedUploads?: Array<{ token: string; filename?: string; contentType?: string }>;
};

export type CommentUpdateRequestSnapshot = {
  kind: "comment_update";
  request: {
    commentId: number;
    notes: string;
    uploads?: UploadToken[];
  };
  submittedBody?: string;
  submittedUploads?: Array<{ token: string; filename?: string; contentType?: string }>;
};

export type TicketCreateRequestSnapshot = {
  kind: "ticket_create";
  request: IssueCreateInput;
};

export type TicketUpdateRequestSnapshot = {
  kind: "ticket_update";
  request: IssueUpdateInput;
};

export type ChildTicketCreateRequestSnapshot = {
  kind: "child_create";
  parentTicketId: number;
  ordinal?: number;
  projectId?: number;
  subject?: string;
  description?: string;
  request: IssueCreateInput;
};

export type UploadRequestSnapshot = {
  kind: "upload";
  filePath?: string;
  filename: string;
  contentType: string;
  contentHash: string;
  contentSize: number;
  imageUri?: string;
  spoolFilePath?: string;
};

export type SyncEffectRequestSnapshot =
  | CommentCreateRequestSnapshot
  | CommentUpdateRequestSnapshot
  | TicketCreateRequestSnapshot
  | TicketUpdateRequestSnapshot
  | ChildTicketCreateRequestSnapshot
  | UploadRequestSnapshot;

export type DurableSyncEffect = {
  effectId: string;
  kind: DurableSyncEffectKind;
  operationRevision: number;
  state: DurableSyncEffectState;
  target: DurableSyncEffectTarget;
  requestSnapshot?: SyncEffectRequestSnapshot;
  remoteId?: number;
  token?: string;
  detail?: string;
  failure?: EffectFailureInfo;
};

export type DurableSyncEffectExpectation = {
  operationRevision: number;
  sourceState: DurableSyncEffectState;
};

export type DurableSyncEffectAction =
  | { kind: "start"; requestSnapshot?: SyncEffectRequestSnapshot }
  | { kind: "start_explicit_retry"; requestSnapshot?: SyncEffectRequestSnapshot }
  | { kind: "commit"; remoteId?: number; token?: string; target?: DurableSyncEffectTarget; requestSnapshot?: SyncEffectRequestSnapshot }
  | { kind: "assume_committed"; remoteId?: number; token?: string; target?: DurableSyncEffectTarget; requestSnapshot?: SyncEffectRequestSnapshot }
  | { kind: "mark_commit_unknown"; detail?: string }
  | { kind: "mark_failed"; detail?: string; disposition?: FailureDisposition; category?: string }
  | { kind: "start_compensation" }
  | { kind: "complete_compensation" }
  | { kind: "mark_compensation_unknown"; detail?: string };

const UNCERTAIN_EFFECT_STATES: ReadonlySet<DurableSyncEffectState> = new Set([
  "started",
  "commit_unknown",
  "compensation_started",
  "compensation_unknown",
]);

export const restoreDurableSyncEffect = (
  effect: DurableSyncEffect,
): DurableSyncEffect => {
  const restored: DurableSyncEffect = {
    ...effect,
    state:
      effect.state === "started"
        ? "commit_unknown"
        : effect.state === "compensation_started"
        ? "compensation_unknown"
        : effect.state,
    target: { ...effect.target },
  };
  if (effect.requestSnapshot) {
    restored.requestSnapshot = { ...effect.requestSnapshot };
  } else {
    delete (restored as any).requestSnapshot;
  }
  if (effect.failure) {
    restored.failure = { ...effect.failure };
  }
  return restored;
};

export const canRetryEffect = (effect: DurableSyncEffect): boolean => {
  if (effect.state === "failed") {
    return effect.failure?.disposition === "retryable";
  }
  if (effect.state === "commit_unknown") {
    if (
      isPrimaryEffectKind(effect.kind) ||
      effect.effectId === "ticket-create" ||
      effect.effectId === "ticket-update" ||
      effect.effectId === "comment-create" ||
      effect.effectId === "comment-update"
    ) {
      return effect.requestSnapshot !== undefined;
    }
    if (
      effect.kind === "attachment_upload" ||
      effect.kind === "image_upload" ||
      (typeof effect.effectId === "string" &&
        (effect.effectId.startsWith("attachment") || effect.effectId.startsWith("image")))
    ) {
      const snap = effect.requestSnapshot as UploadRequestSnapshot | undefined;
      return !!(
        snap &&
        typeof snap.contentHash === "string" &&
        snap.contentHash.length > 0 &&
        typeof snap.contentSize === "number"
      );
    }
    if (
      effect.kind === "child_create" ||
      (typeof effect.effectId === "string" && effect.effectId.startsWith("child-create"))
    ) {
      // child commit_unknown は blind retry 禁止 (link のみ)
      return false;
    }
    return effect.requestSnapshot !== undefined;
  }
  if (effect.state === "compensation_unknown" || effect.state === "compensation_started") {
    return true;
  }
  return false;
};

export const isEffectBlockingNormalSync = (effect: DurableSyncEffect): boolean => {
  if (
    effect.state === "started" ||
    effect.state === "commit_unknown" ||
    effect.state === "failed" ||
    effect.state === "compensation_started" ||
    effect.state === "compensation_unknown"
  ) {
    return true;
  }
  return false;
};

export const isPrimaryEffectKind = (kind: DurableSyncEffectKind): boolean =>
  kind === "ticket_create" ||
  kind === "ticket_update" ||
  kind === "comment_create" ||
  kind === "comment_update";

export const getEffectsForRevision = (
  operation: { effects?: DurableSyncEffect[]; revision?: number; intentRevision?: number },
  targetRevision?: number,
): DurableSyncEffect[] => {
  const rev = targetRevision ?? operation.intentRevision ?? operation.revision ?? 1;
  return (operation.effects ?? []).filter((e) => (e.operationRevision ?? rev) === rev);
};

export const getPrimaryEffectForRevision = (
  operation: { effects?: DurableSyncEffect[]; revision?: number; intentRevision?: number },
  targetRevision?: number,
): DurableSyncEffect | undefined => {
  const activeEffects = getEffectsForRevision(operation, targetRevision);
  return activeEffects.find(
    (e) =>
      isPrimaryEffectKind(e.kind) ||
      e.effectId === "ticket-create" ||
      e.effectId === "ticket-update" ||
      e.effectId === "comment-create" ||
      e.effectId === "comment-update",
  );
};

export const isPrimaryRecoveryRequired = (
  operation?: { phase?: string },
  primaryEffect?: { state?: DurableSyncEffectState },
): boolean => {
  if (!operation) {
    return false;
  }
  if (
    operation.phase === "commit_unknown" ||
    operation.phase === "compensation_unknown" ||
    operation.phase === "compensation_started"
  ) {
    return true;
  }
  if (
    primaryEffect?.state === "commit_unknown" ||
    primaryEffect?.state === "failed" ||
    primaryEffect?.state === "compensation_unknown" ||
    primaryEffect?.state === "compensation_started"
  ) {
    return true;
  }
  if (operation.phase === "remote_write_started" && primaryEffect?.state === "started") {
    return true;
  }
  return false;
};

export type RecoveryActionKind =
  | "retry_remote_write"
  | "reconcile_remote"
  | "link_created_ticket"
  | "link_remote_ticket"
  | "link_remote_comment"
  | "assume_update_committed"
  | "retry_effect"
  | "link_remote_child"
  | "reconcile_compensation";

export type RecoveryItem = {
  operationId: string;
  operationRevision: number;
  effectId: string;
  effectKind: DurableSyncEffectKind;
  state: DurableSyncEffectState;
  message?: string;
  allowedActions: RecoveryActionKind[];
};

export type OperationRecoveryMode =
  | "normal"
  | "commit_uncertainty"
  | "compensation_uncertainty";

export const getOperationRecoveryMode = (operation: {
  phase?: string;
  effects?: DurableSyncEffect[];
  revision?: number;
  intentRevision?: number;
}): OperationRecoveryMode => {
  const currentRevision = operation.intentRevision ?? operation.revision ?? 1;
  const primaryEffect = getPrimaryEffectForRevision(operation, currentRevision);

  const isPrimaryCompensation =
    operation.phase === "compensation_unknown" ||
    operation.phase === "compensation_started" ||
    primaryEffect?.state === "compensation_unknown" ||
    primaryEffect?.state === "compensation_started";

  if (isPrimaryCompensation) {
    return "compensation_uncertainty";
  }

  const isCommitUncertain =
    operation.phase === "commit_unknown" ||
    operation.phase === "remote_write_started" ||
    primaryEffect?.state === "commit_unknown" ||
    primaryEffect?.state === "started";

  if (isCommitUncertain) {
    return "commit_uncertainty";
  }

  return "normal";
};

export const getRecoveryItemsForOperation = (
  operation: {
    operationId: string;
    kind?: string;
    phase?: string;
    revision?: number;
    intentRevision?: number;
    effects?: DurableSyncEffect[];
    errorMessage?: string;
  },
): RecoveryItem[] => {
  const currentRevision = operation.intentRevision ?? operation.revision ?? 1;
  const activeEffects = getEffectsForRevision(operation, currentRevision);
  const recoveryMode = getOperationRecoveryMode(operation);
  const items: RecoveryItem[] = [];

  for (const effect of activeEffects) {
    const isPrimary =
      isPrimaryEffectKind(effect.kind) ||
      effect.effectId === "ticket-create" ||
      effect.effectId === "ticket-update" ||
      effect.effectId === "comment-create" ||
      effect.effectId === "comment-update";

    if (isPrimary) {
      if (isPrimaryRecoveryRequired(operation, effect)) {
        const allowedActions: RecoveryActionKind[] = [];
        if (effect.state === "compensation_unknown" || effect.state === "compensation_started") {
          allowedActions.push("reconcile_compensation");
        } else if (operation.kind === "ticket_create") {
          allowedActions.push("link_created_ticket");
          if (canRetryEffect(effect)) {
            allowedActions.push("retry_remote_write");
          }
        } else if (operation.kind === "comment_create" || operation.kind === "comment_update") {
          allowedActions.push("reconcile_remote");
          allowedActions.push("link_remote_comment");
        } else {
          allowedActions.push("assume_update_committed");
          allowedActions.push("reconcile_remote");
          allowedActions.push("link_remote_ticket");
          if (canRetryEffect(effect)) {
            allowedActions.push("retry_remote_write");
          }
        }
        items.push({
          operationId: operation.operationId,
          operationRevision: effect.operationRevision,
          effectId: effect.effectId,
          effectKind: effect.kind,
          state: effect.state,
          message: effect.failure?.detail ?? effect.detail ?? operation.errorMessage,
          allowedActions,
        });
      }
    } else {
      if (
        effect.state === "failed" ||
        effect.state === "commit_unknown" ||
        effect.state === "compensation_unknown" ||
        effect.state === "compensation_started"
      ) {
        const allowedActions: RecoveryActionKind[] = [];
        // Dominance rule (R-01, R-02, DR-01):
        // If operation is in compensation uncertainty, secondary forward actions (retry_effect, link_remote_child)
        // are forbidden. Only secondary reconcile_compensation is allowed if secondary is itself in compensation state.
        if (recoveryMode === "compensation_uncertainty") {
          if (effect.state === "compensation_unknown" || effect.state === "compensation_started") {
            allowedActions.push("reconcile_compensation");
          }
        } else {
          if (
            effect.kind === "child_create" ||
            (typeof effect.effectId === "string" && effect.effectId.startsWith("child-create"))
          ) {
            if (effect.state === "compensation_unknown" || effect.state === "compensation_started") {
              allowedActions.push("reconcile_compensation");
            } else if (effect.state === "commit_unknown") {
              allowedActions.push("link_remote_child");
            } else if (effect.state === "failed" && canRetryEffect(effect)) {
              allowedActions.push("retry_effect");
            }
          } else {
            if (effect.state === "compensation_unknown" || effect.state === "compensation_started") {
              allowedActions.push("reconcile_compensation");
            } else if (canRetryEffect(effect)) {
              allowedActions.push("retry_effect");
            }
          }
        }
        items.push({
          operationId: operation.operationId,
          operationRevision: effect.operationRevision,
          effectId: effect.effectId,
          effectKind: effect.kind,
          state: effect.state,
          message: effect.failure?.detail ?? effect.detail,
          allowedActions,
        });
      }
    }
  }

  return items;
};

export const hasUncertainPrimaryDurableSyncEffect = (
  effects: readonly DurableSyncEffect[] | undefined,
): boolean => effects?.some((effect) => isPrimaryEffectKind(effect.kind) && UNCERTAIN_EFFECT_STATES.has(effect.state)) === true;

export const hasUncertainDurableSyncEffect = (
  effects: readonly DurableSyncEffect[] | undefined,
): boolean => effects?.some((effect) => UNCERTAIN_EFFECT_STATES.has(effect.state)) === true;

export const areSnapshotsEqual = (
  a?: SyncEffectRequestSnapshot,
  b?: SyncEffectRequestSnapshot,
): boolean => {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
};

const actionAllowsSource = (
  action: DurableSyncEffectAction,
  effect: DurableSyncEffect,
): boolean => {
  const source = effect.state;
  switch (action.kind) {
    case "start": return source === "planned";
    case "start_explicit_retry":
      if (source === "failed") {
        return effect.failure?.disposition === "retryable";
      }
      return source === "commit_unknown";
    case "commit": return source === "started";
    case "assume_committed": return source === "commit_unknown";
    case "mark_commit_unknown": return source === "started";
    case "mark_failed": return source === "started" || source === "planned";
    case "start_compensation": return source === "committed" || source === "compensation_unknown";
    case "complete_compensation": return source === "compensation_started" || source === "compensation_unknown";
    case "mark_compensation_unknown": return source === "compensation_started" || source === "compensation_unknown";
  }
};

export const transitionDurableSyncEffect = (
  effect: DurableSyncEffect,
  action: DurableSyncEffectAction,
  expected: DurableSyncEffectExpectation,
): DurableSyncEffect | undefined => {
  if (
    effect.operationRevision !== expected.operationRevision ||
    effect.state !== expected.sourceState ||
    !actionAllowsSource(action, effect)
  ) {
    return undefined;
  }
  switch (action.kind) {
    case "start":
    case "start_explicit_retry":
      return {
        ...effect,
        state: "started",
        requestSnapshot: action.requestSnapshot ?? effect.requestSnapshot,
        detail: undefined,
        failure: undefined,
      };
    case "commit":
    case "assume_committed":
      return {
        ...effect,
        state: "committed",
        remoteId: action.remoteId ?? effect.remoteId,
        token: action.token ?? effect.token,
        target: action.target ? { ...effect.target, ...action.target } : effect.target,
        requestSnapshot: action.requestSnapshot ?? effect.requestSnapshot,
        detail: undefined,
        failure: undefined,
      };
    case "mark_commit_unknown":
      return { ...effect, state: "commit_unknown", detail: action.detail, failure: undefined };
    case "mark_failed":
      return {
        ...effect,
        state: "failed",
        detail: action.detail,
        failure: {
          disposition: action.disposition ?? "retryable",
          category: action.category,
          detail: action.detail,
        },
      };
    case "start_compensation":
      return { ...effect, state: "compensation_started", detail: undefined, failure: undefined };
    case "complete_compensation":
      return { ...effect, state: "compensated", detail: undefined, failure: undefined };
    case "mark_compensation_unknown":
      return { ...effect, state: "compensation_unknown", detail: action.detail, failure: undefined };
  }
};
