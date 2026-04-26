import * as vscode from "vscode";
import { getOfflineSyncQueue, onOfflineSyncQueueChanged } from "./offlineSyncStore";
import { formatTicketLabel } from "./ticketLabel";
import { createEmptyStateItem } from "./viewState";

export type UnsyncedFileSyncKey =
  | { kind: "ticket"; ticketId: number }
  | { kind: "newTicket"; documentUri?: string }
  | { kind: "comment"; ticketId: number; commentId?: number; documentUri?: string };

export class UnsyncedFileTreeItem extends vscode.TreeItem {
  readonly syncKey: UnsyncedFileSyncKey;

  constructor(label: string, iconId: string, syncKey: UnsyncedFileSyncKey, documentUri?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = "Not synced";
    this.contextValue = "redmineUnsyncedFile";
    this.iconPath = new vscode.ThemeIcon(iconId);
    this.syncKey = syncKey;
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

export class UnsyncedFilesTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  private readonly disposeQueueChange: () => void;

  readonly onDidChangeTreeData = this.emitter.event;

  constructor() {
    this.disposeQueueChange = onOfflineSyncQueueChanged(() => this.refresh());
  }

  refresh(): void {
    this.emitter.fire();
  }

  dispose(): void {
    this.disposeQueueChange();
    this.emitter.dispose();
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
        { kind: "ticket", ticketId },
      ));
    });

    for (const comment of queue.comments) {
      const base = formatTicketLabel(comment.ticketId);
      if (comment.commentId !== undefined) {
        items.push(new UnsyncedFileTreeItem(
          `${base} Comment #${comment.commentId} update`,
          "comment",
          { kind: "comment", ticketId: comment.ticketId, commentId: comment.commentId, documentUri: comment.documentUri },
          comment.documentUri,
        ));
      } else {
        items.push(new UnsyncedFileTreeItem(
          `${base} New comment`,
          "comment",
          { kind: "comment", ticketId: comment.ticketId, documentUri: comment.documentUri },
          comment.documentUri,
        ));
      }
    }

    for (const newTicket of queue.newTickets) {
      const item = new UnsyncedFileTreeItem(
        "New ticket",
        "new-file",
        { kind: "newTicket", documentUri: newTicket.documentUri },
        newTicket.documentUri,
      );
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
