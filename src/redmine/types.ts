export interface Project {
  id: number;
  name: string;
  identifier: string;
  parentId?: number;
  hasChildren?: boolean;
}

export interface Ticket {
  id: number;
  subject: string;
  description?: string;
  statusId?: number;
  statusName?: string;
  priorityId?: number;
  priorityName?: string;
  trackerId?: number;
  trackerName?: string;
  assigneeId?: number;
  assigneeName?: string;
  projectId: number;
  parentId?: number;
  hasChildren?: boolean;
  createdAt?: string;
  updatedAt?: string;
  dueDate?: string;
  startDate?: string;
  estimatedHours?: number;
  doneRatio?: number;
  // authorId?: number; // Removed
  authorName?: string;
}

export interface TicketUpdateFields {
  subject?: string;
  description?: string;
  statusId?: number;
  assigneeId?: number;
  trackerId?: number;
  priorityId?: number;
  dueDate?: string | null;
  uploads?: UploadToken[];
  startDate?: string | null;
  doneRatio?: number;
  estimatedHours?: number;
  authorId?: number;
}

export interface Comment {
  id: number;
  ticketId: number;
  authorId: number;
  authorName: string;
  body: string;
  createdAt?: string;
  updatedAt?: string;
  editableByCurrentUser: boolean;
  noteIndex?: number;
}

export interface Attachment {
  id?: number;
  ticketId?: number;
  filename: string;
  contentType: string;
  sizeBytes?: number;
  uploadToken?: string;
  downloadUrl?: string;
}

export interface UploadToken {
  token: string;
  filename: string;
  content_type: string;
}

export interface Filter {
  statusIds: string[];
  assigneeIds: string[];
  includeChildProjects: boolean;
  limit: number;
  offset: number;
}

export interface RedmineUserRef {
  id: number;
  name: string;
}

export interface RedmineProjectResponse {
  projects: Array<{ id: number; name: string; identifier: string; parent?: { id: number } }>;
}

export interface RedmineIssueListResponse {
  issues: Array<{
    id: number;
    subject: string;
    description?: string;
    project: { id: number; name: string };
    parent?: { id: number };
    status?: { id: number; name: string };
    priority?: { id: number; name: string };
    tracker?: { id: number; name: string };
    assigned_to?: RedmineUserRef;
    author?: RedmineUserRef;
    created_on?: string;
    updated_on?: string;
    due_date?: string;
    start_date?: string;
    done_ratio?: number;
    estimated_hours?: number;
  }>;
  total_count?: number;
  limit?: number;
  offset?: number;
}

export interface RedmineIssueDetailResponse {
  issue: {
    id: number;
    subject: string;
    description?: string;
    project: { id: number; name: string };
    parent?: { id: number };
    status?: { id: number; name: string };
    priority?: { id: number; name: string };
    tracker?: { id: number; name: string };
    assigned_to?: RedmineUserRef;
    author?: RedmineUserRef;
    created_on?: string;
    updated_on?: string;
    due_date?: string;
    start_date?: string;
    done_ratio?: number;
    estimated_hours?: number;
    journals?: Array<{
      id: number;
      notes?: string;
      created_on?: string;
      updated_on?: string;
      user?: RedmineUserRef;
    }>;
  };
}

export type RedmineIssueDetailResponseIssue = RedmineIssueDetailResponse["issue"];

export interface RedmineIssueStatusResponse {
  issue_statuses: Array<{ id: number; name: string }>;
}

export interface RedmineTrackerResponse {
  trackers: Array<{ id: number; name: string }>;
}

export interface RedminePriorityResponse {
  issue_priorities: Array<{ id: number; name: string }>;
}

export interface RedmineUploadResponse {
  upload: {
    token: string;
  };
}

export interface RedmineCurrentUserResponse {
  user: {
    id: number;
    name: string;
  };
}
