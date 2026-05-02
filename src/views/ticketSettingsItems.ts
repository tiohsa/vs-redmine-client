import * as vscode from "vscode";
import { Ticket } from "../redmine/types";
import { DueDateDisplayRule, TicketListSettings } from "./projectListSettings";
import { TICKET_SETTINGS_COMMANDS } from "../app/commandIds";
import { getOfflineSyncMode } from "../config/settings";
import { collectOptions } from "./ticketFilterConfigurator";

const TICKET_SETTINGS_ICON_IDS = {
  titleFilter: "search",
  offlineSyncMode: "cloud-upload",
  priorityFilter: "symbol-number",
  statusFilter: "check",
  trackerFilter: "tag",
  assigneeFilter: "account",
  sort: "list-ordered",
  dueDate: "calendar",
  reset: "refresh",
};

export class TicketSettingsItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    command: vscode.Command,
    iconId?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.command = command;
    this.contextValue = "ticketSettingsItem";
    if (iconId) {
      this.iconPath = new vscode.ThemeIcon(iconId);
    }
  }
}

const formatSelectionSummary = (selectedCount: number, totalCount: number): string => {
  if (selectedCount === 0 || selectedCount === totalCount) { return "All"; }
  return `${selectedCount} selected`;
};

const formatTitleFilterSummary = (query: string): string =>
  query.length > 0 ? query : "All";

const formatSortSummary = (sort: TicketListSettings["sort"]): string => {
  if (!sort.field) { return "None"; }
  const label = sort.field.charAt(0).toUpperCase() + sort.field.slice(1);
  return `${label} (${sort.direction})`;
};

const formatDueDateSummary = (rule: DueDateDisplayRule): string => {
  const enabled: string[] = [];
  if (rule.showWithin1Day) { enabled.push("1 day"); }
  if (rule.showWithin3Days) { enabled.push("3 days"); }
  if (rule.showWithin7Days) { enabled.push("7 days"); }
  if (rule.showOverdue) { enabled.push("Overdue"); }
  if (enabled.length === 0) { return "None"; }
  if (enabled.length === 4) { return "All"; }
  return enabled.join(", ");
};

export const buildTicketSettingsItems = (
  tickets: Ticket[],
  settings: TicketListSettings,
): vscode.TreeItem[] => {
  const offlineMode = getOfflineSyncMode();
  const priorityOptions = collectOptions(tickets, (t) => t.priorityId, (t) => t.priorityName);
  const statusOptions = collectOptions(tickets, (t) => t.statusId, (t) => t.statusName);
  const trackerOptions = collectOptions(tickets, (t) => t.trackerId, (t) => t.trackerName);
  const assigneeOptions = collectOptions(tickets, (t) => t.assigneeId, (t) => t.assigneeName);

  const assigneeTotal = assigneeOptions.length + 1;
  const assigneeSelected =
    settings.filters.assigneeIds.length + (settings.filters.includeUnassigned ? 1 : 0);

  return [
    new TicketSettingsItem(
      "Offline sync mode",
      offlineMode === "manual" ? "Manual" : "Auto",
      { command: TICKET_SETTINGS_COMMANDS.offlineSyncMode, title: "Offline sync mode" },
      TICKET_SETTINGS_ICON_IDS.offlineSyncMode,
    ),
    new TicketSettingsItem(
      "Filter: Title",
      formatTitleFilterSummary(settings.filters.subjectQuery),
      { command: TICKET_SETTINGS_COMMANDS.titleFilter, title: "Filter by title" },
      TICKET_SETTINGS_ICON_IDS.titleFilter,
    ),
    new TicketSettingsItem(
      "Filter: Priority",
      formatSelectionSummary(settings.filters.priorityIds.length, priorityOptions.length),
      { command: TICKET_SETTINGS_COMMANDS.priorityFilter, title: "Filter by priority" },
      TICKET_SETTINGS_ICON_IDS.priorityFilter,
    ),
    new TicketSettingsItem(
      "Filter: Status",
      formatSelectionSummary(settings.filters.statusIds.length, statusOptions.length),
      { command: TICKET_SETTINGS_COMMANDS.statusFilter, title: "Filter by status" },
      TICKET_SETTINGS_ICON_IDS.statusFilter,
    ),
    new TicketSettingsItem(
      "Filter: Tracker",
      formatSelectionSummary(settings.filters.trackerIds.length, trackerOptions.length),
      { command: TICKET_SETTINGS_COMMANDS.trackerFilter, title: "Filter by tracker" },
      TICKET_SETTINGS_ICON_IDS.trackerFilter,
    ),
    new TicketSettingsItem(
      "Filter: Assignee",
      formatSelectionSummary(assigneeSelected, assigneeTotal),
      { command: TICKET_SETTINGS_COMMANDS.assigneeFilter, title: "Filter by assignee" },
      TICKET_SETTINGS_ICON_IDS.assigneeFilter,
    ),
    new TicketSettingsItem(
      "Sort order",
      formatSortSummary(settings.sort),
      { command: TICKET_SETTINGS_COMMANDS.sort, title: "Sort order" },
      TICKET_SETTINGS_ICON_IDS.sort,
    ),
    new TicketSettingsItem(
      "Due date indicators",
      formatDueDateSummary(settings.dueDate),
      { command: TICKET_SETTINGS_COMMANDS.dueDate, title: "Due date indicators" },
      TICKET_SETTINGS_ICON_IDS.dueDate,
    ),
    new TicketSettingsItem(
      "Reset settings",
      "Restore defaults",
      { command: TICKET_SETTINGS_COMMANDS.reset, title: "Reset settings" },
      TICKET_SETTINGS_ICON_IDS.reset,
    ),
  ];
};
