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
  assigneeId?: number;
  assigneeName?: string;
  projectId: number;
  createdAt?: string;
  updatedAt?: string;
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
    status?: { id: number; name: string };
    assigned_to?: RedmineUserRef;
    created_on?: string;
    updated_on?: string;
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
    status?: { id: number; name: string };
    assigned_to?: RedmineUserRef;
    created_on?: string;
    updated_on?: string;
    journals?: Array<{
      id: number;
      notes?: string;
      created_on?: string;
      updated_on?: string;
      user?: RedmineUserRef;
    }>;
  };
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
