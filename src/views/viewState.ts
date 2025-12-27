import * as vscode from "vscode";

export type EditorDisplaySource = "draft" | "saved";
export type EditorDisplayState = { source: EditorDisplaySource; lastLoadedAt: number };
const editorDisplayState = new Map<string, EditorDisplayState>();

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

export const setEditorDisplayState = (uri: string, state: EditorDisplayState): void => {
  editorDisplayState.set(uri, state);
};

export const getEditorDisplayState = (uri: string): EditorDisplayState | undefined =>
  editorDisplayState.get(uri);

export const clearEditorDisplayState = (uri?: string): void => {
  if (uri) {
    editorDisplayState.delete(uri);
    return;
  }

  editorDisplayState.clear();
};
