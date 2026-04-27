import * as vscode from "vscode";
import {
  DEFAULT_TICKET_LIST_SETTINGS,
  TicketListSettings,
} from "../views/projectListSettings";
import {
  updateTicketEditorDefaultField,
  resetTicketEditorDefaultFields,
} from "../views/ticketEditorDefaultsStore";
import {
  setOfflineSyncMode,
  getOfflineSyncMode,
  EDITOR_DEFAULT_FIELDS,
  type EditorDefaultField,
} from "../config/settings";
import { buildSettingsDashboardViewModel } from "./viewModels/settingsDashboardViewModel";
import { DashboardStateStore } from "./DashboardStateStore";
import type { DashboardGeneralSettingsPatch } from "./dashboardProtocol";

export class SettingsController {
  private settings: TicketListSettings = { ...DEFAULT_TICKET_LIST_SETTINGS };

  constructor(private readonly store: DashboardStateStore) {}

  getSettings(): TicketListSettings {
    return this.settings;
  }

  updateTicketList(patch: Partial<TicketListSettings>): void {
    if (patch.filters) {
      this.settings = { ...this.settings, filters: { ...this.settings.filters, ...patch.filters } };
    }
    if (patch.sort) {
      this.settings = { ...this.settings, sort: { ...this.settings.sort, ...patch.sort } };
    }
    if (patch.dueDate) {
      this.settings = { ...this.settings, dueDate: { ...this.settings.dueDate, ...patch.dueDate } };
    }
    this.pushSettings();
  }

  resetTicketList(): void {
    this.settings = { ...DEFAULT_TICKET_LIST_SETTINGS };
    this.pushSettings();
  }

  updateEditorDefault(field: string, value: string): void {
    if (!EDITOR_DEFAULT_FIELDS.includes(field as EditorDefaultField)) {
      return;
    }
    updateTicketEditorDefaultField(field as EditorDefaultField, value);
  }

  resetEditorDefaults(fields: string[]): void {
    const validFields = fields.filter(
      (f): f is EditorDefaultField => EDITOR_DEFAULT_FIELDS.includes(f as EditorDefaultField),
    );
    if (validFields.length === 0) {
      return;
    }
    resetTicketEditorDefaultFields(validFields);
  }

  async updateGeneral(patch: DashboardGeneralSettingsPatch): Promise<void> {
    if (patch.offlineSyncMode !== undefined) {
      await setOfflineSyncMode(patch.offlineSyncMode);
    }
    if (patch.includeChildProjects !== undefined) {
      await vscode.workspace
        .getConfiguration("redmine-client")
        .update("includeChildProjects", patch.includeChildProjects, vscode.ConfigurationTarget.Global);
    }
    if (patch.ticketListLimit !== undefined && patch.ticketListLimit >= 1 && patch.ticketListLimit <= 500) {
      await vscode.workspace
        .getConfiguration("redmine-client")
        .update("ticketListLimit", patch.ticketListLimit, vscode.ConfigurationTarget.Global);
    }
    this.pushSettings();
  }

  pushSettings(): void {
    this.store.update({
      settings: buildSettingsDashboardViewModel(this.settings),
    });
  }

  getCurrentOfflineSyncMode(): "auto" | "manual" {
    return getOfflineSyncMode();
  }
}
