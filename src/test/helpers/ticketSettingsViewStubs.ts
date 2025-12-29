import * as vscode from "vscode";
import {
  TicketSettingsItem,
  TicketsTreeProvider,
  TICKET_SETTINGS_COMMANDS,
} from "../../views/ticketsView";

export const buildTicketSettingsItemsFixture = (): vscode.TreeItem[] => [
  new TicketSettingsItem(
    "Filter: Priority",
    "All",
    { command: TICKET_SETTINGS_COMMANDS.priorityFilter, title: "Filter by priority" },
  ),
];

export const createTicketsTreeProviderStub = (
  items: vscode.TreeItem[] = buildTicketSettingsItemsFixture(),
): TicketsTreeProvider =>
  ({
    getSettingsItems: () => items,
  }) as TicketsTreeProvider;
