import { Project, Ticket, Comment } from "../redmine/types";
import { OfflineSyncQueue } from "../views/offlineSyncStore";

export type OfflineSyncModeValue = "auto" | "manual";

export interface DashboardSettingsState {
  offlineSyncMode: OfflineSyncModeValue;
  includeChildProjects: boolean;
  ticketListLimit: number;
  titleFilter: string;
  sortField: string;
  sortOrder: "asc" | "desc";
  showDueDateIndicator: boolean;
}

export interface UnsyncedEntry {
  kind: "ticket" | "newTicket" | "comment";
  label: string;
  documentUri?: string;
  ticketId?: number;
  commentId?: number;
}

export interface DashboardState {
  projects: Project[];
  selectedProjectId: number | null;
  tickets: Ticket[];
  ticketsTotalCount: number;
  ticketsOffset: number;
  selectedTicketId: number | null;
  ticketDetail: Ticket | null;
  comments: Comment[];
  unsynced: UnsyncedEntry[];
  expandedTicketIds: number[];
  settings: DashboardSettingsState;
  activeTab: "tickets" | "comments" | "unsynced" | "settings";
  loading: boolean;
  error: string | null;
}

// Messages from Webview → Extension
export type DashboardMessage =
  | { type: "dashboard.ready" }
  | { type: "project.select"; projectId: number }
  | { type: "project.refresh" }
  | { type: "tickets.loadMore" }
  | { type: "ticket.select"; ticketId: number }
  | { type: "ticket.toggleExpand"; ticketId: number }
  | { type: "ticket.openInEditor"; ticketId: number }
  | { type: "ticket.openInBrowser"; ticketId: number }
  | { type: "ticket.createNew" }
  | { type: "ticket.createChild"; parentTicketId: number }
  | { type: "comment.add"; ticketId: number }
  | { type: "comment.edit"; ticketId: number; commentId: number }
  | { type: "unsynced.syncOne"; kind: "ticket" | "newTicket" | "comment"; ticketId?: number; commentId?: number; documentUri?: string }
  | { type: "unsynced.syncAll" }
  | { type: "unsynced.openLocalFile"; documentUri: string; requestId: string }
  | { type: "settings.update"; settings: Partial<DashboardSettingsState> }
  | { type: "tab.switch"; tab: DashboardState["activeTab"] }
  | { type: "project.openInBrowser"; projectId: number };

// Messages from Extension → Webview
export type DashboardPushMessage =
  | { type: "state.patch"; patch: Partial<DashboardState> }
  | { type: "toast.info"; message: string }
  | { type: "toast.warning"; message: string }
  | { type: "toast.error"; message: string }
  | { type: "error.response"; requestId: string; message: string };
