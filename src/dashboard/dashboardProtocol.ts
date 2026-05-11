import type {
  DueDateDisplayRule,
  TicketFilterSelection,
  TicketListSettings,
  TicketSortPreference,
} from "../views/projectListSettings";

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
  startDate?: string;
  projectId?: number;
  projectName?: string;
  parentId?: number;
  parentSubject?: string;
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
  startDate?: string;
  syncState: DashboardSyncState;
  projectId?: number;
  projectName?: string;
  parentId?: number;
  parentSubject?: string;
  lastSyncedAt?: string;
}

export interface DashboardMetadataOption {
  id: number;
  name: string;
}

export interface DashboardMetadataOptions {
  trackers: DashboardMetadataOption[];
  priorities: DashboardMetadataOption[];
  statuses: DashboardMetadataOption[];
}

export interface DashboardEditOptions {
  ticketId: number;
  projectId: number;
  trackers: DashboardMetadataOption[];
  priorities: DashboardMetadataOption[];
  statuses: DashboardMetadataOption[];
  assignees: DashboardMetadataOption[];
  statusFallback: boolean;
  loading: boolean;
  error?: string;
}

export interface DashboardTicketFilterOptions {
  assignees: DashboardMetadataOption[];
  statuses: DashboardMetadataOption[];
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
  hasUnsyncedEdit: boolean;
}

export interface DashboardTicketSettingsViewModel {
  filters: TicketFilterSelection;
  sort: TicketSortPreference;
  dueDate: DueDateDisplayRule;
  offlineSyncMode: "auto" | "manual";
  ticketListLimit: number;
  showStatus: boolean;
  showDueDate: boolean;
  apiKeyStatus: "set" | "notSet";
}

export interface DashboardSelectedProject {
  id?: number;
  identifier?: string;
  name?: string;
}

export interface NewTicketComposerValues {
  subject: string;
  tracker?: string;
  priority?: string;
  status?: string;
  assigned_to?: string;
  start_date: string;
  due_date: string;
  description: string;
}

export type DashboardWorkPanel =
  | {
    mode: "detail";
    ticketId: number;
  }
  | {
    mode: "newTicket";
    loading: boolean;
    projectId: number;
    projectName: string;
    trackers: DashboardMetadataOption[];
    priorities: DashboardMetadataOption[];
    statuses: DashboardMetadataOption[];
    assignees: DashboardMetadataOption[];
    values: NewTicketComposerValues;
    draftUri?: string;
    error?: string;
  }
  | {
    mode: "childTicket";
    loading: boolean;
    projectId: number;
    projectName: string;
    parentTicketId: number;
    parentSubject: string;
    trackers: DashboardMetadataOption[];
    priorities: DashboardMetadataOption[];
    statuses: DashboardMetadataOption[];
    assignees: DashboardMetadataOption[];
    values: NewTicketComposerValues;
    draftUri?: string;
    error?: string;
  };

export interface DashboardState {
  selectedProject?: DashboardSelectedProject;
  includeChildProjects: boolean;
  projects: DashboardProjectNode[];
  tickets: DashboardTicketNode[];
  totalTicketCount: number;
  loadedTicketCount: number;
  ticketFilterOptions: DashboardTicketFilterOptions;
  selectedTicketId?: number;
  selectedTicket?: DashboardTicketDetail;
  metadataOptions: DashboardMetadataOptions;
  editOptions?: DashboardEditOptions;
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
  workPanel?: DashboardWorkPanel;
}

// ── Message Protocol ──────────────────────────────────────────────────────

export type DashboardSettingsPatch = Partial<TicketListSettings>;

export type TicketMetadataPatch = {
  tracker?: string;
  priority?: string;
  status?: string;
  due_date?: string;
  start_date?: string;
  assignee?: string;
};

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
  | { type: "ticket.cancelComposer"; requestId: string }
  | { type: "ticket.syncNewTicketDraftFromComposer"; requestId: string }
  | {
      type: "ticket.createDraftFromComposer";
      requestId: string;
      values: {
        tracker: string;
        priority: string;
        status: string;
        assigned_to?: string;
        start_date?: string;
        due_date?: string;
        description?: string;
      };
    }
  | { type: "ticket.metadata.update"; requestId: string; ticketId: number; patch: TicketMetadataPatch }
  | { type: "ticket.syncSelected"; requestId: string; ticketId: number }
  | { type: "comment.add"; requestId: string; ticketId: number }
  | { type: "comment.edit"; requestId: string; ticketId: number; commentId: number }
  | { type: "comment.openBrowser"; requestId: string; ticketId: number; commentId: number; noteIndex?: number }
  | { type: "comment.reload"; requestId: string; ticketId: number }
  | { type: "unsynced.openLocalFile"; requestId: string; documentUri: string }
  | { type: "unsynced.syncOne"; requestId: string; key: DashboardUnsyncedKey }
  | { type: "unsynced.discardOne"; requestId: string; key: DashboardUnsyncedKey }
  | { type: "unsynced.syncAll"; requestId: string }
  | { type: "settings.update"; requestId: string; patch: DashboardSettingsPatch }
  | { type: "settings.reset"; requestId: string }
  | { type: "settings.updateEditorDefault"; requestId: string; field: string; value: string }
  | { type: "settings.resetEditorDefaults"; requestId: string; fields: string[] }
  | { type: "settings.updateGeneral"; requestId: string; patch: DashboardGeneralSettingsPatch }
  | { type: "apiKey.set"; requestId: string }
  | { type: "apiKey.clear"; requestId: string };

export type DashboardEvent =
  | { type: "dashboard.state"; state: DashboardState }
  | { type: "operation.started"; requestId: string; label?: string }
  | { type: "operation.success"; requestId: string; message: string }
  | { type: "operation.error"; requestId: string; message: string }
  | { type: "toast"; level: "info" | "warning" | "error" | "success"; message: string };

export const VIEW_ID_DASHBOARD = "redmine-clientActivityDashboard";
