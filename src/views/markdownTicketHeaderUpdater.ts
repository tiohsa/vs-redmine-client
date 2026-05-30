import { withRegisteredTicketControlFields } from "./ticketControlFields";
import {
  buildTicketEditorContent,
  parseTicketEditorContent,
  type TicketEditorContent,
} from "./ticketEditorContent";

const ALLOWED_CONTROL_KEYS = new Set([
  "mode",
  "project_id",
  "issue_id",
  "parent_issue_id",
  "draft_id",
  "last_synced_at",
  "lock_version",
]);

type RawControlFields = {
  mode?: string;
  issueId?: string;
  hasIssueId: boolean;
};

const extractRawControlFields = (content: string): RawControlFields => {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new Error("Redmine metadata block is missing.");
  }

  const blockEnd = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (blockEnd === -1) {
    throw new Error("Metadata block is missing the closing delimiter.");
  }

  const issueLineIndex = lines.findIndex(
    (line, index) => index > 0 && index < blockEnd && line.trim() === "issue:",
  );
  if (issueLineIndex === -1) {
    throw new Error("Metadata must include issue block.");
  }

  const fields: RawControlFields = { hasIssueId: false };
  const seenKeys = new Set<string>();
  for (const line of lines.slice(1, issueLineIndex)) {
    if (line.trim().length === 0) {
      continue;
    }

    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!match) {
      throw new Error(`Unsupported frontmatter line: ${line}`);
    }

    const [, key, value] = match;
    if (!ALLOWED_CONTROL_KEYS.has(key)) {
      throw new Error(`Unsupported frontmatter key: ${key}`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate frontmatter key: ${key}`);
    }
    seenKeys.add(key);

    if (key === "mode") {
      fields.mode = value.trim();
    }
    if (key === "issue_id") {
      fields.hasIssueId = true;
      fields.issueId = value.trim();
    }
  }

  return fields;
};

export const validateMarkdownTicketHeader = (content: string): TicketEditorContent => {
  const fields = extractRawControlFields(content);
  if (fields.hasIssueId) {
    throw new Error(`Already linked to Redmine ticket #${fields.issueId ?? ""}.`);
  }
  if (fields.mode === undefined) {
    throw new Error("Set mode: new-ticket to create a Redmine ticket from this Markdown file.");
  }
  if (fields.mode === "ticket-update") {
    throw new Error("This Markdown file is already marked as a ticket update file.");
  }
  if (fields.mode !== "new-ticket") {
    throw new Error(`Unsupported mode for ticket creation: ${fields.mode}`);
  }

  try {
    return parseTicketEditorContent(content);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Subject line must appear after the metadata block."
    ) {
      throw new Error("Subject line is missing.");
    }
    throw error;
  }
};

export const updateMarkdownTicketHeader = (input: {
  content: string;
  projectId: number;
  issueId: number;
  syncedAt?: string;
  parsedContent?: TicketEditorContent;
}): string => {
  const parsed = validateMarkdownTicketHeader(input.content);
  const controlFields = withRegisteredTicketControlFields(
    parsed.controlFields ?? {},
    input.issueId,
    input.projectId,
  );
  if (input.syncedAt !== undefined) {
    controlFields.last_synced_at = input.syncedAt;
  }

  return buildTicketEditorContent({
    ...(input.parsedContent ?? parsed),
    controlFields,
  });
};
