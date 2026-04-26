import { TicketListSettings } from "../../views/projectListSettings";
import { getOfflineSyncMode } from "../../config/settings";
import type { DashboardTicketSettingsViewModel } from "../dashboardProtocol";

export const buildSettingsDashboardViewModel = (
  settings: TicketListSettings,
): DashboardTicketSettingsViewModel => ({
  filters: { ...settings.filters },
  sort: { ...settings.sort },
  dueDate: { ...settings.dueDate },
  offlineSyncMode: getOfflineSyncMode(),
});
