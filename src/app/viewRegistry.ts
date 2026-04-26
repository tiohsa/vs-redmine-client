import * as vscode from "vscode";
import { CommentsTreeProvider } from "../views/commentsView";
import { ProjectsTreeProvider } from "../views/projectsView";
import { TicketsTreeProvider } from "../views/ticketsView";
import { UnsyncedFilesTreeProvider } from "../views/unsyncedFilesView";
import { TicketSettingsTreeProvider } from "../views/ticketSettingsView";
import { registerFocusRefresh } from "../views/viewFocusRefresh";
import { setTreeExpanded } from "../views/treeState";
import {
  VIEW_ID_ACTIVITY_COMMENTS,
  VIEW_ID_ACTIVITY_PROJECTS,
  VIEW_ID_ACTIVITY_TICKET_SETTINGS,
  VIEW_ID_ACTIVITY_TICKETS,
  VIEW_ID_ACTIVITY_UNSYNCED_FILES,
} from "../views/viewIds";

export interface ViewRegistry {
  projectsProvider: ProjectsTreeProvider;
  ticketsProvider: TicketsTreeProvider;
  commentsProvider: CommentsTreeProvider;
  unsyncedFilesProvider: UnsyncedFilesTreeProvider;
  settingsProvider: TicketSettingsTreeProvider;
  activityProjectsView: vscode.TreeView<vscode.TreeItem>;
  activityTicketsView: vscode.TreeView<vscode.TreeItem>;
  activityCommentsView: vscode.TreeView<vscode.TreeItem>;
  activityUnsyncedFilesView: vscode.TreeView<vscode.TreeItem>;
  activitySettingsView: vscode.TreeView<vscode.TreeItem>;
}

const trackExpansionState = <T extends vscode.TreeItem>(
  view: vscode.TreeView<T>,
  viewKey: string,
  subscriptions: vscode.Disposable[],
): void => {
  subscriptions.push(
    view.onDidExpandElement((event) => {
      const elementId = event.element.id;
      if (elementId) {
        setTreeExpanded(viewKey, String(elementId), true);
      }
    }),
    view.onDidCollapseElement((event) => {
      const elementId = event.element.id;
      if (elementId) {
        setTreeExpanded(viewKey, String(elementId), false);
      }
    }),
  );
};

export const registerViews = (context: vscode.ExtensionContext): ViewRegistry => {
  const ticketsProvider = new TicketsTreeProvider();
  const unsyncedFilesProvider = new UnsyncedFilesTreeProvider();
  const settingsProvider = new TicketSettingsTreeProvider(ticketsProvider);
  const commentsProvider = new CommentsTreeProvider();
  const projectsProvider = new ProjectsTreeProvider();

  const activityProjectsView = vscode.window.createTreeView(VIEW_ID_ACTIVITY_PROJECTS, {
    treeDataProvider: projectsProvider,
  });
  const activitySettingsView = vscode.window.createTreeView(
    VIEW_ID_ACTIVITY_TICKET_SETTINGS,
    { treeDataProvider: settingsProvider },
  );
  const activityTicketsView = vscode.window.createTreeView(VIEW_ID_ACTIVITY_TICKETS, {
    treeDataProvider: ticketsProvider,
  });
  const activityUnsyncedFilesView = vscode.window.createTreeView(
    VIEW_ID_ACTIVITY_UNSYNCED_FILES,
    { treeDataProvider: unsyncedFilesProvider },
  );
  const activityCommentsView = vscode.window.createTreeView(VIEW_ID_ACTIVITY_COMMENTS, {
    treeDataProvider: commentsProvider,
  });

  context.subscriptions.push(
    activityProjectsView,
    activitySettingsView,
    activityTicketsView,
    activityUnsyncedFilesView,
    activityCommentsView,
    unsyncedFilesProvider,
    registerFocusRefresh(activityProjectsView, () => projectsProvider.refresh()),
    registerFocusRefresh(activitySettingsView, () => settingsProvider.refresh()),
    registerFocusRefresh(activityTicketsView, () => ticketsProvider.refresh()),
    registerFocusRefresh(activityUnsyncedFilesView, () => unsyncedFilesProvider.refresh()),
    registerFocusRefresh(activityCommentsView, () => commentsProvider.refresh()),
  );

  trackExpansionState(activityProjectsView, "projects", context.subscriptions);
  trackExpansionState(activityTicketsView, "tickets", context.subscriptions);

  return {
    projectsProvider,
    ticketsProvider,
    commentsProvider,
    unsyncedFilesProvider,
    settingsProvider,
    activityProjectsView,
    activityTicketsView,
    activityCommentsView,
    activityUnsyncedFilesView,
    activitySettingsView,
  };
};
