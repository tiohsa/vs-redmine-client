import * as vscode from "vscode";
import { createTicketFromEditor } from "./commands/createTicket";
import { editComment } from "./commands/editComment";
import { CommentTreeItem, CommentsTreeProvider } from "./views/commentsView";
import { TicketTreeItem, TicketsTreeProvider } from "./views/ticketsView";
import { showTicketPreview } from "./views/ticketPreview";

export function activate(context: vscode.ExtensionContext) {
  const ticketsProvider = new TicketsTreeProvider();
  const commentsProvider = new CommentsTreeProvider();
  const ticketsView = vscode.window.createTreeView("todoexTickets", {
    treeDataProvider: ticketsProvider,
  });
  context.subscriptions.push(
    ticketsView,
    vscode.window.registerTreeDataProvider("todoexComments", commentsProvider),
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

      const config = vscode.workspace.getConfiguration("todoex");
      await config.update(
        "defaultProjectId",
        projectId,
        vscode.ConfigurationTarget.Global,
      );
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
    ticketsView.onDidChangeSelection(async (event) => {
      const selected = event.selection[0];
      if (selected) {
        commentsProvider.setTicketId(selected.ticket.id);
        await showTicketPreview(selected.ticket);
      }
    }),
  );

  ticketsProvider.refresh();
}

export function deactivate() {}
