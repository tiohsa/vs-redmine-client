import * as vscode from "vscode";

export const createCycleWarningItem = (label: string): vscode.TreeItem => {
  const item = new vscode.TreeItem(
    `Cycle detected: ${label}`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.contextValue = "treeCycleWarning";
  item.tooltip = `Cycle detected for ${label}`;
  item.iconPath = new vscode.ThemeIcon("warning");
  return item;
};
