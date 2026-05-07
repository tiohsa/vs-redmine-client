import { TicketListSettings } from "../../views/projectListSettings";
import { getOfflineSyncMode, getTicketListLimit, getTicketListShowDueDate, getTicketListShowStatus } from "../../config/settings";
import type { DashboardTicketSettingsViewModel } from "../dashboardProtocol";

export const buildSettingsDashboardViewModel = (
  settings: TicketListSettings,
): DashboardTicketSettingsViewModel => ({
  filters: { ...settings.filters },
  sort: { ...settings.sort },
  dueDate: { ...settings.dueDate },
  offlineSyncMode: getOfflineSyncMode(),
  ticketListLimit: getTicketListLimit(),
  showStatus: getTicketListShowStatus(),
  showDueDate: getTicketListShowDueDate(),
});
