export const TICKET_SETTINGS_COMMANDS = {
  titleFilter: "redmine-client.configureTicketTitleFilter",
  priorityFilter: "redmine-client.configureTicketPriorityFilter",
  statusFilter: "redmine-client.configureTicketStatusFilter",
  trackerFilter: "redmine-client.configureTicketTrackerFilter",
  assigneeFilter: "redmine-client.configureTicketAssigneeFilter",
  sort: "redmine-client.configureTicketSort",
  dueDate: "redmine-client.configureTicketDueDateDisplay",
  offlineSyncMode: "redmine-client.configureOfflineSyncMode",
  reset: "redmine-client.resetTicketListSettings",
} as const;

export const EDITOR_DEFAULT_COMMANDS = {
  subject: "redmine-client.configureEditorDefaultSubject",
  description: "redmine-client.configureEditorDefaultDescription",
  tracker: "redmine-client.configureEditorDefaultTracker",
  priority: "redmine-client.configureEditorDefaultPriority",
  status: "redmine-client.configureEditorDefaultStatus",
  dueDate: "redmine-client.configureEditorDefaultDueDate",
  reset: "redmine-client.resetEditorDefaults",
} as const;

export const CREATE_TICKET_FROM_MARKDOWN_HEADER_COMMAND =
  "redmine-client.createTicketFromMarkdownHeader";

export const INSERT_REDMINE_TICKET_FRONTMATTER_COMMAND =
  "redmine-client.insertRedmineTicketFrontmatter";

