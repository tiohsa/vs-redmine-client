import * as vscode from "vscode";

export interface DashboardStrings {
  language: string;
  dashboardTitle: string;
  selectTicketHint: string;
  searchEmptyHint: string;
  retry: string;
  startDate: string;
  dueDateLabel: string;
  descriptionLabel: string;
  selectOption: string;
  parentLabel: string;
  projectLabel: string;
  synced: string;
  draft: string;
  composerHint: string;
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
  syncReviewRequired: string;
  // Due date badges
  dueOverdue: string;
  due1Day: string;
  due3Days: string;
  due7Days: string;
  // Ticket row
  expandTitle: string;
  collapseTitle: string;
  ticketActionMenu: string;
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
  ticketCountLabel: string;
  // Ticket detail panel
  openTicketTooltip: string;
  syncToRedmine: string;
  syncTicketTooltip: string;
  editingState: string;
  editorSyncHint: string;
  remoteDescription: string;
  descriptionUnsyncedWarning: string;
  noDescription: string;
  dismissDetail: string;
  ticketMetadata: string;
  editMetadata: string;
  applyMetadata: string;
  applyingMetadata: string;
  metadataApplyHint: string;
  notSet: string;
  closeDetail: string;
  openDetail: string;
  statusFallbackHint: string;
  loadingEditOptions: string;
  trackerUnavailable: string;
  // Composer panel
  createChildTicketTitle: string;
  createNewTicketTitle: string;
  loadingTrackers: string;
  cancelAction: string;
  createDraft: string;
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
  discardAction: string;
  discardTitle: string;
  syncAllBtn: string;
  unsyncedCountLabel: string;
  // Comments tab
  commentsForTicket: string;
  reloadComments: string;
  noTicketSelected: string;
  loadingComments: string;
  noComments: string;
  unsyncedEditBadge: string;
  unsyncedEditAriaLabel: string;
  // Settings tab — API key
  sectionApiKey: string;
  apiKeyStatusSet: string;
  apiKeyStatusNotSet: string;
  setApiKeyBtn: string;
  changeApiKeyBtn: string;
  clearApiKeyBtn: string;
  // Settings tab
  sectionConnection: string;
  redmineUrlLabel: string;
  defaultProjectLabel: string;
  requestTimeoutLabel: string;
  ignoreSSLErrorsLabel: string;
  ignoreSSLErrorsWarning: string;
  sectionTickets: string;
  includeChildProjectsLabel: string;
  sectionEditor: string;
  editorStorageDirectoryLabel: string;
  defaultSubjectLabel: string;
  defaultDescriptionLabel: string;
  defaultTrackerLabel: string;
  defaultPriorityLabel: string;
  defaultStatusLabel: string;
  defaultDueDateLabel: string;
  resetEditorDefaults: string;
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
  sectionDisplay: string;
  showStatusLabel: string;
  showDueDateLabel: string;
  showTrackerLabel: string;
  showPriorityLabel: string;
  showAssigneeLabel: string;
  sectionGeneral: string;
  ticketLimitLabel: string;
  resetSettings: string;
  // Project label
  projectNone: string;
}

export const buildDashboardStrings = (): DashboardStrings => ({
  language: vscode.env.language,
  dashboardTitle: vscode.l10n.t("Dashboard"),
  selectTicketHint: vscode.l10n.t("Select a ticket to view its details and actions."),
  searchEmptyHint: vscode.l10n.t("Try another search or review your ticket filters in Settings."),
  retry: vscode.l10n.t("Retry"),
  startDate: vscode.l10n.t("Start date"),
  dueDateLabel: vscode.l10n.t("Due date"),
  descriptionLabel: vscode.l10n.t("Description"),
  selectOption: vscode.l10n.t("Select…"),
  parentLabel: vscode.l10n.t("Parent"),
  projectLabel: vscode.l10n.t("Project"),
  synced: vscode.l10n.t("Synced"),
  draft: vscode.l10n.t("Draft"),
  composerHint: vscode.l10n.t("Create a draft, edit it in the editor, then sync the ticket."),
  // Header
  selectProjectPlaceholder: vscode.l10n.t("— Select project —"),
  selectProjectTitle: vscode.l10n.t("Select project"),
  includeChildren: vscode.l10n.t("Include children"),
  refresh: vscode.l10n.t("Refresh dashboard"),
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
  syncDirty: vscode.l10n.t("Unsynced changes"),
  syncQueued: vscode.l10n.t("Waiting to sync"),
  syncConflict: vscode.l10n.t("Conflicting changes"),
  syncFailed: vscode.l10n.t("Sync failed"),
  syncSyncing: vscode.l10n.t("Syncing…"),
  syncReviewRequired: vscode.l10n.t("Review required"),
  // Due date badges
  dueOverdue: vscode.l10n.t("Overdue"),
  due1Day: vscode.l10n.t("Within 1 day"),
  due3Days: vscode.l10n.t("Within 3 days"),
  due7Days: vscode.l10n.t("Within 7 days"),
  // Ticket row
  expandTitle: vscode.l10n.t("Expand"),
  collapseTitle: vscode.l10n.t("Collapse"),
  ticketActionMenu: vscode.l10n.t("Ticket actions"),
  openInEditor: vscode.l10n.t("Edit in VS Code"),
  addCommentAction: vscode.l10n.t("Add comment"),
  openInBrowser: vscode.l10n.t("Open in browser"),
  createChildTicket: vscode.l10n.t("Create child ticket"),
  // Ticket list states
  noProjectSelected: vscode.l10n.t("No project selected. Select a project above to view tickets."),
  loadingTickets: vscode.l10n.t("Loading tickets…"),
  errorLabel: vscode.l10n.t("Error"),
  noTicketsFound: vscode.l10n.t("No tickets match the filter."),
  loadMore: vscode.l10n.t("Load more…"),
  ticketCountLabel: vscode.l10n.t("Showing {0} tickets"),
  // Ticket detail panel
  openTicketTooltip: vscode.l10n.t("Edit ticket Markdown in VS Code"),
  syncToRedmine: vscode.l10n.t("Sync to Redmine"),
  syncTicketTooltip: vscode.l10n.t("Sync VS Code editor changes to Redmine"),
  editingState: vscode.l10n.t("Editing state"),
  editorSyncHint: vscode.l10n.t("Edit Markdown in VS Code, then use “Sync to Redmine” to apply your changes."),
  remoteDescription: vscode.l10n.t("Description (on Redmine)"),
  descriptionUnsyncedWarning: vscode.l10n.t("Changes may not yet be reflected in the Redmine description below."),
  noDescription: vscode.l10n.t("No description."),
  dismissDetail: vscode.l10n.t("Dismiss ticket detail"),
  ticketMetadata: vscode.l10n.t("Ticket information"),
  editMetadata: vscode.l10n.t("Edit"),
  applyMetadata: vscode.l10n.t("Apply changes"),
  applyingMetadata: vscode.l10n.t("Applying…"),
  metadataApplyHint: vscode.l10n.t("Apply changes to the local editor or draft, then sync to Redmine."),
  notSet: vscode.l10n.t("Not set"),
  closeDetail: vscode.l10n.t("Close detail"),
  openDetail: vscode.l10n.t("Open detail"),
  statusFallbackHint: vscode.l10n.t("Status options using global fallback."),
  loadingEditOptions: vscode.l10n.t("Loading edit options…"),
  trackerUnavailable: vscode.l10n.t("Cannot edit: tracker options unavailable."),
  // Composer panel
  createChildTicketTitle: vscode.l10n.t("Create child ticket"),
  createNewTicketTitle: vscode.l10n.t("Create new ticket"),
  loadingTrackers: vscode.l10n.t("Loading trackers…"),
  cancelAction: vscode.l10n.t("Cancel"),
  createDraft: vscode.l10n.t("Create Markdown draft"),
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
  discardAction: vscode.l10n.t("Discard"),
  discardTitle: vscode.l10n.t("Discard unsynced local changes"),
  syncAllBtn: vscode.l10n.t("Sync all"),
  unsyncedCountLabel: vscode.l10n.t("Unsynced changes: {0}"),
  // Comments tab
  commentsForTicket: vscode.l10n.t("Comments for ticket"),
  reloadComments: vscode.l10n.t("Refresh"),
  noTicketSelected: vscode.l10n.t("Select a ticket to view comments."),
  loadingComments: vscode.l10n.t("Loading comments…"),
  noComments: vscode.l10n.t("No comments."),
  unsyncedEditBadge: vscode.l10n.t("Unsynced edit"),
  unsyncedEditAriaLabel: vscode.l10n.t("Has unsynced edits"),
  // Settings tab — API key
  sectionApiKey: vscode.l10n.t("API Key"),
  apiKeyStatusSet: vscode.l10n.t("Configured"),
  apiKeyStatusNotSet: vscode.l10n.t("Not configured"),
  setApiKeyBtn: vscode.l10n.t("Set API Key"),
  changeApiKeyBtn: vscode.l10n.t("Change API Key"),
  clearApiKeyBtn: vscode.l10n.t("Clear API Key"),
  // Settings tab
  sectionConnection: vscode.l10n.t("Connection"),
  redmineUrlLabel: vscode.l10n.t("Redmine URL"),
  defaultProjectLabel: vscode.l10n.t("Default project"),
  requestTimeoutLabel: vscode.l10n.t("Request timeout (ms)"),
  ignoreSSLErrorsLabel: vscode.l10n.t("Ignore SSL certificate errors"),
  ignoreSSLErrorsWarning: vscode.l10n.t("Use only in trusted development environments."),
  sectionTickets: vscode.l10n.t("Tickets"),
  includeChildProjectsLabel: vscode.l10n.t("Include child projects"),
  sectionEditor: vscode.l10n.t("Editor"),
  editorStorageDirectoryLabel: vscode.l10n.t("Storage directory"),
  defaultSubjectLabel: vscode.l10n.t("Default subject"),
  defaultDescriptionLabel: vscode.l10n.t("Default description"),
  defaultTrackerLabel: vscode.l10n.t("Default tracker"),
  defaultPriorityLabel: vscode.l10n.t("Default priority"),
  defaultStatusLabel: vscode.l10n.t("Default status"),
  defaultDueDateLabel: vscode.l10n.t("Default due date"),
  resetEditorDefaults: vscode.l10n.t("Reset editor defaults"),
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
  sectionSync: vscode.l10n.t("Synchronization"),
  offlineSyncModeLabel: vscode.l10n.t("Offline sync mode"),
  offlineSyncAuto: vscode.l10n.t("Auto"),
  offlineSyncManual: vscode.l10n.t("Manual"),
  sectionDisplay: vscode.l10n.t("Display"),
  showStatusLabel: vscode.l10n.t("Show status"),
  showDueDateLabel: vscode.l10n.t("Show due date"),
  showTrackerLabel: vscode.l10n.t("Show tracker"),
  showPriorityLabel: vscode.l10n.t("Show priority"),
  showAssigneeLabel: vscode.l10n.t("Show assignee name"),
  sectionGeneral: vscode.l10n.t("General"),
  ticketLimitLabel: vscode.l10n.t("Tickets per load"),
  resetSettings: vscode.l10n.t("Reset display settings"),
  // Project label
  projectNone: vscode.l10n.t("(none)"),
});
