import { TicketListSettings } from "../../views/projectListSettings";
import {
  getBaseUrl,
  getDefaultProjectId,
  getEditorStorageDirectory,
  getIgnoreSSLErrors,
  getIncludeChildProjects,
  getOfflineSyncMode,
  getRequestTimeoutMs,
  getTicketListLimit,
  getTicketListShowDueDate,
  getTicketListShowPriority,
  getTicketListShowAssignee,
  getTicketListShowStatus,
  getTicketListShowTracker,
} from "../../config/settings";
import { isApiKeyConfigured } from "../../config/apiKeyStore";
import { getTicketEditorDefaults } from "../../views/ticketEditorDefaultsStore";
import type { DashboardTicketSettingsViewModel } from "../dashboardProtocol";

export const buildSettingsDashboardViewModel = (
  settings: TicketListSettings,
): DashboardTicketSettingsViewModel => ({
  filters: { ...settings.filters },
  sort: { ...settings.sort },
  dueDate: { ...settings.dueDate },
  baseUrl: getBaseUrl(),
  defaultProjectId: getDefaultProjectId(),
  requestTimeoutMs: getRequestTimeoutMs(),
  ignoreSSLErrors: getIgnoreSSLErrors(),
  includeChildProjects: getIncludeChildProjects(),
  offlineSyncMode: getOfflineSyncMode(),
  ticketListLimit: getTicketListLimit(),
  showStatus: getTicketListShowStatus(),
  showDueDate: getTicketListShowDueDate(),
  showTracker: getTicketListShowTracker(),
  showPriority: getTicketListShowPriority(),
  showAssignee: getTicketListShowAssignee(),
  editorStorageDirectory: getEditorStorageDirectory(),
  editorDefaults: (() => {
    const defaults = getTicketEditorDefaults();
    return {
      subject: defaults.subject,
      description: defaults.description,
      tracker: defaults.metadata.tracker,
      priority: defaults.metadata.priority,
      status: defaults.metadata.status,
      due_date: defaults.metadata.due_date,
    };
  })(),
  apiKeyStatus: isApiKeyConfigured() ? "set" : "notSet",
});
