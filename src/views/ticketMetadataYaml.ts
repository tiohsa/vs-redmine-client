import {
  ISSUE_METADATA_KEYS,
  ISSUE_METADATA_REQUIRED_KEYS,
  IssueMetadata,
  IssueMetadataKey,
} from "./ticketMetadataTypes";

const stripInlineComment = (value: string): string => {
  const index = value.indexOf(" #");
  if (index === -1) {
    return value;
  }
  return value.slice(0, index).trimEnd();
};

const requireValue = (key: IssueMetadataKey, value: string): void => {
  if (key !== "due_date" && value.length === 0) {
    throw new Error(`Metadata value required: ${key}`);
  }
  if (key === "due_date" && value.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("due_date must be YYYY-MM-DD");
  }
};

export const parseIssueMetadataYaml = (text: string): IssueMetadata => {
  const lines = text.split(/\r?\n/);
  const values: Partial<IssueMetadata> = {};
  const seen = new Set<IssueMetadataKey>();
  let sawIssue = false;
  let readingChildren = false;

  lines.forEach((line, index) => {
    if (line.trim().length === 0) {
      if (readingChildren) {
        throw new Error("children entries cannot be empty.");
      }
      return;
    }

    if (!sawIssue) {
      if (line.trim() !== "issue:") {
        throw new Error("Metadata must start with 'issue:'");
      }
      sawIssue = true;
      return;
    }

    if (!line.startsWith("  ")) {
      throw new Error("Only issue block keys are allowed.");
    }
    if (line.startsWith("   ")) {
      if (!line.startsWith("    -")) {
        throw new Error("Nested keys are not allowed.");
      }
    }

    if (line.startsWith("    -")) {
      if (!readingChildren) {
        throw new Error("Arrays are not allowed.");
      }
      const childValue = line.replace(/^ {4}-\s*/, "").trim();
      if (childValue.length === 0) {
        throw new Error("children entries cannot be empty.");
      }
      if (!values.children) {
        values.children = [];
      }
      values.children.push(childValue);
      return;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("-")) {
      throw new Error("Arrays are not allowed.");
    }

    const match = line.match(/^ {2}([a-z_]+):(.*)$/);
    if (!match) {
      throw new Error(`Invalid metadata line at ${index + 1}`);
    }

    const key = match[1] as IssueMetadataKey;
    if (!ISSUE_METADATA_KEYS.includes(key)) {
      throw new Error(`Unknown metadata key: ${key}`);
    }
    if (seen.has(key)) {
      throw new Error(`Duplicate metadata key: ${key}`);
    }
    seen.add(key);

    const rawValue = stripInlineComment(match[2]);
    const value = rawValue.trim();

    if (key === "children") {
      if (value.length > 0) {
        throw new Error("children must be a list.");
      }
      readingChildren = true;
      values.children = [];
      return;
    }

    readingChildren = false;
    requireValue(key, value);
    values[key] = value;
  });

  if (!sawIssue) {
    throw new Error("Metadata must include issue block.");
  }

  if (values.children && values.children.length === 0) {
    throw new Error("children entries cannot be empty.");
  }
  if (values.children && values.children.length > 50) {
    throw new Error("children exceeds limit (50).");
  }

  ISSUE_METADATA_REQUIRED_KEYS.forEach((key) => {
    if (values[key] === undefined) {
      throw new Error(`Missing metadata key: ${key}`);
    }
  });

  return values as IssueMetadata;
};

export const serializeIssueMetadataYaml = (metadata: IssueMetadata): string => {
  const dueDate = metadata.due_date ?? "";
  const lines = [
    "issue:",
    `  tracker:   ${metadata.tracker}`,
    `  priority:  ${metadata.priority}`,
    `  status:    ${metadata.status}`,
    `  due_date:  ${dueDate}`,
  ];
  if (metadata.children && metadata.children.length > 0) {
    lines.push("  children:");
    metadata.children.forEach((child) => {
      lines.push(`    - ${child}`);
    });
  }

  return lines.join("\n");
};
