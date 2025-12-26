import { TicketDraftState, TicketDraftStatus } from "./ticketSaveTypes";

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
