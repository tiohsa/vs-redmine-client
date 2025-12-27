import { buildTicketEditorContent } from "../../views/ticketEditorContent";
import { IssueMetadata } from "../../views/ticketMetadataTypes";
import { buildIssueMetadataFixture } from "./ticketMetadataFixtures";

export const buildTicketEditorMetadataContent = (
  subject: string,
  description: string,
  overrides: Partial<IssueMetadata> = {},
): string =>
  buildTicketEditorContent({
    subject,
    description,
    metadata: buildIssueMetadataFixture(overrides),
  });
