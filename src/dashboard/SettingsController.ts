import * as vscode from "vscode";
import {
  getOfflineSyncMode,
  setOfflineSyncMode,
  getIncludeChildProjects,
  getTicketListLimit,
  OfflineSyncMode,
} from "../config/settings";
import { DashboardSettingsState } from "./dashboardTypes";

export class SettingsController implements vscode.Disposable {
  private readonly onPushFn: (patch: Partial<{ settings: DashboardSettingsState }>) => void;
  private readonly configListener: vscode.Disposable;

  constructor(onPush: (patch: Partial<{ settings: DashboardSettingsState }>) => void) {
    this.onPushFn = onPush;
    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("redmine-client")) {
        this.pushSettings();
      }
    });
  }

  getCurrentSettings(): DashboardSettingsState {
    return {
      offlineSyncMode: getOfflineSyncMode(),
      includeChildProjects: getIncludeChildProjects(),
      ticketListLimit: getTicketListLimit(),
      titleFilter: "",
      sortField: "id",
      sortOrder: "desc",
      showDueDateIndicator: true,
    };
  }

  pushSettings(): void {
    this.onPushFn({ settings: this.getCurrentSettings() });
  }

  async applySettings(partial: Partial<DashboardSettingsState>): Promise<void> {
    if (partial.offlineSyncMode !== undefined) {
      await setOfflineSyncMode(partial.offlineSyncMode as OfflineSyncMode);
    }
    if (partial.includeChildProjects !== undefined) {
      await vscode.workspace.getConfiguration("redmine-client").update(
        "includeChildProjects",
        partial.includeChildProjects,
        vscode.ConfigurationTarget.Workspace,
      );
    }
    if (partial.ticketListLimit !== undefined) {
      await vscode.workspace.getConfiguration("redmine-client").update(
        "ticketListLimit",
        partial.ticketListLimit,
        vscode.ConfigurationTarget.Workspace,
      );
    }
    this.pushSettings();
  }

  dispose(): void {
    this.configListener.dispose();
  }
}
