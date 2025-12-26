import * as vscode from "vscode";

const CONFIG_SECTION = "todoex";

export interface ProjectSelection {
  id?: number;
  name?: string;
}

export const getProjectSelection = (): ProjectSelection => {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const idRaw = config.get<string>("selectedProjectId", "").trim();
  const name = config.get<string>("selectedProjectName", "").trim();
  const id = Number(idRaw);

  return {
    id: !idRaw || Number.isNaN(id) ? undefined : id,
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
