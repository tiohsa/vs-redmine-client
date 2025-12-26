import * as vscode from "vscode";

export const registerFocusRefresh = (
  view: vscode.TreeView<unknown>,
  refresh: () => void,
): vscode.Disposable =>
  view.onDidChangeVisibility((event) => {
    if (event.visible) {
      refresh();
    }
  });
