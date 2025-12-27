import { IssueMetadata } from "../../views/ticketMetadataTypes";

export const buildIssueMetadataFixture = (
  overrides: Partial<IssueMetadata> = {},
): IssueMetadata => ({
  tracker: "Task",
  priority: "Normal",
  status: "In Progress",
  due_date: "2025-12-31",
  ...overrides,
});

export const CHILDREN_SUBJECTS_FIXTURE = ["Child task 1", "Child task 2"];
