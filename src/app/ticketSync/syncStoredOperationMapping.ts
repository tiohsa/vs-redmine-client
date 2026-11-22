import type {
  GenericSyncPhase,
  SyncOperationKey,
  TicketCreateIntent,
  TicketUpdateIntent,
  CommentCreateIntent,
  CommentUpdateIntent,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import {
  getAttemptGeneration,
  getPrimaryEffectForRevision,
} from "../syncEffects";
import {
  isAbandoned,
  resolveStoredOfflineOperation,
  type OfflineCommentUpdate,
  type OfflineNewTicket,
  type OfflineTicketUpdate,
  type OfflineSyncQueue,
  type ResolvedStoredOperation,
} from "../../views/offlineSyncStore";
import {
  parseTicketEditorContent,
  type TicketEditorContent,
} from "../../views/ticketEditorContent";

export const toUnifiedOperationFromTicket = (
  ticket: OfflineTicketUpdate,
  scope: string,
): UnifiedSyncOperation<TicketUpdateIntent> => ({
  operationId: ticket.operationId ?? `${scope}:ticket:${ticket.ticketId}`,
  kind: "ticket_update",
  key: { kind: "ticket", ticketId: ticket.ticketId },
  connectionScope: scope,
  phase: (ticket.phase ?? "queued") as GenericSyncPhase,
  revision: (ticket as any).intentRevision ?? ticket.revision ?? 1,
  intentRevision: (ticket as any).intentRevision ?? ticket.revision ?? 1,
  version: (ticket as any).version ?? (ticket as any).persistenceVersion ?? ticket.revision ?? 1,
  persistenceVersion: (ticket as any).persistenceVersion ?? (ticket as any).version ?? ticket.revision ?? 1,
  attemptGeneration: getAttemptGeneration(ticket),
  ticketId: ticket.ticketId,
  projectId: (ticket as any).projectId ?? (ticket as any).metadata?.project_id,
  documentUri: ticket.documentUri,
  createdChildIds: ticket.createdChildIds,
  effects: ticket.effects,
  intent: {
    ticketId: ticket.ticketId,
    baseSubject: ticket.baseSubject,
    baseDescription: ticket.baseDescription,
    baseMetadata: ticket.baseMetadata,
    subject: ticket.subject ?? (ticket as any).baseSubject ?? "",
    description: ticket.description ?? (ticket as any).baseDescription ?? "",
    metadata: ticket.metadata ?? ticket.baseMetadata,
    content: ticket.content,
    attachments: (ticket as any).attachments,
    uploadTokens: (ticket as any).uploadTokens,
    childTickets: (ticket as any).childTickets,
    layout: ticket.layout,
    metadataBlock: ticket.metadataBlock,
    controlFields: ticket.controlFields,
    baseDir: ticket.baseDir,
    documentUri: ticket.documentUri,
    lastKnownRemoteUpdatedAt: ticket.lastKnownRemoteUpdatedAt,
  },
  nextIntent: ticket.nextIntent ? {
    ticketId: ticket.ticketId,
    baseSubject: ticket.baseSubject,
    baseDescription: ticket.baseDescription,
    baseMetadata: ticket.baseMetadata,
    subject: ticket.nextIntent.subject,
    description: ticket.nextIntent.description,
    content: ticket.nextIntent.content,
    metadata: ticket.nextIntent.metadata,
    attachments: ticket.nextIntent.attachments,
    uploadTokens: ticket.nextIntent.uploadTokens,
    childTickets: ticket.nextIntent.childTickets,
    revision: ticket.nextIntent.revision,
    layout: ticket.nextIntent.layout ?? ticket.layout,
    metadataBlock: ticket.nextIntent.metadataBlock ?? ticket.metadataBlock,
    controlFields: ticket.nextIntent.controlFields ?? ticket.controlFields,
    baseDir: ticket.nextIntent.baseDir ?? ticket.baseDir,
    documentUri: ticket.nextIntent.documentUri ?? ticket.documentUri,
  } : undefined,
  remoteUpdatedAt: ticket.lastKnownRemoteUpdatedAt,
  createdAt: ticket.createdAt ?? Date.now(),
  updatedAt: ticket.createdAt ?? Date.now(),
});

export const toUnifiedOperationFromNewTicket = (
  ticket: OfflineNewTicket,
  scope: string,
): UnifiedSyncOperation<TicketCreateIntent> => {
  let parsed: TicketEditorContent | undefined;
  if (ticket.content) {
    try {
      parsed = parseTicketEditorContent(ticket.content, {
        allowEmptyStatus: true,
        allowMissingMetadata: true,
        allowMissingSubject: true,
        fallbackMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
      });
    } catch {
      parsed = {
        subject: (ticket as any).subject ?? "",
        description: ticket.content,
        metadata: (ticket as any).metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
      };
    }
  }

  let nextParsed: TicketEditorContent | undefined;
  if (ticket.nextIntent?.content) {
    try {
      nextParsed = parseTicketEditorContent(ticket.nextIntent.content, {
        allowEmptyStatus: true,
        allowMissingMetadata: true,
        allowMissingSubject: true,
        fallbackMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
      });
    } catch {
      nextParsed = {
        subject: (ticket.nextIntent as any).subject ?? "",
        description: ticket.nextIntent.content,
        metadata: (ticket.nextIntent as any).metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
      };
    }
  }

  const rawPhase = ticket.phase ?? "queued";
  const phase: GenericSyncPhase =
    rawPhase === "remote_created" ||
    (rawPhase === "local_finalize_pending" && ticket.createdIssueId !== undefined && !(ticket as any).canonical?.ticket)
      ? "remote_committed"
      : (rawPhase as GenericSyncPhase);

  return {
    operationId: ticket.operationId ?? ticket.queueId ?? `${scope}:newTicket:${ticket.documentUri ?? ticket.projectId ?? "0"}`,
    kind: "ticket_create",
    key: { kind: "newTicket", queueId: ticket.queueId, documentUri: ticket.documentUri },
    connectionScope: scope,
    phase,
    revision: (ticket as any).intentRevision ?? (ticket.revision !== undefined && ticket.revision > 0 ? ticket.revision : 1),
    intentRevision: (ticket as any).intentRevision ?? (ticket.revision !== undefined && ticket.revision > 0 ? ticket.revision : 1),
    version: (ticket as any).version ?? (ticket as any).persistenceVersion ?? ticket.revision ?? 1,
    persistenceVersion: (ticket as any).persistenceVersion ?? (ticket as any).version ?? ticket.revision ?? 1,
    attemptGeneration: getAttemptGeneration(ticket),
    projectId: ticket.projectId,
    documentUri: ticket.documentUri,
    errorMessage: ticket.preparationFailure,
    createdRemoteId: ticket.createdIssueId,
    effects: ticket.effects,
    intent: {
      projectId: ticket.projectId ?? 0,
      content: ticket.content ?? "",
      baseDir: ticket.baseDir,
      documentUri: ticket.documentUri,
      subject: parsed?.subject ?? (ticket as any).subject ?? "",
      description: parsed?.description ?? ticket.content ?? "",
      metadata: parsed?.metadata ?? (ticket as any).metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
      attachments: (ticket as any).attachments,
      uploadTokens: (ticket as any).uploadTokens,
      childTickets: (ticket as any).childTickets,
      layout: parsed?.layout ?? (ticket as any).layout,
      metadataBlock: parsed?.metadataBlock ?? (ticket as any).metadataBlock,
      controlFields: parsed?.controlFields ?? (ticket as any).controlFields,
    },
    nextIntent: ticket.nextIntent ? {
      projectId: ticket.nextIntent.projectId ?? ticket.projectId ?? 0,
      content: ticket.nextIntent.content,
      revision: ticket.nextIntent.revision,
      baseDir: ticket.nextIntent.baseDir ?? ticket.baseDir,
      documentUri: ticket.nextIntent.documentUri ?? ticket.documentUri,
      subject: nextParsed?.subject ?? (ticket.nextIntent as any).subject ?? "",
      description: nextParsed?.description ?? ticket.nextIntent.content ?? "",
      metadata: nextParsed?.metadata ?? (ticket.nextIntent as any).metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
      layout: nextParsed?.layout ?? (ticket.nextIntent as any).layout,
      metadataBlock: nextParsed?.metadataBlock ?? (ticket.nextIntent as any).metadataBlock,
      controlFields: nextParsed?.controlFields ?? (ticket.nextIntent as any).controlFields,
    } : undefined,
    createdAt: ticket.createdAt ?? Date.now(),
    updatedAt: ticket.createdAt ?? Date.now(),
  };
};

export const toUnifiedOperationFromComment = (
  comment: OfflineCommentUpdate,
  scope: string,
): UnifiedSyncOperation<CommentCreateIntent | CommentUpdateIntent> => {
  const primary = getPrimaryEffectForRevision(comment);
  const kind = primary?.kind === "comment_create" || primary?.kind === "comment_update"
    ? primary.kind
    : comment.commentId !== undefined ? "comment_update" : "comment_create";
  const persistedRemoteId = "createdRemoteId" in comment && typeof comment.createdRemoteId === "number"
    ? comment.createdRemoteId
    : undefined;

  return ({
  operationId: comment.operationId ?? `${scope}:comment:${comment.ticketId}:${comment.commentId ?? comment.documentUri}`,
  kind,
  key: { kind: "comment", ticketId: comment.ticketId, commentId: comment.commentId, documentUri: comment.documentUri, operationId: comment.operationId },
  connectionScope: scope,
  phase: (comment.phase ?? "queued") as GenericSyncPhase,
  revision: (comment as any).intentRevision ?? comment.revision ?? 1,
  intentRevision: (comment as any).intentRevision ?? comment.revision ?? 1,
  version: (comment as any).version ?? (comment as any).persistenceVersion ?? comment.revision ?? 1,
  persistenceVersion: (comment as any).persistenceVersion ?? (comment as any).version ?? comment.revision ?? 1,
  attemptGeneration: getAttemptGeneration(comment),
  ticketId: comment.ticketId,
  commentId: comment.commentId,
  documentUri: comment.documentUri,
  createdRemoteId: kind === "comment_create"
    ? persistedRemoteId ?? primary?.remoteId ?? comment.commentId
    : undefined,
  projectId: comment.remoteProjectId,
  effects: comment.effects,
  intent: (kind === "comment_update" ? {
    ticketId: comment.ticketId,
    commentId: comment.commentId,
    baseBody: comment.baseBody,
    body: comment.body ?? "",
    baseDir: comment.baseDir,
    documentUri: comment.documentUri,
    sourceNotesHash: comment.sourceNotesHash,
    finalizeDraft: comment.finalizeDraft,
    lastKnownRemoteUpdatedAt: comment.lastKnownRemoteUpdatedAt,
  } : {
    ticketId: comment.ticketId,
    body: comment.body ?? "",
    baseDir: comment.baseDir,
    documentUri: comment.documentUri,
    sourceNotesHash: comment.sourceNotesHash,
    finalizeDraft: comment.finalizeDraft,
  }) as any,
  nextIntent: comment.nextIntent ? (kind === "comment_update" ? {
    ticketId: comment.ticketId,
    commentId: comment.commentId,
    baseBody: comment.baseBody,
    body: comment.nextIntent.body,
    baseDir: comment.nextIntent.baseDir,
    documentUri: comment.nextIntent.documentUri,
    sourceNotesHash: comment.sourceNotesHash,
    lastKnownRemoteUpdatedAt: comment.lastKnownRemoteUpdatedAt,
  } : {
    ticketId: comment.ticketId,
    body: comment.nextIntent.body,
    baseDir: comment.nextIntent.baseDir,
    documentUri: comment.nextIntent.documentUri,
    sourceNotesHash: comment.sourceNotesHash,
  }) as any : undefined,
  createdAt: comment.createdAt ?? Date.now(),
  updatedAt: comment.createdAt ?? Date.now(),
  });
};

export const toUnifiedOperationFromStored = (
  stored: ResolvedStoredOperation,
  scope: string,
): UnifiedSyncOperation | undefined => {
  if (isAbandoned(stored.value)) { return undefined; }
  switch (stored.kind) {
    case "ticket": return toUnifiedOperationFromTicket(stored.value, scope);
    case "newTicket": return toUnifiedOperationFromNewTicket(stored.value, scope);
    case "comment": return toUnifiedOperationFromComment(stored.value, scope);
  }
};

export const getOperationFromQueue = (
  queue: OfflineSyncQueue,
  key: SyncOperationKey,
  scope: string,
): UnifiedSyncOperation | undefined => {
  const stored = resolveStoredOfflineOperation(queue, key);
  return stored ? toUnifiedOperationFromStored(stored, scope) : undefined;
};

