import * as vscode from "vscode";
import {
  getOfflineSyncMode,
  OfflineSyncMode,
  setOfflineSyncMode,
} from "../config/settings";
import { setViewContext } from "../views/viewContext";

export const OFFLINE_SYNC_MANUAL_CONTEXT = "redmine-client.offlineSyncManual";

export const refreshOfflineSyncContext = async (
  mode: OfflineSyncMode = getOfflineSyncMode(),
): Promise<void> => {
  await setViewContext(OFFLINE_SYNC_MANUAL_CONTEXT, mode === "manual");
};

export const configureOfflineSyncMode = async (): Promise<void> => {
  const current = getOfflineSyncMode();
  const items: Array<vscode.QuickPickItem & { mode: OfflineSyncMode }> = [
    { label: vscode.l10n.t("Auto sync on save"), description: vscode.l10n.t("Auto sync on save description"), mode: "auto" },
    { label: vscode.l10n.t("Manual offline sync"), description: vscode.l10n.t("Manual offline sync description"), mode: "manual" },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t("Offline sync mode"),
    canPickMany: false,
    placeHolder: current === "manual" ? vscode.l10n.t("Manual offline sync") : vscode.l10n.t("Auto sync on save"),
  });
  if (!picked) {
    return;
  }
  await setOfflineSyncMode(picked.mode);
  await refreshOfflineSyncContext(picked.mode);
};
