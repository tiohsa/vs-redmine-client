import * as vscode from "vscode";
import { LogEntry, logOperation } from "./redmineLogger";

export const showError = (message: string, logEntry?: LogEntry): void => {
  if (logEntry) { logOperation(logEntry); }
  void vscode.window.showErrorMessage(message);
};

export const showWarning = (message: string): void => {
  void vscode.window.showWarningMessage(message);
};

export const showInfo = (message: string): void => {
  void vscode.window.showInformationMessage(message);
};

export const showSuccess = (message: string): void => {
  void vscode.window.showInformationMessage(message);
};
