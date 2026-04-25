import { IssueMetadata } from "./ticketMetadataTypes";
import { TicketEditorDefaults } from "./ticketEditorTypes";
import {
  parseIssueMetadataYaml,
  serializeIssueMetadataYaml,
  parseFrontmatterControlFields,
  serializeFrontmatterControlFields,
  splitMetadataBlockText,
} from "./ticketMetadataYaml";
import { FrontmatterControlFields } from "./ticketMetadataControlFields";

export interface TicketEditorContent {
  subject: string;
  description: string;
  metadata: IssueMetadata;
  layout?: TicketEditorLayout;
  metadataBlock?: TicketEditorMetadataBlock;
  controlFields?: FrontmatterControlFields;
}

export type TicketEditorDisplaySource = "draft" | "saved";
export type TicketEditorDisplay = {
  content: TicketEditorContent;
  source: TicketEditorDisplaySource;
};

export type TicketEditorLayout = "metadata-first" | "subject-first";
export type TicketEditorMetadataBlock = "present" | "missing";

type TicketEditorParseOptions = {
  allowMissingMetadata?: boolean;
  fallbackMetadata?: IssueMetadata;
  allowMissingSubject?: boolean;
};

const normalizeDescription = (lines: string[]): string => {
  const joined = lines.join("\n");
  if (joined.startsWith("\n")) {
    return joined.slice(1);
  }
  return joined;
};

const extractSubjectLine = (
  lines: string[],
  startIndex: number,
): { subject: string; subjectIndex: number } => {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) {
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("#") && !trimmed.startsWith("##")) {
      const heading = trimmed.replace(/^#\s*/, "");
      return { subject: heading, subjectIndex: index };
    }
    return { subject: "", subjectIndex: -1 };
  }

  return { subject: "", subjectIndex: -1 };
};

const parseMetadataBlockText = (
  metadataLines: string,
): { metadata: IssueMetadata; controlFields: FrontmatterControlFields } => {
  const { controlText, issueText } = splitMetadataBlockText(metadataLines);
  const controlFields = parseFrontmatterControlFields(controlText);
  const textToParse = issueText.length > 0 ? issueText : metadataLines;
  const metadata = parseIssueMetadataYaml(textToParse);
  return { metadata, controlFields };
};

const extractMetadataBlock = (
  lines: string[],
  startIndex: number,
  options: TicketEditorParseOptions,
): {
  metadata: IssueMetadata;
  description: string;
  metadataBlock: TicketEditorMetadataBlock;
  controlFields: FrontmatterControlFields;
} => {
  const blockStart = lines.findIndex(
    (line, index) => index >= startIndex && line.trim() === "---",
  );
  if (blockStart === -1) {
    if (options.allowMissingMetadata && options.fallbackMetadata) {
      return {
        metadata: options.fallbackMetadata,
        description: normalizeDescription(lines.slice(startIndex)),
        metadataBlock: "missing",
        controlFields: {},
      };
    }
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
  const { metadata, controlFields } = parseMetadataBlockText(metadataLines);
  const description = normalizeDescription(lines.slice(blockEnd + 1));

  return { metadata, description, metadataBlock: "present", controlFields };
};

const extractMetadataFromStart = (
  lines: string[],
): { metadata: IssueMetadata; nextIndex: number; controlFields: FrontmatterControlFields } => {
  if (lines[0]?.trim() !== "---") {
    throw new Error("Metadata block must appear at the start.");
  }

  const blockEnd = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (blockEnd === -1) {
    throw new Error("Metadata block is missing the closing delimiter.");
  }

  const metadataLines = lines.slice(1, blockEnd).join("\n");
  const { metadata, controlFields } = parseMetadataBlockText(metadataLines);
  return { metadata, nextIndex: blockEnd + 1, controlFields };
};

export const parseTicketEditorContent = (
  text: string,
  options: TicketEditorParseOptions = {},
): TicketEditorContent => {
  const lines = text.split(/\r?\n/);
  const isMetadataFirst = lines[0]?.trim() === "---";

  if (isMetadataFirst) {
    const { metadata, nextIndex, controlFields } = extractMetadataFromStart(lines);
    const { subject, subjectIndex } = extractSubjectLine(lines, nextIndex);
    if (subjectIndex === -1) {
      if (options.allowMissingSubject) {
        return {
          subject: "",
          description: normalizeDescription(lines.slice(nextIndex)),
          metadata,
          layout: "metadata-first",
          metadataBlock: "present",
          controlFields,
        };
      }
      throw new Error("Subject line must appear after the metadata block.");
    }
    const description = normalizeDescription(lines.slice(subjectIndex + 1));
    return {
      subject: subject.trim(),
      description,
      metadata,
      layout: "metadata-first",
      metadataBlock: "present",
      controlFields,
    };
  }

  const { subject, subjectIndex } = extractSubjectLine(lines, 0);
  if (subjectIndex === -1) {
    throw new Error("Subject line is missing.");
  }
  const { metadata, description, metadataBlock, controlFields } = extractMetadataBlock(
    lines,
    subjectIndex + 1,
    options,
  );

  return {
    subject: subject.trim(),
    description,
    metadata,
    layout: "subject-first",
    metadataBlock,
    controlFields,
  };
};

export const buildTicketEditorContent = (content: TicketEditorContent): string => {
  const description = content.description ?? "";
  const descriptionSuffix = description.length > 0 ? `\n\n${description}` : "";
  const layout = content.layout ?? "metadata-first";

  if (content.metadataBlock === "missing") {
    return `# ${content.subject}${descriptionSuffix}`;
  }

  const controlSerialized =
    content.controlFields && Object.keys(content.controlFields).length > 0
      ? serializeFrontmatterControlFields(content.controlFields) + "\n"
      : "";
  const metadataBlock = `---\n${controlSerialized}${serializeIssueMetadataYaml(content.metadata)}\n---`;

  if (layout === "metadata-first") {
    return `${metadataBlock}\n\n# ${content.subject}${descriptionSuffix}`;
  }

  return `# ${content.subject}\n\n${metadataBlock}${descriptionSuffix}`;
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
