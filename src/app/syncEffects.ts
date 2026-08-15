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
};

export type DurableSyncEffect = {
  effectId: string;
  kind: DurableSyncEffectKind;
  operationRevision: number;
  state: DurableSyncEffectState;
  target: DurableSyncEffectTarget;
  remoteId?: number;
  token?: string;
  detail?: string;
};

export type DurableSyncEffectExpectation = {
  operationRevision: number;
  sourceState: DurableSyncEffectState;
};

export type DurableSyncEffectAction =
  | { kind: "start" }
  | { kind: "start_explicit_retry" }
  | { kind: "commit"; remoteId?: number; token?: string; target?: DurableSyncEffectTarget }
  | { kind: "assume_committed"; remoteId?: number; token?: string; target?: DurableSyncEffectTarget }
  | { kind: "mark_commit_unknown"; detail?: string }
  | { kind: "mark_failed"; detail?: string }
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
): DurableSyncEffect => ({
  ...effect,
  // A restart can happen after a request left the client but before its
  // result was journaled. A durable `started` checkpoint is never retryable.
  state: effect.state === "started" ? "commit_unknown" : effect.state,
  target: { ...effect.target },
});

export const hasUncertainDurableSyncEffect = (
  effects: readonly DurableSyncEffect[] | undefined,
): boolean => effects?.some((effect) => UNCERTAIN_EFFECT_STATES.has(effect.state)) === true;

const actionAllowsSource = (
  action: DurableSyncEffectAction,
  source: DurableSyncEffectState,
): boolean => {
  switch (action.kind) {
    case "start": return source === "planned";
    case "start_explicit_retry": return source === "commit_unknown";
    case "commit": return source === "started";
    case "assume_committed": return source === "commit_unknown";
    case "mark_commit_unknown": return source === "started";
    case "mark_failed": return source === "started";
    case "start_compensation": return source === "committed";
    case "complete_compensation": return source === "compensation_started";
    case "mark_compensation_unknown": return source === "compensation_started";
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
    !actionAllowsSource(action, expected.sourceState)
  ) {
    return undefined;
  }
  switch (action.kind) {
    case "start":
    case "start_explicit_retry":
      return { ...effect, state: "started", detail: undefined };
    case "commit":
    case "assume_committed":
      return {
        ...effect,
        state: "committed",
        remoteId: action.remoteId ?? effect.remoteId,
        token: action.token ?? effect.token,
        target: action.target ? { ...effect.target, ...action.target } : effect.target,
        detail: undefined,
      };
    case "mark_commit_unknown":
      return { ...effect, state: "commit_unknown", detail: action.detail };
    case "mark_failed":
      return { ...effect, state: "failed", detail: action.detail };
    case "start_compensation":
      return { ...effect, state: "compensation_started", detail: undefined };
    case "complete_compensation":
      return { ...effect, state: "compensated", detail: undefined };
    case "mark_compensation_unknown":
      return { ...effect, state: "compensation_unknown", detail: action.detail };
  }
};
