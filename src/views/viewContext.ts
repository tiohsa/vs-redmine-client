import * as vscode from "vscode";

const contextValues = new Map<string, unknown>();

export const setViewContext = async (key: string, value: unknown): Promise<void> => {
  contextValues.set(key, value);
  await vscode.commands.executeCommand("setContext", key, value);
};

export const getViewContext = <T>(key: string): T | undefined =>
  contextValues.get(key) as T | undefined;

export const clearViewContext = (): void => {
  contextValues.clear();
};
