import type { TicketListSettings } from "../views/projectListSettings";

// ── ViewModel types ───────────────────────────────────────────────────────

export interface DashboardProjectNode {
  id: number;
  name: string;
  identifier: string;
  parentId?: number;
  level: number;
}

export type DashboardSyncState =
  | "Synced"
  | "Draft"
  | "Dirty"
  | "Queued"
  | "Syncing"
  | "Failed"
  | "Conflict";

export interface DashboardTicketNode {
  id: number;
  subject: string;
  statusName?: string;
  statusId?: number;
  priorityName?: string;
  priorityId?: number;
  trackerName?: string;
  trackerId?: number;
  assigneeName?: string;
  assigneeId?: number;
  dueDate?: string;
  parentId?: number;
  syncState: DashboardSyncState;
  children: DashboardTicketNode[];
  level: number;
}

export interface DashboardTicketDetail {
  id: number;
  subject: string;
  description?: string;
  statusName?: string;
  priorityName?: string;
  trackerName?: string;
  assigneeName?: string;
  dueDate?: string;
  syncState: DashboardSyncState;
  projectId?: number;
}

export type DashboardUnsyncedKind = "ticket" | "newTicket" | "comment";

export type DashboardUnsyncedKey =
  | { kind: "ticket"; ticketId: number }
  | { kind: "newTicket"; documentUri?: string }
  | { kind: "comment"; ticketId: number; commentId?: number; documentUri?: string };

export interface DashboardUnsyncedItem {
  key: DashboardUnsyncedKey;
  label: string;
  detail?: string;
  documentUri?: string;
}

export interface DashboardCommentItem {
  id: number;
  authorName: string;
  body: string;
  createdAt?: string;
  updatedAt?: string;
  editableByCurrentUser: boolean;
}

export interface DashboardTicketSettingsViewModel {
  filters: {
    subjectQuery: string;
    priorityIds: number[];
    statusIds: number[];
    trackerIds: number[];
    assigneeIds: number[];
    includeUnassigned: boolean;
  };
  sort: { field?: string; direction: "asc" | "desc" };
  dueDate: {
    showWithin7Days: boolean;
    showWithin3Days: boolean;
    showWithin1Day: boolean;
    showOverdue: boolean;
  };
  offlineSyncMode: "auto" | "manual";
}

export interface DashboardSelectedProject {
  id?: number;
  identifier?: string;
  name?: string;
}

export interface DashboardState {
  selectedProject?: DashboardSelectedProject;
  includeChildProjects: boolean;
  projects: DashboardProjectNode[];
  tickets: DashboardTicketNode[];
  totalTicketCount: number;
  loadedTicketCount: number;
  selectedTicketId?: number;
  selectedTicket?: DashboardTicketDetail;
  unsynced: {
    totalCount: number;
    items: DashboardUnsyncedItem[];
  };
  comments: {
    ticketId?: number;
    loading: boolean;
    items: DashboardCommentItem[];
    error?: string;
  };
  settings: DashboardTicketSettingsViewModel;
  loading: {
    tickets: boolean;
    comments: boolean;
  };
  errors: {
    tickets?: string;
    comments?: string;
    operation?: string;
  };
}

// ── Message Protocol ──────────────────────────────────────────────────────

export type DashboardSettingsPatch = Partial<TicketListSettings>;

export interface DashboardGeneralSettingsPatch {
  offlineSyncMode?: "auto" | "manual";
  includeChildProjects?: boolean;
  ticketListLimit?: number;
}

export type DashboardRequest =
  | { type: "dashboard.ready"; requestId: string }
  | { type: "dashboard.refresh"; requestId: string }
  | { type: "project.select"; requestId: string; projectId: number }
  | { type: "project.toggleChildren"; requestId: string; includeChildProjects: boolean }
  | { type: "tickets.refresh"; requestId: string }
  | { type: "tickets.loadMore"; requestId: string }
  | { type: "ticket.select"; requestId: string; ticketId: number }
  | { type: "ticket.openEditor"; requestId: string; ticketId: number }
  | { type: "ticket.openBrowser"; requestId: string; ticketId: number }
  | { type: "ticket.create"; requestId: string }
  | { type: "ticket.createChild"; requestId: string; parentTicketId: number }
  | { type: "comment.add"; requestId: string; ticketId: number }
  | { type: "comment.edit"; requestId: string; ticketId: number; commentId: number }
  | { type: "comment.reload"; requestId: string; ticketId: number }
  | { type: "unsynced.openLocalFile"; requestId: string; documentUri: string }
  | { type: "unsynced.syncOne"; requestId: string; key: DashboardUnsyncedKey }
  | { type: "unsynced.syncAll"; requestId: string }
  | { type: "settings.update"; requestId: string; patch: DashboardSettingsPatch }
  | { type: "settings.reset"; requestId: string }
  | { type: "settings.updateEditorDefault"; requestId: string; field: string; value: string }
  | { type: "settings.resetEditorDefaults"; requestId: string; fields: string[] }
  | { type: "settings.updateGeneral"; requestId: string; patch: DashboardGeneralSettingsPatch };

export type DashboardEvent =
  | { type: "dashboard.state"; state: DashboardState }
  | { type: "operation.started"; requestId: string; label?: string }
  | { type: "operation.success"; requestId: string; message: string }
  | { type: "operation.error"; requestId: string; message: string }
  | { type: "toast"; level: "info" | "warning" | "error" | "success"; message: string };

export const VIEW_ID_DASHBOARD = "redmine-clientActivityDashboard";
