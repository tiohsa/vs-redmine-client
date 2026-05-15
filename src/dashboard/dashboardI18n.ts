import * as vscode from "vscode";

export interface DashboardStrings {
  // Header
  selectProjectPlaceholder: string;
  selectProjectTitle: string;
  includeChildren: string;
  refresh: string;
  newTicket: string;
  // Tabs
  tabTickets: string;
  tabUnsynced: string;
  tabComments: string;
  tabSettings: string;
  // Search
  searchPlaceholder: string;
  clearSearch: string;
  // Sync states
  syncDirty: string;
  syncQueued: string;
  syncConflict: string;
  syncFailed: string;
  syncSyncing: string;
  // Due date badges
  dueOverdue: string;
  due1Day: string;
  due3Days: string;
  due7Days: string;
  // Ticket row
  expandTitle: string;
  collapseTitle: string;
  ticketActionMenu: string;
  ticketActionMenuShort: string;
  openInEditor: string;
  addCommentAction: string;
  openInBrowser: string;
  createChildTicket: string;
  // Ticket list states
  noProjectSelected: string;
  loadingTickets: string;
  errorLabel: string;
  noTicketsFound: string;
  loadMore: string;
  // Ticket detail panel
  closeDetail: string;
  openDetail: string;
  openTicketAction: string;
  commentAction: string;
  syncAction: string;
  statusFallbackHint: string;
  loadingEditOptions: string;
  trackerUnavailable: string;
  // Composer panel
  createChildTicketTitle: string;
  createNewTicketTitle: string;
  loadingTrackers: string;
  cancelAction: string;
  createDraft: string;
  syncNewTicket: string;
  assigneeUnassigned: string;
  // Filter chips
  filterSubjectPrefix: string;
  filterAssigneeCount: string;
  filterIncludeUnassigned: string;
  filterStatusCount: string;
  // Unsynced tab
  noUnsyncedChanges: string;
  unsyncedKindTicket: string;
  unsyncedKindNewTicket: string;
  unsyncedKindComment: string;
  unsyncedKindFile: string;
  openFileAction: string;
  discardAction: string;
  discardTitle: string;
  syncAllBtn: string;
  // Comments tab
  commentsForTicket: string;
  addCommentBtn: string;
  reloadComments: string;
  noTicketSelected: string;
  loadingComments: string;
  noComments: string;
  unsyncedEditBadge: string;
  unsyncedEditAriaLabel: string;
  editCommentAction: string;
  openInRedmine: string;
  // Settings tab — API key
  sectionApiKey: string;
  apiKeyStatusSet: string;
  apiKeyStatusNotSet: string;
  setApiKeyBtn: string;
  clearApiKeyBtn: string;
  // Settings tab
  sectionTicketFilter: string;
  filterAssigneeLabel: string;
  filterAssigneeAria: string;
  filterIncludeUnassignedLabel: string;
  filterStatusLabel: string;
  filterStatusAria: string;
  sectionSort: string;
  sortFieldLabel: string;
  sortDefaultOption: string;
  sortPriority: string;
  sortStatus: string;
  sortTracker: string;
  sortAssignee: string;
  sortDirectionLabel: string;
  sortAsc: string;
  sortDesc: string;
  sectionDueDate: string;
  sectionSync: string;
  offlineSyncModeLabel: string;
  offlineSyncAuto: string;
  offlineSyncManual: string;
  sectionGeneral: string;
  ticketLimitLabel: string;
  resetSettings: string;
  // Project label
  projectNone: string;
}

export const buildDashboardStrings = (): DashboardStrings => ({
  // Header
  selectProjectPlaceholder: vscode.l10n.t("— Select project —"),
  selectProjectTitle: vscode.l10n.t("Select project"),
  includeChildren: vscode.l10n.t("Include children"),
  refresh: vscode.l10n.t("Refresh"),
  newTicket: vscode.l10n.t("New ticket"),
  // Tabs
  tabTickets: vscode.l10n.t("Tickets"),
  tabUnsynced: vscode.l10n.t("Unsynced"),
  tabComments: vscode.l10n.t("Comments"),
  tabSettings: vscode.l10n.t("Settings"),
  // Search
  searchPlaceholder: vscode.l10n.t("Search tickets…"),
  clearSearch: vscode.l10n.t("Clear search"),
  // Sync states
  syncDirty: vscode.l10n.t("Unsynced"),
  syncQueued: vscode.l10n.t("Queued"),
  syncConflict: vscode.l10n.t("Conflict"),
  syncFailed: vscode.l10n.t("Failed"),
  syncSyncing: vscode.l10n.t("Syncing"),
  // Due date badges
  dueOverdue: vscode.l10n.t("Overdue"),
  due1Day: vscode.l10n.t("Within 1 day"),
  due3Days: vscode.l10n.t("Within 3 days"),
  due7Days: vscode.l10n.t("Within 7 days"),
  // Ticket row
  expandTitle: vscode.l10n.t("Expand"),
  collapseTitle: vscode.l10n.t("Collapse"),
  ticketActionMenu: vscode.l10n.t("Ticket actions"),
  ticketActionMenuShort: vscode.l10n.t("Actions"),
  openInEditor: vscode.l10n.t("Open in editor"),
  addCommentAction: vscode.l10n.t("Add comment"),
  openInBrowser: vscode.l10n.t("Open in browser"),
  createChildTicket: vscode.l10n.t("Create child ticket"),
  // Ticket list states
  noProjectSelected: vscode.l10n.t("No project selected. Select a project above to view tickets."),
  loadingTickets: vscode.l10n.t("Loading tickets…"),
  errorLabel: vscode.l10n.t("Error"),
  noTicketsFound: vscode.l10n.t("No tickets match the filter."),
  loadMore: vscode.l10n.t("Load more…"),
  // Ticket detail panel
  closeDetail: vscode.l10n.t("Close detail"),
  openDetail: vscode.l10n.t("Open detail"),
  openTicketAction: vscode.l10n.t("Open"),
  commentAction: vscode.l10n.t("Comment"),
  syncAction: vscode.l10n.t("Sync"),
  statusFallbackHint: vscode.l10n.t("Status options using global fallback."),
  loadingEditOptions: vscode.l10n.t("Loading edit options…"),
  trackerUnavailable: vscode.l10n.t("Cannot edit: tracker options unavailable."),
  // Composer panel
  createChildTicketTitle: vscode.l10n.t("Create child ticket"),
  createNewTicketTitle: vscode.l10n.t("Create new ticket"),
  loadingTrackers: vscode.l10n.t("Loading trackers…"),
  cancelAction: vscode.l10n.t("Cancel"),
  createDraft: vscode.l10n.t("Create Markdown draft"),
  syncNewTicket: vscode.l10n.t("Sync"),
  assigneeUnassigned: vscode.l10n.t("Unassigned"),
  // Filter chips
  filterSubjectPrefix: vscode.l10n.t("Subject: "),
  filterAssigneeCount: vscode.l10n.t("Assignee"),
  filterIncludeUnassigned: vscode.l10n.t("Include unassigned"),
  filterStatusCount: vscode.l10n.t("Status"),
  // Unsynced tab
  noUnsyncedChanges: vscode.l10n.t("No unsynced changes."),
  unsyncedKindTicket: vscode.l10n.t("Ticket"),
  unsyncedKindNewTicket: vscode.l10n.t("New ticket"),
  unsyncedKindComment: vscode.l10n.t("Comment"),
  unsyncedKindFile: vscode.l10n.t("File"),
  openFileAction: vscode.l10n.t("Open"),
  discardAction: vscode.l10n.t("Discard"),
  discardTitle: vscode.l10n.t("Discard unsynced local changes"),
  syncAllBtn: vscode.l10n.t("Sync all"),
  // Comments tab
  commentsForTicket: vscode.l10n.t("Comments for ticket"),
  addCommentBtn: vscode.l10n.t("Add"),
  reloadComments: vscode.l10n.t("Refresh"),
  noTicketSelected: vscode.l10n.t("Select a ticket to view comments."),
  loadingComments: vscode.l10n.t("Loading comments…"),
  noComments: vscode.l10n.t("No comments."),
  unsyncedEditBadge: vscode.l10n.t("Unsynced edit"),
  unsyncedEditAriaLabel: vscode.l10n.t("Has unsynced edits"),
  editCommentAction: vscode.l10n.t("Edit"),
  openInRedmine: vscode.l10n.t("Open in Redmine"),
  // Settings tab — API key
  sectionApiKey: vscode.l10n.t("API Key"),
  apiKeyStatusSet: vscode.l10n.t("Configured"),
  apiKeyStatusNotSet: vscode.l10n.t("Not configured"),
  setApiKeyBtn: vscode.l10n.t("Set API Key"),
  clearApiKeyBtn: vscode.l10n.t("Clear API Key"),
  // Settings tab
  sectionTicketFilter: vscode.l10n.t("Ticket filters"),
  filterAssigneeLabel: vscode.l10n.t("Assignee"),
  filterAssigneeAria: vscode.l10n.t("Assignee filter"),
  filterIncludeUnassignedLabel: vscode.l10n.t("Include unassigned"),
  filterStatusLabel: vscode.l10n.t("Status"),
  filterStatusAria: vscode.l10n.t("Status filter"),
  sectionSort: vscode.l10n.t("Sort"),
  sortFieldLabel: vscode.l10n.t("Sort field"),
  sortDefaultOption: vscode.l10n.t("Default"),
  sortPriority: vscode.l10n.t("Priority"),
  sortStatus: vscode.l10n.t("Status"),
  sortTracker: vscode.l10n.t("Tracker"),
  sortAssignee: vscode.l10n.t("Assignee"),
  sortDirectionLabel: vscode.l10n.t("Sort direction"),
  sortAsc: vscode.l10n.t("Ascending"),
  sortDesc: vscode.l10n.t("Descending"),
  sectionDueDate: vscode.l10n.t("Due date indicators"),
  sectionSync: vscode.l10n.t("Sync"),
  offlineSyncModeLabel: vscode.l10n.t("Offline sync mode"),
  offlineSyncAuto: vscode.l10n.t("Auto"),
  offlineSyncManual: vscode.l10n.t("Manual"),
  sectionGeneral: vscode.l10n.t("General"),
  ticketLimitLabel: vscode.l10n.t("Tickets per load"),
  resetSettings: vscode.l10n.t("Reset settings"),
  // Project label
  projectNone: vscode.l10n.t("(none)"),
});
