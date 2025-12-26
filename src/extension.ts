import * as vscode from "vscode";
import { createTicketFromEditor } from "./commands/createTicket";
import { editComment } from "./commands/editComment";
import { setProjectSelection, getProjectSelection } from "./config/projectSelection";
import { CommentTreeItem, CommentsTreeProvider } from "./views/commentsView";
import { ProjectTreeItem, ProjectsTreeProvider } from "./views/projectsView";
import { TicketTreeItem, TicketsTreeProvider } from "./views/ticketsView";
import { showTicketPreview } from "./views/ticketPreview";

export async function activate(context: vscode.ExtensionContext) {
  const ticketsProvider = new TicketsTreeProvider();
  const commentsProvider = new CommentsTreeProvider();
  const projectsProvider = new ProjectsTreeProvider();
  const projectsView = vscode.window.createTreeView("todoexProjects", {
    treeDataProvider: projectsProvider,
  });
  const ticketsView = vscode.window.createTreeView("todoexTickets", {
    treeDataProvider: ticketsProvider,
  });
  context.subscriptions.push(
    projectsView,
    ticketsView,
    vscode.window.registerTreeDataProvider("todoexComments", commentsProvider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.refreshProjects", () =>
      projectsProvider.refresh(),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.refreshTickets", () =>
      ticketsProvider.refresh(),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.selectProject", async () => {
      const projectId = await vscode.window.showInputBox({
        prompt: "Enter Redmine project ID",
        placeHolder: "e.g. 123",
      });

      if (!projectId) {
        return;
      }

      const numericId = Number(projectId);
      if (Number.isNaN(numericId)) {
        vscode.window.showErrorMessage("Project ID must be a number.");
        return;
      }

      await setProjectSelection(numericId, "");
      projectsProvider.setSelectedProjectId(numericId);
      ticketsProvider.setSelectedProjectId(numericId);
      ticketsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.toggleChildProjects", async () => {
      const config = vscode.workspace.getConfiguration("todoex");
      const current = config.get<boolean>("includeChildProjects", false);
      await config.update(
        "includeChildProjects",
        !current,
        vscode.ConfigurationTarget.Global,
      );
      ticketsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "todoex.openTicketPreview",
      async (item: TicketTreeItem) => {
        await showTicketPreview(item.ticket);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.createTicket", async () => {
      await createTicketFromEditor();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "todoex.editComment",
      async (item: CommentTreeItem) => {
        await editComment(item.comment);
      },
    ),
  );

  context.subscriptions.push(
    projectsView.onDidChangeSelection(async (event) => {
      const selected = event.selection[0] as ProjectTreeItem | undefined;
      if (!selected) {
        return;
      }

      await setProjectSelection(selected.project.id, selected.project.name);
      projectsProvider.setSelectedProjectId(selected.project.id);
      ticketsProvider.setSelectedProjectId(selected.project.id);
      ticketsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    ticketsView.onDidChangeSelection(async (event) => {
      const selected = event.selection[0] as TicketTreeItem | undefined;
      if (!selected) {
        return;
      }

      commentsProvider.setTicketId(selected.ticket.id);
      await showTicketPreview(selected.ticket);
    }),
  );

  const initialSelection = getProjectSelection();
  await projectsProvider.loadProjects();
  if (initialSelection.id) {
    const projectItem = projectsProvider.getProjectItemById(initialSelection.id);
    if (projectItem) {
      await projectsView.reveal(projectItem, { select: true, focus: false });
    }
    ticketsProvider.setSelectedProjectId(initialSelection.id);
  }

  ticketsProvider.refresh();
}

export function deactivate() {}
