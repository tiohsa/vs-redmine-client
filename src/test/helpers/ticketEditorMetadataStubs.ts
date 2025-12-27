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

export const buildTicketEditorMetadataContentWithChildren = (
  subject: string,
  description: string,
  children: string[],
  overrides: Partial<IssueMetadata> = {},
): string => {
  const metadata = buildIssueMetadataFixture(overrides);
  const metadataLines = [
    "issue:",
    `  tracker:   ${metadata.tracker}`,
    `  priority:  ${metadata.priority}`,
    `  status:    ${metadata.status}`,
    `  due_date:  ${metadata.due_date}`,
    "  children:",
    ...children.map((child) => `    - ${child}`),
  ];
  const metadataBlock = `---\n${metadataLines.join("\n")}\n---`;
  return `# ${subject}\n\n${metadataBlock}\n\n${description}`.trim();
};
