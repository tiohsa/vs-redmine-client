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
  if (key === "parent" && value.length > 0 && !/^\d+$/.test(value)) {
    throw new Error("parent must be a numeric ID.");
  }
  if (key === "start_date" && value.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("start_date must be YYYY-MM-DD");
  }
  if (key === "done_ratio" && value.length > 0) {
    const ratio = Number(value);
    if (Number.isNaN(ratio) || ratio < 0 || ratio > 100) {
      throw new Error("done_ratio must be a number between 0 and 100.");
    }
  }
  if (key === "estimated_hours" && value.length > 0) {
    const hours = Number(value);
    if (Number.isNaN(hours)) {
      throw new Error("estimated_hours must be a number.");
    }
  }
};

export const parseIssueMetadataYaml = (text: string): IssueMetadata => {
  const lines = text.split(/\r?\n/);
  const values: Partial<IssueMetadata> = {};
  const seen = new Set<IssueMetadataKey>();
  const keyOrder: IssueMetadataKey[] = [];
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
    keyOrder.push(key);

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

    if (key === "parent") {
      readingChildren = false;
      requireValue(key, value);
      values.parent = Number(value);
      return;
    }

    if (key === "done_ratio") {
      readingChildren = false;
      if (value.length > 0) {
        const ratio = Number(value);
        if (Number.isNaN(ratio) || ratio < 0 || ratio > 100) {
          throw new Error("done_ratio must be a number between 0 and 100.");
        }
        values.done_ratio = ratio;
      }
      return;
    }

    if (key === "estimated_hours") {
      readingChildren = false;
      if (value.length > 0) {
        const hours = Number(value);
        if (Number.isNaN(hours)) {
          throw new Error("estimated_hours must be a number.");
        }
        values.estimated_hours = hours;
      }
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

  return { ...values, keyOrder } as IssueMetadata;
};

export const serializeIssueMetadataYaml = (metadata: IssueMetadata): string => {
  const lines = ["issue:"];
  const defaultOrder: IssueMetadataKey[] = [
    "tracker",
    "priority",
    "status",
    "due_date",
    "start_date",
    "done_ratio",
    "estimated_hours",
    "parent",
    "children",
  ];

  const order = metadata.keyOrder && metadata.keyOrder.length > 0 ? metadata.keyOrder : defaultOrder;
  const processed = new Set<IssueMetadataKey>();

  // Process keys in order
  order.forEach((key) => {
    if (processed.has(key)) {
      return;
    }
    serializeField(lines, key, metadata);
    processed.add(key);
  });

  // Process any remaining keys (e.g. newly added optional fields not in template)
  defaultOrder.forEach((key) => {
    if (processed.has(key)) {
      return;
    }
    serializeField(lines, key, metadata);
    processed.add(key);
  });

  return lines.join("\n");
};

const serializeField = (lines: string[], key: IssueMetadataKey, metadata: IssueMetadata): void => {
  const value = metadata[key];
  if (value === undefined) {
    return;
  }

  switch (key) {
    case "tracker":
      lines.push(`  tracker:   ${value}`);
      break;
    case "priority":
      lines.push(`  priority:  ${value}`);
      break;
    case "status":
      lines.push(`  status:    ${value}`);
      break;
    case "due_date":
      lines.push(`  due_date:  ${value ?? ""}`);
      break;
    case "start_date":
      if (value) {
        lines.push(`  start_date: ${value}`);
      }
      break;
    case "done_ratio":
      lines.push(`  done_ratio: ${value}`);
      break;
    case "estimated_hours":
      lines.push(`  estimated_hours: ${value}`);
      break;
    case "parent":
      lines.push(`  parent:    ${value}`);
      break;
    case "children":
      if (Array.isArray(value) && value.length > 0) {
        lines.push("  children:");
        value.forEach((child: string) => {
          lines.push(`    - ${child}`);
        });
      }
      break;
  }
};
