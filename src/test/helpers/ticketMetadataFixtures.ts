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
