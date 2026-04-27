import * as vscode from "vscode";
import { CommentsTreeProvider } from "../views/commentsView";
import { ProjectsTreeProvider } from "../views/projectsView";
import { TicketsTreeProvider } from "../views/ticketsView";
import { UnsyncedFilesTreeProvider } from "../views/unsyncedFilesView";
import { TicketSettingsTreeProvider } from "../views/ticketSettingsView";
import {
  DashboardWebviewProvider,
  VIEW_ID_DASHBOARD,
} from "../dashboard/DashboardWebviewProvider";

export interface ViewRegistry {
  projectsProvider: ProjectsTreeProvider;
  ticketsProvider: TicketsTreeProvider;
  commentsProvider: CommentsTreeProvider;
  unsyncedFilesProvider: UnsyncedFilesTreeProvider;
  settingsProvider: TicketSettingsTreeProvider;
  dashboardProvider: DashboardWebviewProvider;
}

export const registerViews = (context: vscode.ExtensionContext): ViewRegistry => {
  const ticketsProvider = new TicketsTreeProvider();
  const unsyncedFilesProvider = new UnsyncedFilesTreeProvider();
  const settingsProvider = new TicketSettingsTreeProvider(ticketsProvider);
  const commentsProvider = new CommentsTreeProvider();
  const projectsProvider = new ProjectsTreeProvider();

  const dashboardProvider = new DashboardWebviewProvider(context.extensionUri);
  context.subscriptions.push(
    dashboardProvider,
    vscode.window.registerWebviewViewProvider(VIEW_ID_DASHBOARD, dashboardProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    unsyncedFilesProvider,
  );

  return {
    projectsProvider,
    ticketsProvider,
    commentsProvider,
    unsyncedFilesProvider,
    settingsProvider,
    dashboardProvider,
  };
};
