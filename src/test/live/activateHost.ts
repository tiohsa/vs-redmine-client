import * as vscode from "vscode";

/** テスト開始前に、本番activateを使うテスト専用ラッパーの起動完了を待つ。 */
export const mochaGlobalSetup = async (): Promise<void> => {
  const extension = vscode.extensions.getExtension("tiohsa.redmine-client");
  if (!extension) { throw new Error("実Redmineテスト用拡張がありません。"); }
  await extension.activate();
};
