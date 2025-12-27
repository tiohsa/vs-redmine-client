import { requestJson } from "./client";
import {
  Comment,
  RedmineIssueDetailResponse,
  RedmineIssueListResponse,
  Ticket,
  TicketUpdateFields,
} from "./types";

export interface IssuesListInput {
  projectId: number;
  includeChildProjects: boolean;
  limit: number;
  offset: number;
  statusIds?: string[];
  assigneeIds?: string[];
}

export const buildIssuesListQuery = (input: IssuesListInput): Record<string, string | number | boolean> => {
  const query: Record<string, string | number | boolean> = {
    project_id: input.projectId,
    include_children: input.includeChildProjects,
    limit: input.limit,
    offset: input.offset,
  };

  if (input.statusIds && input.statusIds.length > 0) {
    query.status_id = input.statusIds.join(",");
  }
  if (input.assigneeIds && input.assigneeIds.length > 0) {
    query.assigned_to_id = input.assigneeIds.join(",");
  }

  return query;
};

export interface IssuesListResult {
  tickets: Ticket[];
  totalCount: number;
  limit: number;
  offset: number;
}

export const listIssues = async (input: IssuesListInput): Promise<IssuesListResult> => {
  const response = await requestJson<RedmineIssueListResponse>({
    method: "GET",
    path: "/issues.json",
    query: buildIssuesListQuery(input),
  });

  const tickets: Ticket[] = response.issues.map((issue) => ({
    id: issue.id,
    subject: issue.subject,
    description: issue.description,
    projectId: issue.project.id,
    statusId: issue.status?.id,
    statusName: issue.status?.name,
    priorityId: issue.priority?.id,
    priorityName: issue.priority?.name,
    trackerId: issue.tracker?.id,
    trackerName: issue.tracker?.name,
    assigneeId: issue.assigned_to?.id,
    assigneeName: issue.assigned_to?.name,
    createdAt: issue.created_on,
    updatedAt: issue.updated_on,
    dueDate: issue.due_date,
  }));

  return {
    tickets,
    totalCount: response.total_count ?? tickets.length,
    limit: response.limit ?? input.limit,
    offset: response.offset ?? input.offset,
  };
};

export interface IssueDetailResult {
  ticket: Ticket;
  comments: Comment[];
}

export interface IssueUploadInput {
  token: string;
  filename: string;
  content_type: string;
}

export interface IssueCreateInput {
  projectId: number;
  subject: string;
  description: string;
  uploads?: IssueUploadInput[];
}

export const buildIssueCreatePayload = (input: IssueCreateInput): Record<string, unknown> => ({
  issue: {
    project_id: input.projectId,
    subject: input.subject,
    description: input.description,
    uploads: input.uploads ?? [],
  },
});

export const createIssue = async (input: IssueCreateInput): Promise<void> => {
  await requestJson({
    method: "POST",
    path: "/issues.json",
    body: buildIssueCreatePayload(input),
  });
};

export interface IssueUpdateInput {
  issueId: number;
  fields: TicketUpdateFields;
}

export const buildIssueUpdatePayload = (
  fields: TicketUpdateFields,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  if (fields.subject !== undefined) {
    payload.subject = fields.subject;
  }
  if (fields.description !== undefined) {
    payload.description = fields.description;
  }
  if (fields.statusId !== undefined) {
    payload.status_id = fields.statusId;
  }
  if (fields.assigneeId !== undefined) {
    payload.assigned_to_id = fields.assigneeId;
  }

  return { issue: payload };
};

export const updateIssue = async (input: IssueUpdateInput): Promise<void> => {
  await requestJson({
    method: "PUT",
    path: `/issues/${input.issueId}.json`,
    body: buildIssueUpdatePayload(input.fields),
  });
};

export const getIssueDetail = async (issueId: number): Promise<IssueDetailResult> => {
  const response = await requestJson<RedmineIssueDetailResponse>({
    method: "GET",
    path: `/issues/${issueId}.json`,
    query: {
      include: "journals",
    },
  });

  const issue = response.issue;
  const ticket: Ticket = {
    id: issue.id,
    subject: issue.subject,
    description: issue.description,
    projectId: issue.project.id,
    statusId: issue.status?.id,
    statusName: issue.status?.name,
    priorityId: issue.priority?.id,
    priorityName: issue.priority?.name,
    trackerId: issue.tracker?.id,
    trackerName: issue.tracker?.name,
    assigneeId: issue.assigned_to?.id,
    assigneeName: issue.assigned_to?.name,
    createdAt: issue.created_on,
    updatedAt: issue.updated_on,
    dueDate: issue.due_date,
  };

  const comments: Comment[] = (issue.journals ?? []).map((journal) => ({
    id: journal.id,
    ticketId: issue.id,
    authorId: journal.user?.id ?? 0,
    authorName: journal.user?.name ?? "Unknown",
    body: journal.notes ?? "",
    createdAt: journal.created_on,
    updatedAt: journal.updated_on,
    editableByCurrentUser: false,
  }));

  return { ticket, comments };
};
