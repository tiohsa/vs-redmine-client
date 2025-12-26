import * as vscode from "vscode";

export const showError = (message: string): void => {
  void vscode.window.showErrorMessage(message);
};

export const showWarning = (message: string): void => {
  void vscode.window.showWarningMessage(message);
};

export const showInfo = (message: string): void => {
  void vscode.window.showInformationMessage(message);
};
