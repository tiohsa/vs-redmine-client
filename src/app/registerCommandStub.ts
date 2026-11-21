import * as vscode from "vscode";

export const registerStubMessage = (
  commandId: string,
  message: string,
): vscode.Disposable =>
  vscode.commands.registerCommand(commandId, () => {
    vscode.window.showErrorMessage(message);
  });
