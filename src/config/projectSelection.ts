import * as vscode from "vscode";

const CONFIG_SECTION = "redmine-client";

export interface ProjectSelection {
  id?: number;
  name?: string;
}

export const isValidProjectId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export const parseConfiguredProjectId = (raw: string | undefined): number | undefined => {
  if (!raw?.trim()) {
    return undefined;
  }
  const id = Number(raw.trim());
  return isValidProjectId(id) ? id : undefined;
};

export const getProjectSelection = (): ProjectSelection => {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const idRaw = config.get<string>("selectedProjectId", "").trim();
  const name = config.get<string>("selectedProjectName", "").trim();
  const id = parseConfiguredProjectId(idRaw);

  return {
    id,
    name: name || undefined,
  };
};

export const setProjectSelection = async (id: number, name: string): Promise<void> => {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update(
    "selectedProjectId",
    String(id),
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    "selectedProjectName",
    name,
    vscode.ConfigurationTarget.Global,
  );
};

export const clearProjectSelection = async (): Promise<void> => {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update("selectedProjectId", undefined, vscode.ConfigurationTarget.Global);
  await config.update("selectedProjectName", undefined, vscode.ConfigurationTarget.Global);
};
