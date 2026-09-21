import * as vscode from "vscode";

/** effective value ではなく各レイヤーを復元し、ユーザーの override を残す。 */
export const withConfiguration = async <T>(
  key: string,
  value: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const settings = vscode.workspace.getConfiguration("redmine-client");
  const before = settings.inspect<string>(key);
  const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => {
    const configuration = vscode.workspace.getConfiguration("redmine-client", folder.uri);
    return { configuration, before: configuration.inspect<string>(key) };
  });
  try {
    for (const folder of folders) {
      if (folder.before?.workspaceFolderValue !== undefined) {
        await folder.configuration.update(key, undefined, vscode.ConfigurationTarget.WorkspaceFolder);
      }
    }
    if (before?.workspaceValue !== undefined) {
      await settings.update(key, undefined, vscode.ConfigurationTarget.Workspace);
    }
    await settings.update(key, value, vscode.ConfigurationTarget.Global);
    return await operation();
  } finally {
    await settings.update(key, before?.globalValue, vscode.ConfigurationTarget.Global);
    if (before?.workspaceValue !== undefined) {
      await settings.update(key, before.workspaceValue, vscode.ConfigurationTarget.Workspace);
    }
    for (const folder of folders) {
      if (folder.before?.workspaceFolderValue !== undefined) {
        await folder.configuration.update(key, folder.before.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder);
      }
    }
  }
};
