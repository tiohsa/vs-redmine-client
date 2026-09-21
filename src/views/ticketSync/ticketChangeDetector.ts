import type { TicketEditorContent } from "../ticketEditorContent";
import type { TicketDraftState } from "../ticketSaveTypes";
import { computeChanges, computeMetadataChanges } from "./ticketMetadataResolver";

export interface TicketChangeState {
  subjectChanged: boolean;
  descriptionChanged: boolean;
  metadataChanged: boolean;
  childCreationRequested: boolean;
  hasChanges: boolean;
}

export const detectTicketChanges = (
  draft: TicketDraftState,
  content: TicketEditorContent,
): TicketChangeState => {
  const subject = content.subject || draft.baseSubject;
  const contentChanges = computeChanges(
    draft.baseSubject,
    draft.baseDescription,
    subject,
    content.description,
  );
  const metadataChanges = computeMetadataChanges(
    draft.baseMetadata,
    content.metadata,
  );
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
