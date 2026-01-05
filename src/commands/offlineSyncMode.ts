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
    { label: "Auto sync on save", description: "Redmineへ自動で反映", mode: "auto" },
    { label: "Manual offline sync", description: "保存はキューに保存して手動で反映", mode: "manual" },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: "Offline sync mode",
    canPickMany: false,
    placeHolder: current === "manual" ? "Manual offline sync" : "Auto sync on save",
  });
  if (!picked) {
    return;
  }
  await setOfflineSyncMode(picked.mode);
  await refreshOfflineSyncContext(picked.mode);
};
