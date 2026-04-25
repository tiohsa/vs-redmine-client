import * as vscode from "vscode";
import { getOfflineSyncQueue } from "./offlineSyncStore";
import { formatTicketLabel } from "./ticketLabel";
import { createEmptyStateItem } from "./viewState";

export class UnsyncedFileTreeItem extends vscode.TreeItem {
  constructor(label: string, iconId: string, documentUri?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = "Not synced";
    this.contextValue = "redmineUnsyncedFile";
    this.iconPath = new vscode.ThemeIcon(iconId);
    if (documentUri) {
      this.command = {
        command: "vscode.open",
        title: "Open Local File",
        arguments: [vscode.Uri.parse(documentUri)],
      };
    } else {
      this.tooltip = "This change is queued for sync, but no local file URI was recorded.";
    }
  }
}

export class UnsyncedFilesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    const queue = getOfflineSyncQueue();
    const items: vscode.TreeItem[] = [];

    queue.tickets.forEach((_update, ticketId) => {
      items.push(new UnsyncedFileTreeItem(
        `${formatTicketLabel(ticketId)} Ticket update`,
        "file-text",
      ));
    });

    for (const comment of queue.comments) {
      const base = formatTicketLabel(comment.ticketId);
      if (comment.commentId !== undefined) {
        items.push(new UnsyncedFileTreeItem(
          `${base} Comment #${comment.commentId} update`,
          "comment",
          comment.documentUri,
        ));
      } else {
        items.push(new UnsyncedFileTreeItem(
          `${base} New comment`,
          "comment",
          comment.documentUri,
        ));
      }
    }

    for (const newTicket of queue.newTickets) {
      const item = new UnsyncedFileTreeItem("New ticket", "new-file", newTicket.documentUri);
      if (newTicket.projectId !== undefined) {
        item.tooltip = `Project ID: ${newTicket.projectId}`;
      }
      items.push(item);
    }

    if (items.length === 0) {
      return [createEmptyStateItem("No unsynced local files.")];
    }

    return items;
  }
}
