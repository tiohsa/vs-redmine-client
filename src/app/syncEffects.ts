export {
  evaluateAttemptClosure,
  isAttemptClosureSafe,
  type AttemptClosureBlocker,
  type AttemptClosureBlockerReason,
  type AttemptClosureClassification,
  type AttemptClosureDecision,
  type AttemptClosureEvaluationOperation,
  type AttemptEffectClassification,
  type AttemptEffectCoverage,
} from "./syncEffects/attemptClosure";
export { DEFAULT_ATTEMPT_GENERATION, getAttemptGeneration, normalizeAttemptGeneration } from "./syncEffects/attemptGeneration";
export { canRetryEffect, canRetryFailedCommentEffect, isRejectedTicketCreate } from "./syncEffects/effectRetry";
export {
  getEffectsForRevision,
  getPrimaryEffectForRevision,
  hasUncertainDurableSyncEffect,
  hasUncertainPrimaryDurableSyncEffect,
  isPrimaryEffectKind,
} from "./syncEffects/effectSelection";
export { areSnapshotsEqual, restoreDurableSyncEffect, transitionDurableSyncEffect } from "./syncEffects/effectTransition";
export type {
  AttachmentLinkRequestSnapshot,
  ChildTicketCreateRequestSnapshot,
  CommentCreateRequestSnapshot,
  CommentUpdateRequestSnapshot,
  DurableSyncEffect,
  DurableSyncEffectAction,
  DurableSyncEffectExpectation,
  DurableSyncEffectKind,
  DurableSyncEffectState,
  DurableSyncEffectTarget,
  EffectFailureInfo,
  FailureDisposition,
  SyncEffectRequestSnapshot,
  TicketCreateRequestSnapshot,
  TicketUpdateRequestSnapshot,
  UploadRequestSnapshot,
} from "./syncEffects/effectTypes";
export {
  getOperationRecoveryMode,
  getRecoveryItemsForOperation,
  isEffectBlockingNormalSync,
  isPrimaryRecoveryRequired,
  type OperationRecoveryMode,
  type RecoveryActionKind,
  type RecoveryDisposition,
  type RecoveryItem,
} from "./syncEffects/recoveryPolicy";
