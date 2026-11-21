import { getPrimaryEffectForRevision, type DurableSyncEffect } from "../app/syncEffects";
import { computeNotesHash } from "../utils/notesHash";
import type { OfflineCommentUpdate, OfflineNewTicket, OfflineTicketUpdate } from "./offlineSyncTypes";

export const promoteTicketIntent = (operation: OfflineTicketUpdate): OfflineTicketUpdate => {
  const next = operation.nextIntent;
  const effects = operation.effects ?? [];
  if (!next) {
    return { ...operation, phase: "queued", nextIntent: undefined, effects };
  }
  return {
    ...operation,
    subject: next.subject,
    description: next.description,
    content: next.content ?? operation.content,
    metadata: next.metadata,
    attachments: next.attachments,
    uploadTokens: next.uploadTokens,
    childTickets: next.childTickets,
    layout: next.layout,
    metadataBlock: next.metadataBlock,
    controlFields: next.controlFields,
    baseDir: next.baseDir ?? operation.baseDir,
    documentUri: next.documentUri ?? operation.documentUri,
    phase: "queued",
    revision: next.revision,
    intentRevision: next.revision,
    nextIntent: undefined,
    effects: effects.filter(isRetainedEffect),
  };
};

export const promoteNewTicketIntent = (operation: OfflineNewTicket): OfflineNewTicket => {
  const next = operation.nextIntent;
  const effects = operation.effects ?? [];
  if (!next) {
    return { ...operation, phase: "queued", nextIntent: undefined, effects };
  }
  return {
    ...operation,
    content: next.content,
    projectId: next.projectId ?? operation.projectId,
    documentUri: next.documentUri ?? operation.documentUri,
    baseDir: next.baseDir ?? operation.baseDir,
    phase: "queued",
    revision: next.revision,
    nextIntent: undefined,
    effects: effects.filter(isRetainedEffect),
  };
};

export const promoteCommentIntent = (operation: OfflineCommentUpdate): OfflineCommentUpdate => {
  const next = operation.nextIntent;
  const effects = operation.effects ?? [];
  if (!next) {
    return { ...operation, phase: "queued", nextIntent: undefined, effects };
  }
  const commentId = operation.commentId ?? operation.createdRemoteId;
  const hasFinalizedDraft = operation.finalizeDraft && commentId !== undefined;
  const primary = getPrimaryEffectForRevision(operation);
  const snapshot = primary?.requestSnapshot;
  const syncedBody = snapshot?.kind === "comment_create"
    ? snapshot.request.notes
    : primary?.target.submittedBody ?? operation.body;
  return {
    ...operation,
    commentId,
    body: next.body,
    baseBody: hasFinalizedDraft ? syncedBody : operation.baseBody,
    sourceNotesHash: hasFinalizedDraft
      ? computeNotesHash(syncedBody)
      : operation.sourceNotesHash,
    finalizeDraft: hasFinalizedDraft ? false : operation.finalizeDraft,
    baseDir: next.baseDir ?? operation.baseDir,
    documentUri: next.documentUri ?? operation.documentUri,
    phase: "queued",
    revision: next.revision,
    intentRevision: next.revision,
    nextIntent: undefined,
    effects: effects.filter(isRetainedEffect),
  };
};
const isRetainedEffect = ({ state }: DurableSyncEffect): boolean =>
  state === "committed" || state === "commit_unknown" ||
  state === "compensation_unknown" || state === "compensation_started";

