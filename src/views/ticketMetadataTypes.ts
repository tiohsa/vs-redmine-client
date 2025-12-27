export type IssueMetadata = {
  tracker: string;
  priority: string;
  status: string;
  due_date: string;
};

export const ISSUE_METADATA_KEYS = [
  "tracker",
  "priority",
  "status",
  "due_date",
] as const;

export type IssueMetadataKey = (typeof ISSUE_METADATA_KEYS)[number];

export const isIssueMetadataEqual = (
  left: IssueMetadata,
  right: IssueMetadata,
): boolean =>
  left.tracker === right.tracker &&
  left.priority === right.priority &&
  left.status === right.status &&
  left.due_date === right.due_date;
