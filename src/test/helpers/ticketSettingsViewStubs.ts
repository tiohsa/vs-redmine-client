import * as vscode from "vscode";
import { TICKET_SETTINGS_COMMANDS } from "../../app/commandIds";
import {
  TicketSettingsItem,
  TicketsTreeProvider,
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
