import * as vscode from "vscode";

export const createEmptyStateItem = (message: string): vscode.TreeItem => {
  const item = new vscode.TreeItem(message, vscode.TreeItemCollapsibleState.None);
  item.contextValue = "viewStateEmpty";
  return item;
};

export const createErrorStateItem = (message: string): vscode.TreeItem => {
  const item = new vscode.TreeItem(message, vscode.TreeItemCollapsibleState.None);
  item.contextValue = "viewStateError";
  item.tooltip = message;
  return item;
};
