import {
  evaluateAttemptClosure,
  getAttemptGeneration,
  normalizeAttemptGeneration,
} from "../app/syncEffects";
import type { TicketEditorContent } from "./ticketEditorContent";
import { promoteCommentIntent, promoteNewTicketIntent, promoteTicketIntent } from "./offlineSyncIntentPromotion";
import {
  commentActionAllowsSource,
  isAbandoned,
  newTicketActionAllowsSource,
  ticketUpdateActionAllowsSource,
} from "./offlineSyncPolicy";
import { primaryEffectId, withPlannedPrimaryEffect, withPrimaryEffectTransition } from "./offlineSyncPrimaryEffects";
import { findCommentIndex, findNewTicketIndex } from "./offlineSyncQueueEntries";
import { commitQueueMutation, mutateQueueAsync, skipQueueMutation } from "./offlineSyncQueueStorage";
import type {
  CommentLifecycleAction,
  CommentQueueKey,
  LifecycleTransitionExpectation,
  NewTicketLifecycleAction,
  NewTicketSyncPhase,
  OfflineCommentUpdate,
  OfflineNewTicket,
  OfflineTicketUpdate,
  StoredOfflineOperation,
  SyncOperationKind,
  TicketUpdateLifecycleAction,
  TicketUpdateSyncPhase,
} from "./offlineSyncTypes";

const matchesLifecycleSnapshot = (
  current: StoredOfflineOperation,
  scope: string,
  expected: LifecycleTransitionExpectation<NewTicketSyncPhase | TicketUpdateSyncPhase>,
): boolean =>
  current.revision === expected.revision &&
  (expected.attemptGeneration === undefined ||
    getAttemptGeneration(current) === normalizeAttemptGeneration(expected.attemptGeneration)) &&
  current.phase === expected.sourcePhase &&
  (current.connectionScope === undefined || current.connectionScope === scope);

export const transitionOfflineNewTicketLifecycleAsync = async (
  key: { queueId?: string; documentUri?: string },
  action: NewTicketLifecycleAction,
  scope: string,
  expected: LifecycleTransitionExpectation<NewTicketSyncPhase>,
): Promise<OfflineNewTicket | undefined> => {
  try {
    return await mutateQueueAsync(scope, (queue) => {
      const index = findNewTicketIndex(queue, key);
      const current = index === -1 ? undefined : queue.newTickets[index];
      if (
        !current ||
        (current.operationId !== undefined && expected.operationId !== undefined && current.operationId !== expected.operationId) ||
        !matchesLifecycleSnapshot(current, scope, expected) ||
        !newTicketActionAllowsSource(action, expected.sourcePhase)
      ) {
        return skipQueueMutation(undefined);
      }
      let next: OfflineNewTicket;
      switch (action.kind) {
        case "begin_preparation":
          next = {
            ...withPlannedPrimaryEffect(current, "ticketCreate", {}),
            phase: "preparing",
          };
          break;
        case "abort_before_remote_write":
          next = promoteNewTicketIntent(current);
          break;
        case "start_normal_remote_write":
        case "start_explicit_retry_remote_write": {
          const transitioned = withPrimaryEffectTransition(
            current,
            "ticketCreate",
            action.kind === "start_normal_remote_write"
              ? { kind: "start" }
              : { kind: "start_explicit_retry" },
            action.kind === "start_normal_remote_write" ? "planned" : "commit_unknown",
          );
          if (!transitioned) { return skipQueueMutation(undefined); }
          next = { ...transitioned, phase: "remote_write_started" };
          break;
        }
        case "mark_commit_unknown": {
          const transitioned = withPrimaryEffectTransition(
            current,
            "ticketCreate",
            { kind: "mark_commit_unknown" },
            "started",
          );
          if (!transitioned) { return skipQueueMutation(undefined); }
          next = { ...transitioned, phase: "commit_unknown" };
          break;
        }
        case "record_remote_created":
        case "link_created_ticket": {
          const transitioned = withPrimaryEffectTransition(
            current,
            "ticketCreate",
            action.kind === "record_remote_created"
              ? { kind: "commit", remoteId: action.ticketId }
              : { kind: "assume_committed", remoteId: action.ticketId },
            action.kind === "record_remote_created" ? "started" : "commit_unknown",
          );
          if (!transitioned) { return skipQueueMutation(undefined); }
          next = { ...transitioned, createdIssueId: action.ticketId, phase: "remote_created" };
          break;
        }
        case "mark_reconciliation_pending":
          next = {
            ...current,
            phase: "reconciliation_pending",
            remoteUpdatedAt: action.remoteUpdatedAt,
          };
          break;
        case "mark_local_finalize_pending":
          next = {
            ...current,
            phase: "local_finalize_pending",
            remoteUpdatedAt: action.remoteUpdatedAt,
          };
          break;
        case "mark_compensation_pending":
          next = { ...current, phase: "reconciliation_pending" };
          break;
        case "complete_compensation":
          {
            const currentAttemptGeneration = getAttemptGeneration(current);
            const closureDecision = evaluateAttemptClosure(
              current,
              current.revision,
              currentAttemptGeneration,
            );
            if (!closureDecision.closable) {
              return skipQueueMutation(undefined);
            }
            const futureEffects = (current.effects ?? []).filter(
              (effect) => normalizeAttemptGeneration(effect.attemptGeneration) > currentAttemptGeneration,
            );
            const promoted = current.nextIntent
              ? {
                ...current,
                content: current.nextIntent.content,
                projectId: current.nextIntent.projectId ?? current.projectId,
                documentUri: current.nextIntent.documentUri ?? current.documentUri,
                baseDir: current.nextIntent.baseDir ?? current.baseDir,
                revision: current.nextIntent.revision,
                nextIntent: undefined,
              }
              : { ...current, nextIntent: undefined };
            next = {
              ...promoted,
              createdIssueId: undefined,
              createdChildIds: undefined,
              status: undefined,
              remoteUpdatedAt: undefined,
              attemptGeneration: currentAttemptGeneration + 1,
              phase: "queued",
              effects: futureEffects,
            };
          }
          break;
      }
      queue.newTickets[index] = next;
      return commitQueueMutation(next);
    });
  } catch {
    return undefined;
  }
};

export const abortOfflineNewTicketBeforeRemoteWriteAsync = async (
  key: { queueId?: string; documentUri?: string },
  scope: string,
  expectedRevision: number,
): Promise<OfflineNewTicket | undefined> => {
  try {
    return await mutateQueueAsync(scope, (queue) => {
      const index = findNewTicketIndex(queue, key);
      const current = index === -1 ? undefined : queue.newTickets[index];
      if (!current || current.revision !== expectedRevision || current.phase !== "preparing") {
        return skipQueueMutation(undefined);
      }
      const next = promoteNewTicketIntent(current);
      queue.newTickets[index] = next;
      return commitQueueMutation(next);
    });
  } catch {
    return undefined;
  }
};

export const completeOfflineNewTicketAsync = async (
  key: { queueId?: string; documentUri?: string },
  scope: string,
  promotion?: OfflineTicketUpdate & { sourceRevision?: number },
  expectedRevision?: number,
): Promise<boolean> => {
  try {
    return await mutateQueueAsync(scope, (queue) => {
      const index = findNewTicketIndex(queue, key);
      if (index === -1) {
        return skipQueueMutation(true);
      }
      const current = queue.newTickets[index];
      if (isAbandoned(current)) { return skipQueueMutation(false); }
      if (expectedRevision === undefined || current.revision !== expectedRevision) {
        return skipQueueMutation(false);
      }
      if (current.nextIntent && (
        !promotion ||
        (current.nextIntent.revision !== undefined && promotion.sourceRevision !== current.nextIntent.revision)
      )) {
        return skipQueueMutation(false);
      }
      queue.newTickets.splice(index, 1);
      if (promotion) {
        const { sourceRevision: _sourceRevision, ...ticketUpdate } = promotion;
        queue.tickets.set(promotion.ticketId, ticketUpdate);
      }
      return commitQueueMutation(true);
    });
  } catch {
    return false;
  }
};

export const transitionOfflineTicketUpdateLifecycleAsync = async (
  ticketId: number,
  action: TicketUpdateLifecycleAction,
  scope: string,
  expected: LifecycleTransitionExpectation<TicketUpdateSyncPhase>,
): Promise<OfflineTicketUpdate | undefined> => {
  try {
    return await mutateQueueAsync(scope, (queue) => {
      const current = queue.tickets.get(ticketId);
      if (
        !current ||
        current.operationId !== expected.operationId ||
        !matchesLifecycleSnapshot(current, scope, expected) ||
        !ticketUpdateActionAllowsSource(action, expected.sourcePhase)
      ) {
        return skipQueueMutation(undefined);
      }
      let next: OfflineTicketUpdate;
      switch (action.kind) {
        case "begin_preparation":
          next = {
            ...withPlannedPrimaryEffect(current, "ticketUpdate", { ticketId }),
            phase: "preparing",
            remoteUpdatedAt: undefined,
          };
          break;
        case "abort_before_remote_write":
          next = promoteTicketIntent(current);
          break;
        case "start_normal_remote_write":
        case "start_explicit_retry_remote_write": {
          const transitioned = withPrimaryEffectTransition(
            current,
            "ticketUpdate",
            action.kind === "start_normal_remote_write"
              ? { kind: "start" }
              : { kind: "start_explicit_retry" },
            action.kind === "start_normal_remote_write" ? "planned" : "commit_unknown",
          );
          if (!transitioned) { return skipQueueMutation(undefined); }
          next = { ...transitioned, phase: "remote_write_started", remoteUpdatedAt: undefined };
          break;
        }
        case "mark_commit_unknown": {
          const transitioned = withPrimaryEffectTransition(
            current,
            "ticketUpdate",
            { kind: "mark_commit_unknown" },
            "started",
          );
          if (!transitioned) { return skipQueueMutation(undefined); }
          next = { ...transitioned, phase: "commit_unknown", remoteUpdatedAt: undefined };
          break;
        }
        case "record_remote_commit": {
          const transitioned = withPrimaryEffectTransition(
            current,
            "ticketUpdate",
            { kind: "commit" },
            "started",
          );
          if (!transitioned) { return skipQueueMutation(undefined); }
          next = {
            ...transitioned,
            phase: "remote_committed",
            remoteUpdatedAt: undefined,
            createdChildIds: action.createdChildIds,
          };
          break;
        }
        case "assume_update_committed": {
          const transitioned = withPrimaryEffectTransition(
            current,
            "ticketUpdate",
            { kind: "assume_committed" },
            "commit_unknown",
          );
          if (!transitioned) { return skipQueueMutation(undefined); }
          next = { ...transitioned, phase: "remote_committed", remoteUpdatedAt: undefined };
          break;
        }
        case "mark_reconciliation_pending":
          next = {
            ...current,
            phase: "reconciliation_pending",
            remoteUpdatedAt: action.remoteUpdatedAt,
          };
          break;
        case "mark_local_finalize_pending":
          next = {
            ...current,
            phase: "local_finalize_pending",
            remoteUpdatedAt: action.remoteUpdatedAt,
          };
          break;
        case "mark_compensation_pending":
          next = { ...current, phase: "reconciliation_pending" };
          break;
      }
      queue.tickets.set(ticketId, next);
      return commitQueueMutation(next);
    });
  } catch {
    return undefined;
  }
};

export const abortOfflineTicketUpdateBeforeRemoteWriteAsync = async (
  ticketId: number,
  scope: string,
  expectedRevision: number,
): Promise<OfflineTicketUpdate | undefined> => {
  try {
    return await mutateQueueAsync(scope, (queue) => {
      const current = queue.tickets.get(ticketId);
      if (!current || current.revision !== expectedRevision || current.phase !== "preparing") {
        return skipQueueMutation(undefined);
      }
      const next = promoteTicketIntent(current);
      queue.tickets.set(ticketId, next);
      return commitQueueMutation(next);
    });
  } catch {
    return undefined;
  }
};

export const completeOfflineTicketUpdateAsync = async (
  ticketId: number,
  scope: string,
  completion?: { canonical: TicketEditorContent; remoteUpdatedAt: string },
  expectedRevision?: number,
): Promise<boolean> => {
  try {
    return await mutateQueueAsync(scope, (queue) => {
      const current = queue.tickets.get(ticketId);
      if (!current) {
        return skipQueueMutation(true);
      }
      if (isAbandoned(current)) { return skipQueueMutation(false); }
      if (expectedRevision === undefined || (current.intentRevision ?? current.revision) !== expectedRevision) {
        return skipQueueMutation(false);
      }
      if (current.nextIntent) {
        const next = current.nextIntent;
        const canonical = completion?.canonical;
        queue.tickets.set(ticketId, {
          ticketId,
          baseSubject: canonical?.subject ?? current.baseSubject,
          baseDescription: canonical?.description ?? current.baseDescription,
          baseMetadata: canonical?.metadata ?? current.baseMetadata,
          lastKnownRemoteUpdatedAt: completion?.remoteUpdatedAt ?? current.lastKnownRemoteUpdatedAt,
          subject: next.subject,
          description: next.description,
          metadata: next.metadata,
          attachments: next.attachments,
          uploadTokens: next.uploadTokens,
          childTickets: next.childTickets,
          content: next.content ?? current.content,
          layout: next.layout ?? canonical?.layout ?? current.layout,
          metadataBlock: next.metadataBlock ?? canonical?.metadataBlock ?? current.metadataBlock,
          controlFields: next.controlFields ?? canonical?.controlFields ?? current.controlFields,
          baseDir: next.baseDir ?? current.baseDir,
          documentUri: next.documentUri ?? current.documentUri,
          operationId: current.operationId,
          connectionScope: current.connectionScope ?? scope,
          phase: "queued",
          revision: next.revision ?? (current.revision ?? 0) + 1,
          intentRevision: next.revision ?? (current.intentRevision ?? current.revision ?? 0) + 1,
          attemptGeneration: getAttemptGeneration(current),
        });
      } else {
        queue.tickets.delete(ticketId);
      }
      return commitQueueMutation(true);
    });
  } catch {
    return false;
  }
};

export const transitionOfflineCommentLifecycleAsync = async (
  key: CommentQueueKey,
  action: CommentLifecycleAction,
  scope: string,
  expected: LifecycleTransitionExpectation<TicketUpdateSyncPhase>,
): Promise<OfflineCommentUpdate | undefined> => {
  try {
    return await mutateQueueAsync(scope, (queue) => {
      const index = findCommentIndex(queue, key);
      const current = index === -1 ? undefined : queue.comments[index];
      if (
        !current ||
        current.operationId !== expected.operationId ||
        !matchesLifecycleSnapshot(current, scope, expected) ||
        !commentActionAllowsSource(action, expected.sourcePhase)
      ) {
        return skipQueueMutation(undefined);
      }
      const operationKind: SyncOperationKind = current.commentId === undefined
        ? "commentCreate"
        : "commentUpdate";
      let next: OfflineCommentUpdate;
      switch (action.kind) {
        case "begin_preparation":
          next = {
            ...withPlannedPrimaryEffect(current, operationKind, {
              ticketId: current.ticketId,
              commentId: current.commentId,
            }),
            phase: "preparing",
          };
          break;
        case "abort_before_remote_write":
        case "abort_known_remote_failure":
          next = promoteCommentIntent(current);
          break;
        case "start_normal_remote_write": {
          const transitioned = withPrimaryEffectTransition(
            current,
            operationKind,
            { kind: "start" },
            "planned",
          );
          if (!transitioned) { return skipQueueMutation(undefined); }
          next = { ...transitioned, phase: "remote_write_started" };
          break;
        }
        case "mark_commit_unknown": {
          const transitioned = withPrimaryEffectTransition(
            current,
            operationKind,
            { kind: "mark_commit_unknown" },
            "started",
          );
          if (!transitioned) { return skipQueueMutation(undefined); }
          next = { ...transitioned, phase: "commit_unknown" };
          break;
        }
        case "assume_remote_commit": {
          const transitioned = withPrimaryEffectTransition(
            current,
            operationKind,
            { kind: "assume_committed", remoteId: action.commentId },
            "commit_unknown",
          );
          if (!transitioned) { return skipQueueMutation(undefined); }
          next = {
            ...transitioned,
            phase: "remote_committed",
            commentId: action.commentId,
            remoteProjectId: action.projectId,
          };
          break;
        }
        case "record_remote_commit": {
          const transitioned = withPrimaryEffectTransition(
            current,
            operationKind,
            { kind: "commit", remoteId: action.commentId },
            "started",
          );
          if (!transitioned) { return skipQueueMutation(undefined); }
          next = {
            ...transitioned,
            phase: "remote_committed",
            commentId: action.commentId ?? current.commentId,
            remoteProjectId: action.projectId ?? current.remoteProjectId,
          };
          break;
        }
        case "record_reconciled_identity":
          next = {
            ...current,
            commentId: action.commentId,
            remoteProjectId: action.projectId ?? current.remoteProjectId,
            effects: current.effects?.map((effect) => effect.effectId === primaryEffectId(operationKind)
              ? { ...effect, remoteId: action.commentId }
              : effect),
          };
          break;
        case "mark_reconciliation_pending":
          next = { ...current, phase: "reconciliation_pending" };
          break;
        case "mark_local_finalize_pending":
          next = { ...current, phase: "local_finalize_pending" };
          break;
      }
      queue.comments[index] = next;
      return commitQueueMutation(next);
    });
  } catch {
    return undefined;
  }
};

export const completeOfflineCommentAsync = async (
  key: CommentQueueKey,
  scope: string,
  expectedRevision: number,
): Promise<boolean> => {
  try {
    return await mutateQueueAsync(scope, (queue) => {
      const index = findCommentIndex(queue, key);
      if (index === -1) { return skipQueueMutation(true); }
      const current = queue.comments[index];
      if (isAbandoned(current)) { return skipQueueMutation(false); }
      if ((current.intentRevision ?? current.revision) !== expectedRevision) { return skipQueueMutation(false); }
      queue.comments = current.nextIntent
        ? queue.comments.map((comment, currentIndex) =>
          currentIndex === index ? promoteCommentIntent(comment) : comment)
        : queue.comments.filter((_, currentIndex) => currentIndex !== index);
      return commitQueueMutation(true);
    });
  } catch {
    return false;
  }
};
