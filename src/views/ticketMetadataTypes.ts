export type IssueMetadata = {
  keyOrder?: IssueMetadataKey[];
  tracker: string;
  priority: string;
  status: string;
  due_date: string;
  children?: string[];
  parent?: number;
  start_date?: string;
  done_ratio?: number;
  estimated_hours?: number;
};

export const ISSUE_METADATA_REQUIRED_KEYS = [
  "tracker",
  "priority",
  "status",
  "due_date",
] as const;

export const ISSUE_METADATA_OPTIONAL_KEYS = [
  "children",
  "parent",
  "start_date",
  "done_ratio",
  "estimated_hours",
] as const;

export const ISSUE_METADATA_KEYS = [
  ...ISSUE_METADATA_REQUIRED_KEYS,
  ...ISSUE_METADATA_OPTIONAL_KEYS,
] as const;

export type IssueMetadataKey = (typeof ISSUE_METADATA_KEYS)[number];
export type IssueMetadataRequiredKey = (typeof ISSUE_METADATA_REQUIRED_KEYS)[number];

const areChildrenEqual = (left?: string[], right?: string[]): boolean => {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
};

export const isIssueMetadataEqual = (
  left: IssueMetadata,
  right: IssueMetadata,
): boolean =>
  left.tracker === right.tracker &&
  left.priority === right.priority &&
  left.status === right.status &&
  left.due_date === right.due_date &&
  left.start_date === right.start_date &&
  left.done_ratio === right.done_ratio &&
  left.estimated_hours === right.estimated_hours &&

  areChildrenEqual(left.children, right.children) &&
  left.parent === right.parent;
