import * as vscode from "vscode";

const CONFIG_SECTION = "redmine-client";

export const getSettings = (): vscode.WorkspaceConfiguration =>
  vscode.workspace.getConfiguration(CONFIG_SECTION);

export const getBaseUrl = (): string =>
  getSettings().get<string>("baseUrl", "").trim();

export const getApiKey = (): string =>
  getSettings().get<string>("apiKey", "").trim();

export const getIgnoreSSLErrors = (): boolean =>
  getSettings().get<boolean>("ignoreSSLErrors", false);

export const getDefaultProjectId = (): string =>
  getSettings().get<string>("defaultProjectId", "").trim();

export const getIncludeChildProjects = (): boolean =>
  getSettings().get<boolean>("includeChildProjects", false);

export const getTicketListLimit = (): number =>
  getSettings().get<number>("ticketListLimit", 50);

export const getEditorStorageDirectory = (): string =>
  getSettings().get<string>("editorStorageDirectory", "").trim();

export const getNewTicketTemplatePath = (): string =>
  getSettings().get<string>("newTicketTemplatePath", "").trim();

export const EDITOR_DEFAULT_FIELDS = [
  "subject",
  "description",
  "tracker",
  "priority",
  "status",
  "due_date",
] as const;

export type EditorDefaultField = (typeof EDITOR_DEFAULT_FIELDS)[number];
