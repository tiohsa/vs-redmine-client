import * as vscode from "vscode";

const CONFIG_SECTION = "todoex";

export const getSettings = (): vscode.WorkspaceConfiguration =>
  vscode.workspace.getConfiguration(CONFIG_SECTION);

export const getBaseUrl = (): string =>
  getSettings().get<string>("baseUrl", "").trim();

export const getApiKey = (): string =>
  getSettings().get<string>("apiKey", "").trim();

export const getDefaultProjectId = (): string =>
  getSettings().get<string>("defaultProjectId", "").trim();

export const getIncludeChildProjects = (): boolean =>
  getSettings().get<boolean>("includeChildProjects", false);

export const getTicketListLimit = (): number =>
  getSettings().get<number>("ticketListLimit", 50);
