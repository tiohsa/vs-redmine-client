import { TicketDraftState, TicketDraftStatus } from "./ticketSaveTypes";
import { applyTicketEditorDefaults, TicketEditorContent } from "./ticketEditorContent";
import { getTicketEditorDefaults } from "./ticketEditorDefaultsStore";
import { IssueMetadata, isIssueMetadataEqual } from "./ticketMetadataTypes";
import { Ticket } from "../redmine/types";
import { createInMemoryDraftStorage, DraftStorage } from "./draftPersistence";

let activeScope = "";
const cachesByScope = new Map<string, Map<number, TicketDraftState>>();
const storageByScope = new Map<string, DraftStorage>();

const getCache = (scope = activeScope): Map<number, TicketDraftState> => {
  let cache = cachesByScope.get(scope);
  if (!cache) {
    const storage = storageByScope.get(scope) ?? createInMemoryDraftStorage();
    storageByScope.set(scope, storage);
    cache = storage.loadAll();
    cachesByScope.set(scope, cache);
  }
  return cache;
};

const getStorage = (scope = activeScope): DraftStorage => {
  let storage = storageByScope.get(scope);
  if (!storage) {
    storage = createInMemoryDraftStorage();
    storageByScope.set(scope, storage);
  }
  return storage;
};

/** 起動時に永続ストレージを注入し、保存済みドラフトをキャッシュに読み込む */
export const initializeDraftStore = (storage: DraftStorage, scope = ""): void => {
  activeScope = scope;
  storageByScope.set(scope, storage);
  cachesByScope.set(scope, storage.loadAll());
};

const persist = (ticketId: number, draft: TicketDraftState, scope = activeScope): void => {
  getStorage(scope).save(ticketId, draft);
};

export const getTicketDraft = (
  ticketId: number,
  scope = activeScope,
): TicketDraftState | undefined => getCache(scope).get(ticketId);

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
  initialContent?: Partial<TicketEditorContent>;
  initialValues?: NewTicketInitialValues;
}): TicketEditorContent => {
  const base = applyTicketEditorDefaults(getTicketEditorDefaults());
  const ic = options?.initialContent;
  const iv = options?.initialValues;
  const initialTracker = ic?.metadata?.tracker ?? iv?.tracker;
  const initialPriority = ic?.metadata?.priority ?? iv?.priority;
  const initialStatus = ic?.metadata?.status ?? iv?.status;
  const initialStartDate = ic?.metadata?.start_date ?? iv?.start_date;
  const initialDueDate = ic?.metadata?.due_date ?? iv?.due_date;
  const initialParent = ic?.metadata?.parent ?? iv?.parent;
  return {
    ...base,
    ...ic,
    subject: ic?.subject ?? iv?.subject ?? base.subject,
    description: ic?.description ?? iv?.description ?? base.description,
    metadata: {
      ...base.metadata,
      ...(ic?.metadata ?? {}),
      ...(initialTracker !== undefined ? { tracker: initialTracker } : {}),
      ...(initialPriority !== undefined ? { priority: initialPriority } : {}),
      ...(initialStatus !== undefined ? { status: initialStatus } : {}),
      ...(initialStartDate !== undefined ? { start_date: initialStartDate } : {}),
      ...(initialDueDate !== undefined ? { due_date: initialDueDate } : {}),
      ...(initialParent !== undefined ? { parent: initialParent } : {}),
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
  scope = activeScope,
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
  getCache(scope).set(ticketId, draft);
  persist(ticketId, draft, scope);
  return draft;
};

export const ensureTicketDraft = (
  ticketId: number,
  subject: string,
  description: string,
  metadata: IssueMetadata,
  lastKnownRemoteUpdatedAt?: string,
  scope = activeScope,
): TicketDraftState => {
  const draft = getCache(scope).get(ticketId);
  if (!draft) {
    return initializeTicketDraft(
      ticketId,
      subject,
      description,
      metadata,
      lastKnownRemoteUpdatedAt,
      scope,
    );
  }

  draft.baseSubject = subject;
  draft.baseDescription = description;
  draft.baseMetadata = metadata;
  draft.lastKnownRemoteUpdatedAt = lastKnownRemoteUpdatedAt ?? draft.lastKnownRemoteUpdatedAt;
  persist(ticketId, draft, scope);
  return draft;
};

export const getTicketDraftContent = (
  ticketId: number,
  scope = activeScope,
): TicketEditorContent | undefined => {
  const draft = getCache(scope).get(ticketId);
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
  scope = activeScope,
): void => {
  const draft = getCache(scope).get(ticketId);
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
  persist(ticketId, draft, scope);
};

export const clearTicketDraftContent = (ticketId: number, scope = activeScope): void => {
  const draft = getCache(scope).get(ticketId);
  if (!draft) {
    return;
  }

  draft.draftSubject = undefined;
  draft.draftDescription = undefined;
  draft.draftMetadata = undefined;
  persist(ticketId, draft, scope);
};

export const updateDraftAfterSave = (
  ticketId: number,
  subject: string,
  description: string,
  metadata: IssueMetadata,
  lastKnownRemoteUpdatedAt?: string,
  scope = activeScope,
): void => {
  const draft = getCache(scope).get(ticketId);
  if (!draft) {
    initializeTicketDraft(
      ticketId,
      subject,
      description,
      metadata,
      lastKnownRemoteUpdatedAt,
      scope,
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
  persist(ticketId, draft, scope);
};

export const markDraftStatus = (
  ticketId: number,
  status: TicketDraftStatus,
  scope = activeScope,
): void => {
  const draft = getCache(scope).get(ticketId);
  if (!draft) {
    return;
  }

  draft.status = status;
  persist(ticketId, draft, scope);
};

export const clearTicketDraft = (ticketId: number, scope = activeScope): void => {
  getCache(scope).delete(ticketId);
  getStorage(scope).delete(ticketId);
};

export const clearTicketDrafts = (scope = activeScope): void => {
  getCache(scope).clear();
  getStorage(scope).clear();
};
