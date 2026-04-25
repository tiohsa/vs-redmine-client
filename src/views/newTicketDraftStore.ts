import * as vscode from "vscode";
import { randomUUID } from "crypto";

const STORAGE_KEY_PREFIX = "redmine.draft.new-ticket.";

export interface NewTicketDraftState {
  draftId: string;
  projectId?: number;
  content: string;
  status: "Draft" | "Syncing" | "Synced" | "Failed";
  createdAt: number;
  lastSavedAt: number;
  retryCount: number;
}

let memento: vscode.Memento | undefined;
const cache = new Map<string, NewTicketDraftState>();

export const initializeNewTicketDraftStore = (state: vscode.Memento): void => {
  memento = state;
  cache.clear();
  const keys = state.keys().filter((k) => k.startsWith(STORAGE_KEY_PREFIX));
  for (const key of keys) {
    const raw = state.get<NewTicketDraftState>(key);
    if (raw) {
      cache.set(raw.draftId, raw);
    }
  }
};

const persist = (draft: NewTicketDraftState): void => {
  if (memento) {
    void memento.update(`${STORAGE_KEY_PREFIX}${draft.draftId}`, draft);
  }
};

const remove = (draftId: string): void => {
  if (memento) {
    void memento.update(`${STORAGE_KEY_PREFIX}${draftId}`, undefined);
  }
};

export const createNewTicketDraft = (projectId?: number, content = ""): NewTicketDraftState => {
  const draftId = randomUUID();
  const now = Date.now();
  const draft: NewTicketDraftState = {
    draftId,
    projectId,
    content,
    status: "Draft",
    createdAt: now,
    lastSavedAt: now,
    retryCount: 0,
  };
  cache.set(draftId, draft);
  persist(draft);
  return draft;
};

export const getNewTicketDraft = (draftId: string): NewTicketDraftState | undefined =>
  cache.get(draftId);

export const getAllNewTicketDrafts = (): NewTicketDraftState[] =>
  Array.from(cache.values());

export const updateNewTicketDraft = (draftId: string, content: string): void => {
  const draft = cache.get(draftId);
  if (!draft) { return; }
  draft.content = content;
  draft.lastSavedAt = Date.now();
  persist(draft);
};

export const markNewTicketDraftSyncing = (draftId: string): void => {
  const draft = cache.get(draftId);
  if (!draft) { return; }
  draft.status = "Syncing";
  persist(draft);
};

export const markNewTicketDraftSynced = (draftId: string, _createdIssueId: number): void => {
  const draft = cache.get(draftId);
  if (!draft) { return; }
  draft.status = "Synced";
  persist(draft);
};

export const markNewTicketDraftFailed = (draftId: string): void => {
  const draft = cache.get(draftId);
  if (!draft) { return; }
  draft.status = "Failed";
  draft.retryCount += 1;
  persist(draft);
};

export const deleteNewTicketDraft = (draftId: string): void => {
  cache.delete(draftId);
  remove(draftId);
};

export const clearNewTicketDrafts = (): void => {
  for (const draftId of cache.keys()) {
    remove(draftId);
  }
  cache.clear();
};
