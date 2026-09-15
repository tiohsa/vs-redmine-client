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
import { normalizeBaseUrl } from "../redmine/client";
import {
  normalizeEditorDefaultValue,
  validateEditorDefaultValue,
} from "../views/ticketEditorDefaultsValidation";
import type {
  DashboardConnectionSettingsPatch,
  DashboardEditorSettingsPatch,
} from "./dashboardProtocol";
import { buildSettingsDashboardViewModel } from "./viewModels/settingsDashboardViewModel";
import { DashboardStateStore } from "./DashboardStateStore";
import type { DashboardGeneralSettingsPatch } from "./dashboardProtocol";
import {
  getStoredTicketListSettings,
  setStoredTicketListSettings,
  clearStoredTicketListSettings,
} from "../views/ticketListSettingsStore";

const resetConfigurationValue = async (
  config: vscode.WorkspaceConfiguration,
  section: string,
): Promise<void> => {
  const inspected = config.inspect<unknown>(section);
  if (inspected?.globalValue !== undefined) {
    await config.update(
      section,
      undefined,
      vscode.ConfigurationTarget.Global,
    );
  }
};

export class SettingsController {
  private settings: TicketListSettings = getStoredTicketListSettings();

  constructor(private readonly store: DashboardStateStore) {
    this.pushSettings();
  }

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
    setStoredTicketListSettings(this.settings);
    this.pushSettings();
  }

  resetTicketList(): void {
    this.settings = { ...DEFAULT_TICKET_LIST_SETTINGS };
    clearStoredTicketListSettings();
    this.pushSettings();
  }

  async resetDisplaySettings(): Promise<void> {
    this.settings = { ...DEFAULT_TICKET_LIST_SETTINGS };
    clearStoredTicketListSettings();
    const config = vscode.workspace.getConfiguration("redmine-client");
    for (const section of [
      "includeChildProjects",
      "ticketListLimit",
      "ticketList.showStatus",
      "ticketList.showDueDate",
    ]) {
      await resetConfigurationValue(config, section);
    }
    this.pushSettings();
  }

  updateEditorDefault(field: string, value: string): void {
    if (!EDITOR_DEFAULT_FIELDS.includes(field as EditorDefaultField)) {
      return;
    }
    const editorField = field as EditorDefaultField;
    const normalizedValue = normalizeEditorDefaultValue(editorField, value);
    if (validateEditorDefaultValue(editorField, normalizedValue)) {
      return;
    }
    updateTicketEditorDefaultField(editorField, normalizedValue);
    this.pushSettings();
  }

  resetEditorDefaults(fields: string[]): void {
    const validFields = fields.filter(
      (f): f is EditorDefaultField => EDITOR_DEFAULT_FIELDS.includes(f as EditorDefaultField),
    );
    if (validFields.length === 0) {
      return;
    }
    resetTicketEditorDefaultFields(validFields);
    this.pushSettings();
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
    if (patch.showStatus !== undefined) {
      await vscode.workspace
        .getConfiguration("redmine-client")
        .update("ticketList.showStatus", patch.showStatus, vscode.ConfigurationTarget.Global);
    }
    if (patch.showDueDate !== undefined) {
      await vscode.workspace
        .getConfiguration("redmine-client")
        .update("ticketList.showDueDate", patch.showDueDate, vscode.ConfigurationTarget.Global);
    }
    if (patch.ticketListLimit !== undefined && patch.ticketListLimit >= 1 && patch.ticketListLimit <= 500) {
      await vscode.workspace
        .getConfiguration("redmine-client")
        .update("ticketListLimit", patch.ticketListLimit, vscode.ConfigurationTarget.Global);
    }
    this.pushSettings();
  }

  async updateConnection(patch: DashboardConnectionSettingsPatch): Promise<void> {
    const config = vscode.workspace.getConfiguration("redmine-client");
    if (patch.baseUrl !== undefined) {
      const baseUrl = patch.baseUrl.trim();
      if (baseUrl) {
        normalizeBaseUrl(baseUrl);
      }
      await config.update("baseUrl", baseUrl, vscode.ConfigurationTarget.Global);
    }
    if (patch.defaultProjectId !== undefined) {
      await config.update(
        "defaultProjectId",
        patch.defaultProjectId.trim(),
        vscode.ConfigurationTarget.Global,
      );
    }
    if (patch.requestTimeoutMs !== undefined) {
      if (!Number.isFinite(patch.requestTimeoutMs) || patch.requestTimeoutMs <= 0) {
        throw new Error("Request timeout must be greater than zero.");
      }
      await config.update(
        "requestTimeoutMs",
        patch.requestTimeoutMs,
        vscode.ConfigurationTarget.Global,
      );
    }
    if (patch.ignoreSSLErrors !== undefined) {
      await config.update(
        "ignoreSSLErrors",
        patch.ignoreSSLErrors,
        vscode.ConfigurationTarget.Global,
      );
    }
    this.pushSettings();
  }

  async updateEditor(patch: DashboardEditorSettingsPatch): Promise<void> {
    if (patch.editorStorageDirectory !== undefined) {
      await vscode.workspace
        .getConfiguration("redmine-client")
        .update(
          "editorStorageDirectory",
          patch.editorStorageDirectory.trim(),
          vscode.ConfigurationTarget.Global,
        );
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
