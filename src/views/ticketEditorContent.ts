import { IssueMetadata } from "./ticketMetadataTypes";
import { TicketEditorDefaults } from "./ticketEditorTypes";
import { parseIssueMetadataYaml, serializeIssueMetadataYaml } from "./ticketMetadataYaml";

export interface TicketEditorContent {
  subject: string;
  description: string;
  metadata: IssueMetadata;
}

export type TicketEditorDisplaySource = "draft" | "saved";
export type TicketEditorDisplay = {
  content: TicketEditorContent;
  source: TicketEditorDisplaySource;
};

const extractSubject = (lines: string[]): { subject: string; startIndex: number } => {
  const headingIndex = lines.findIndex((line) => line.trim().startsWith("# "));
  if (headingIndex >= 0) {
    const heading = lines[headingIndex].trim().replace(/^#\s+/, "");
    return { subject: heading, startIndex: headingIndex + 1 };
  }

  return { subject: "", startIndex: 0 };
};

const extractMetadataBlock = (
  lines: string[],
  startIndex: number,
): { metadata: IssueMetadata; description: string } => {
  const blockStart = lines.findIndex(
    (line, index) => index >= startIndex && line.trim() === "---",
  );
  if (blockStart === -1) {
    throw new Error("Metadata block is missing.");
  }

  const leadingLines = lines.slice(startIndex, blockStart);
  if (leadingLines.some((line) => line.trim().length > 0)) {
    throw new Error("Metadata block must appear immediately after the subject.");
  }

  const blockEnd = lines.findIndex(
    (line, index) => index > blockStart && line.trim() === "---",
  );
  if (blockEnd === -1) {
    throw new Error("Metadata block is missing the closing delimiter.");
  }

  const metadataLines = lines.slice(blockStart + 1, blockEnd).join("\n");
  const metadata = parseIssueMetadataYaml(metadataLines);
  const description = lines.slice(blockEnd + 1).join("\n").trim();

  return { metadata, description };
};

export const parseTicketEditorContent = (text: string): TicketEditorContent => {
  const lines = text.split(/\r?\n/);
  const { subject, startIndex } = extractSubject(lines);
  const { metadata, description } = extractMetadataBlock(lines, startIndex);

  return {
    subject: subject.trim(),
    description,
    metadata,
  };
};

export const buildTicketEditorContent = (content: TicketEditorContent): string => {
  const description = content.description?.trim() ?? "";
  const metadata = serializeIssueMetadataYaml(content.metadata);
  const metadataBlock = `---\n${metadata}\n---`;
  return `# ${content.subject}\n\n${metadataBlock}\n\n${description}`.trim();
};

export const resolveTicketEditorDisplay = (
  saved: TicketEditorContent,
  draft?: TicketEditorContent,
): TicketEditorDisplay => {
  if (draft) {
    return { content: draft, source: "draft" };
  }

  return { content: saved, source: "saved" };
};

export const applyTicketEditorDefaults = (
  defaults: TicketEditorDefaults,
): TicketEditorContent => ({
  subject: defaults.subject,
  description: defaults.description,
  metadata: {
    ...defaults.metadata,
    children: defaults.metadata.children
      ? [...defaults.metadata.children]
      : defaults.metadata.children,
  },
});
