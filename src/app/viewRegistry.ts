import * as vscode from "vscode";
import {
  DashboardWebviewProvider,
  VIEW_ID_DASHBOARD,
} from "../dashboard/DashboardWebviewProvider";
import type {
  CommentPresentationPort,
  SettingsPresentationPort,
  TicketPresentationPort,
  UnsyncedPresentationPort,
} from "./presentationPorts";

export interface ViewRegistry {
  ticketsPresentation: TicketPresentationPort;
  commentsPresentation: CommentPresentationPort;
  unsyncedPresentation: UnsyncedPresentationPort;
  settingsPresentation: SettingsPresentationPort;
  dashboardProvider: DashboardWebviewProvider;
}

export const registerViews = (context: vscode.ExtensionContext): ViewRegistry => {
  const dashboardProvider = new DashboardWebviewProvider(context.extensionUri);
  context.subscriptions.push(
    dashboardProvider,
    vscode.window.registerWebviewViewProvider(VIEW_ID_DASHBOARD, dashboardProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const ticketsPresentation: TicketPresentationPort = {
    refresh: () => dashboardProvider.refreshTickets(),
    notifyChange: () => dashboardProvider.notifyTicketChanged(),
    updateTicketSubject: (ticketId, subject) =>
      dashboardProvider.updateTicketSubject(ticketId, subject),
    setSelectedProjectId: (projectId) => dashboardProvider.selectProject(projectId),
  };
  const commentsPresentation: CommentPresentationPort = {
    refresh: () => {
      // Dashboard は ticketId 指定でコメントを更新するため、全体更新はチケット更新に委譲する。
      dashboardProvider.refreshTickets();
    },
    refreshForTicket: (ticketId) => dashboardProvider.refreshCommentsForTicket(ticketId),
  };
  const unsyncedPresentation: UnsyncedPresentationPort = {
    refresh: () => dashboardProvider.refreshUnsynced(),
  };
  const settingsPresentation: SettingsPresentationPort = {
    refresh: () => dashboardProvider.refreshSettings(),
  };

  return {
    ticketsPresentation,
    commentsPresentation,
    unsyncedPresentation,
    settingsPresentation,
    dashboardProvider,
  };
};
