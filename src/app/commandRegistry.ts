import type * as vscode from "vscode";
import type {
  CommentPresentationPort,
  SettingsPresentationPort,
  TicketPresentationPort,
  UnsyncedPresentationPort,
} from "./presentationPorts";
import type { SyncController } from "./syncController";
import type { SyncEngine } from "./syncEngine";
import type { DashboardWebviewProvider } from "../dashboard/DashboardWebviewProvider";
import { registerListRefreshCommands, registerProjectSelectionCommands } from "./dashboardProjectCommands";
import { registerSyncCommands } from "./syncCommandRegistrations";
import { registerTicketEditorCommands, registerTicketPreviewCommands } from "./ticketCommandRegistrations";
import { registerCommentCommands } from "./commentCommandRegistrations";
import { registerBrowserCommands } from "./browserCommandRegistrations";
import { registerSettingsCommands } from "./settingsCommandRegistrations";
import { registerConnectionCommands } from "./connectionCommandRegistrations";

export interface CommandDeps {
  ticketsPresentation: TicketPresentationPort;
  commentsPresentation: CommentPresentationPort;
  unsyncedPresentation: UnsyncedPresentationPort;
  settingsPresentation: SettingsPresentationPort;
  dashboardProvider: DashboardWebviewProvider;
  sync: Pick<SyncController, "syncEditorAndNotify">;
  syncEngine?: SyncEngine;
}

export const registerCommands = (
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): void => {
  registerListRefreshCommands(context, deps);
  registerSyncCommands(context, deps);
  registerTicketEditorCommands(context, deps);
  registerProjectSelectionCommands(context, deps);
  registerCommentCommands(context, deps);
  registerTicketPreviewCommands(context, deps);
  registerBrowserCommands(context, deps);
  registerSettingsCommands(context, deps);
  registerConnectionCommands(context, deps);
};
