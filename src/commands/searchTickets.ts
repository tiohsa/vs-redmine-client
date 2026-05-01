import * as vscode from "vscode";

export const searchTickets = async (): Promise<void> => {
  await vscode.window.showErrorMessage("Dashboard からチケットを検索・選択してください。");
};
