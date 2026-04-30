import { TicketDraftState, TicketDraftStatus } from "./ticketSaveTypes";
import { applyTicketEditorDefaults, TicketEditorContent } from "./ticketEditorContent";
import { getTicketEditorDefaults } from "./ticketEditorDefaultsStore";
import { IssueMetadata, isIssueMetadataEqual } from "./ticketMetadataTypes";
import { Ticket } from "../redmine/types";
import { createInMemoryDraftStorage, DraftStorage } from "./draftPersistence";

// インメモリキャッシュ（高速読み取り用）
let cache = new Map<number, TicketDraftState>();
let persistentStorage: DraftStorage = createInMemoryDraftStorage();

/** 起動時に永続ストレージを注入し、保存済みドラフトをキャッシュに読み込む */
export const initializeDraftStore = (storage: DraftStorage): void => {
  persistentStorage = storage;
  cache = storage.loadAll();
};

const persist = (ticketId: number, draft: TicketDraftState): void => {
  persistentStorage.save(ticketId, draft);
};

export const getTicketDraft = (ticketId: number): TicketDraftState | undefined =>
  cache.get(ticketId);

export interface NewTicketInitialValues {
  subject?: string;
  description?: string;
  tracker?: string;
  priority?: string;
  status?: string;
  start_date?: string;
  due_date?: string;
  parent?: number;
}

export const buildNewTicketDraftContent = (options?: {
  draftId?: string;
  projectId?: number;
  initialValues?: NewTicketInitialValues;
}): TicketEditorContent => {
  const base = applyTicketEditorDefaults(getTicketEditorDefaults());
  const iv = options?.initialValues;
  return {
    ...base,
    subject: iv?.subject !== undefined ? iv.subject : base.subject,
    description: iv?.description !== undefined ? iv.description : base.description,
    metadata: {
      ...base.metadata,
      ...(iv?.tracker !== undefined ? { tracker: iv.tracker } : {}),
      ...(iv?.priority !== undefined ? { priority: iv.priority } : {}),
      ...(iv?.status !== undefined ? { status: iv.status } : {}),
      ...(iv?.start_date !== undefined ? { start_date: iv.start_date } : {}),
      ...(iv?.due_date !== undefined ? { due_date: iv.due_date } : {}),
      ...(iv?.parent !== undefined ? { parent: iv.parent } : {}),
    },
    controlFields: {
      mode: "new-ticket",
      ...(options?.projectId !== undefined ? { project_id: options.projectId } : {}),
      issue_id: null,
      ...(options?.draftId ? { draft_id: options.draftId } : {}),
    },
  };
};

export const buildEmptyTicketDraftContent = (): TicketEditorContent => ({
  subject: "",
  description: "",
  metadata: {
    tracker: "",
    priority: "",
    status: "",
    due_date: "",
    children: [],
  },
});

export const buildNewChildTicketDraftContent = (
  parentTicket: Ticket,
  baseContent: TicketEditorContent = buildNewTicketDraftContent(),
): TicketEditorContent => {
  const content = baseContent;
  return {
    ...content,
    metadata: {
      ...content.metadata,
      tracker: parentTicket.trackerName ?? content.metadata.tracker,
      priority: parentTicket.priorityName ?? content.metadata.priority,
      status: parentTicket.statusName ?? content.metadata.status,
      due_date: parentTicket.dueDate ?? content.metadata.due_date,
      parent: parentTicket.id,
    },
  };
};

export const initializeTicketDraft = (
  ticketId: number,
  subject: string,
  description: string,
  metadata: IssueMetadata,
  lastKnownRemoteUpdatedAt?: string,
): TicketDraftState => {
  const draft: TicketDraftState = {
    ticketId,
    baseSubject: subject,
    baseDescription: description,
    baseMetadata: metadata,
    lastKnownRemoteUpdatedAt,
    lastSyncedAt: Date.now(),
    status: "Synced",
  };
  cache.set(ticketId, draft);
  persist(ticketId, draft);
  return draft;
};

export const ensureTicketDraft = (
  ticketId: number,
  subject: string,
  description: string,
  metadata: IssueMetadata,
  lastKnownRemoteUpdatedAt?: string,
): TicketDraftState => {
  const draft = cache.get(ticketId);
  if (!draft) {
    return initializeTicketDraft(
      ticketId,
      subject,
      description,
      metadata,
      lastKnownRemoteUpdatedAt,
    );
  }

  draft.baseSubject = subject;
  draft.baseDescription = description;
  draft.baseMetadata = metadata;
  draft.lastKnownRemoteUpdatedAt = lastKnownRemoteUpdatedAt ?? draft.lastKnownRemoteUpdatedAt;
  persist(ticketId, draft);
  return draft;
};

export const getTicketDraftContent = (
  ticketId: number,
): TicketEditorContent | undefined => {
  const draft = cache.get(ticketId);
  if (
    !draft ||
    (!draft.draftSubject && !draft.draftDescription && !draft.draftMetadata)
  ) {
    return undefined;
  }

  return {
    subject: draft.draftSubject ?? draft.baseSubject,
    description: draft.draftDescription ?? draft.baseDescription,
    metadata: draft.draftMetadata ?? draft.baseMetadata,
  };
};

export const setTicketDraftContent = (
  ticketId: number,
  content: TicketEditorContent,
): void => {
  const draft = cache.get(ticketId);
  if (!draft) {
    return;
  }

  if (
    content.subject.trim() === draft.baseSubject.trim() &&
    content.description.trim() === draft.baseDescription.trim() &&
    isIssueMetadataEqual(content.metadata, draft.baseMetadata)
  ) {
    draft.draftSubject = undefined;
    draft.draftDescription = undefined;
    draft.draftMetadata = undefined;
  } else {
    draft.draftSubject = content.subject;
    draft.draftDescription = content.description;
    draft.draftMetadata = content.metadata;
  }
  persist(ticketId, draft);
};

export const clearTicketDraftContent = (ticketId: number): void => {
  const draft = cache.get(ticketId);
  if (!draft) {
    return;
  }

  draft.draftSubject = undefined;
  draft.draftDescription = undefined;
  draft.draftMetadata = undefined;
  persist(ticketId, draft);
};

export const updateDraftAfterSave = (
  ticketId: number,
  subject: string,
  description: string,
  metadata: IssueMetadata,
  lastKnownRemoteUpdatedAt?: string,
): void => {
  const draft = cache.get(ticketId);
  if (!draft) {
    initializeTicketDraft(
      ticketId,
      subject,
      description,
      metadata,
      lastKnownRemoteUpdatedAt,
    );
    return;
  }

  draft.baseSubject = subject;
  draft.baseDescription = description;
  draft.baseMetadata = metadata;
  draft.lastKnownRemoteUpdatedAt = lastKnownRemoteUpdatedAt ?? draft.lastKnownRemoteUpdatedAt;
  draft.lastSyncedAt = Date.now();
  draft.status = "Synced";
  draft.draftSubject = undefined;
  draft.draftDescription = undefined;
  draft.draftMetadata = undefined;
  persist(ticketId, draft);
};

export const markDraftStatus = (ticketId: number, status: TicketDraftStatus): void => {
  const draft = cache.get(ticketId);
  if (!draft) {
    return;
  }

  draft.status = status;
  persist(ticketId, draft);
};

export const clearTicketDraft = (ticketId: number): void => {
  cache.delete(ticketId);
  persistentStorage.delete(ticketId);
};

export const clearTicketDrafts = (): void => {
  cache.clear();
  persistentStorage.clear();
};
