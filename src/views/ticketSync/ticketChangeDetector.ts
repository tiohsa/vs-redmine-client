import {
  buildTicketEditorContent,
  parseTicketEditorContent,
  type TicketEditorContent,
} from "../ticketEditorContent";
import type { TicketDraftState } from "../ticketSaveTypes";
import type { OfflineTicketUpdate } from "../offlineSyncStore";
import type { IssueMetadata } from "../ticketMetadataTypes";
import { computeChanges, computeMetadataChanges } from "./ticketMetadataResolver";

export interface TicketChangeState {
  subjectChanged: boolean;
  descriptionChanged: boolean;
  metadataChanged: boolean;
  childCreationRequested: boolean;
  hasChanges: boolean;
}

export type TicketIntentBase = {
  subject: string;
  description: string;
  metadata: IssueMetadata;
};

export const detectTicketIntentChanges = (
  base: TicketIntentBase,
  content: TicketEditorContent,
): TicketChangeState => {
  const subject = content.subject || base.subject;
  const contentChanges = computeChanges(
    base.subject,
    base.description,
    subject,
    content.description,
  );
  const metadataChanges = computeMetadataChanges(base.metadata, content.metadata);
  const subjectChanged = contentChanges.subject !== undefined;
  const descriptionChanged = contentChanges.description !== undefined;
  const metadataChanged = Object.keys(metadataChanges).length > 0;
  const childCreationRequested = (content.metadata.children?.length ?? 0) > 0;

  return {
    subjectChanged,
    descriptionChanged,
    metadataChanged,
    childCreationRequested,
    hasChanges:
      subjectChanged ||
      descriptionChanged ||
      metadataChanged ||
      childCreationRequested,
  };
};

export const detectTicketChanges = (
  draft: TicketDraftState,
  content: TicketEditorContent,
): TicketChangeState => detectTicketIntentChanges({
  subject: draft.baseSubject,
  description: draft.baseDescription,
  metadata: draft.baseMetadata,
}, content);

export const isSafeQueuedTicketUpdate = (
  queued: Pick<OfflineTicketUpdate, "phase" | "nextIntent" | "remoteUpdatedAt" | "createdChildIds" | "effects">,
): boolean => (
  (queued.phase === undefined || queued.phase === "queued") &&
  queued.nextIntent === undefined &&
  queued.remoteUpdatedAt === undefined &&
  (queued.createdChildIds?.length ?? 0) === 0 &&
  !(queued.effects ?? []).some((effect) =>
    effect.state !== "planned" || effect.remoteId !== undefined || effect.token !== undefined,
  )
);

export const parseQueuedTicketIntent = (
  queued: Pick<OfflineTicketUpdate, "content" | "subject" | "description" | "metadata" | "layout" | "metadataBlock" | "controlFields">,
): TicketEditorContent | undefined => {
  if (
    !queued.content &&
    (queued.subject === undefined || queued.description === undefined || !queued.metadata)
  ) {
    return undefined;
  }
  const content = queued.content ?? buildTicketEditorContent({
    subject: queued.subject,
    description: queued.description,
    metadata: queued.metadata,
    layout: queued.layout,
    metadataBlock: queued.metadataBlock,
    controlFields: queued.controlFields,
  });
  try {
    return parseTicketEditorContent(content, {
      allowMissingMetadata: true,
      fallbackMetadata: queued.metadata,
    });
  } catch {
    return undefined;
  }
};
