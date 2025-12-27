import { TicketDraftState, TicketDraftStatus } from "./ticketSaveTypes";
import { TicketEditorContent } from "./ticketEditorContent";

const drafts = new Map<number, TicketDraftState>();

export const getTicketDraft = (ticketId: number): TicketDraftState | undefined =>
  drafts.get(ticketId);

export const initializeTicketDraft = (
  ticketId: number,
  subject: string,
  description: string,
  lastKnownRemoteUpdatedAt?: string,
): TicketDraftState => {
  const draft: TicketDraftState = {
    ticketId,
    baseSubject: subject,
    baseDescription: description,
    lastKnownRemoteUpdatedAt,
    lastSyncedAt: Date.now(),
    status: "clean",
  };
  drafts.set(ticketId, draft);
  return draft;
};

export const ensureTicketDraft = (
  ticketId: number,
  subject: string,
  description: string,
  lastKnownRemoteUpdatedAt?: string,
): TicketDraftState => {
  const draft = drafts.get(ticketId);
  if (!draft) {
    return initializeTicketDraft(ticketId, subject, description, lastKnownRemoteUpdatedAt);
  }

  draft.baseSubject = subject;
  draft.baseDescription = description;
  draft.lastKnownRemoteUpdatedAt = lastKnownRemoteUpdatedAt ?? draft.lastKnownRemoteUpdatedAt;
  return draft;
};

export const getTicketDraftContent = (
  ticketId: number,
): TicketEditorContent | undefined => {
  const draft = drafts.get(ticketId);
  if (!draft || !draft.draftSubject || !draft.draftDescription) {
    return undefined;
  }

  return {
    subject: draft.draftSubject,
    description: draft.draftDescription,
  };
};

export const setTicketDraftContent = (
  ticketId: number,
  content: TicketEditorContent,
): void => {
  const draft = drafts.get(ticketId);
  if (!draft) {
    return;
  }

  if (
    content.subject.trim() === draft.baseSubject.trim() &&
    content.description.trim() === draft.baseDescription.trim()
  ) {
    draft.draftSubject = undefined;
    draft.draftDescription = undefined;
    return;
  }

  draft.draftSubject = content.subject;
  draft.draftDescription = content.description;
};

export const clearTicketDraftContent = (ticketId: number): void => {
  const draft = drafts.get(ticketId);
  if (!draft) {
    return;
  }

  draft.draftSubject = undefined;
  draft.draftDescription = undefined;
};

export const updateDraftAfterSave = (
  ticketId: number,
  subject: string,
  description: string,
  lastKnownRemoteUpdatedAt?: string,
): void => {
  const draft = drafts.get(ticketId);
  if (!draft) {
    initializeTicketDraft(ticketId, subject, description, lastKnownRemoteUpdatedAt);
    return;
  }

  draft.baseSubject = subject;
  draft.baseDescription = description;
  draft.lastKnownRemoteUpdatedAt = lastKnownRemoteUpdatedAt ?? draft.lastKnownRemoteUpdatedAt;
  draft.lastSyncedAt = Date.now();
  draft.status = "clean";
  draft.draftSubject = undefined;
  draft.draftDescription = undefined;
};

export const markDraftStatus = (ticketId: number, status: TicketDraftStatus): void => {
  const draft = drafts.get(ticketId);
  if (!draft) {
    return;
  }

  draft.status = status;
};

export const clearTicketDraft = (ticketId: number): void => {
  drafts.delete(ticketId);
};

export const clearTicketDrafts = (): void => {
  drafts.clear();
};
