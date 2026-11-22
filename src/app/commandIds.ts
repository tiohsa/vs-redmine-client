export const TICKET_SETTINGS_COMMANDS = {
  offlineSyncMode: "redmine-client.configureOfflineSyncMode",
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


export const OPEN_IN_BROWSER_COMMAND = "redmine-client.openInBrowser";
export const OPEN_TICKET_IN_BROWSER_COMMAND = "redmine-client.openTicketInBrowser";
export const OPEN_COMMENT_IN_BROWSER_COMMAND = "redmine-client.openCommentInBrowser";
