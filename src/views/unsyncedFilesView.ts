import * as vscode from "vscode";
import { getOfflineSyncQueue, onOfflineSyncQueueChanged } from "./offlineSyncStore";
import { formatTicketLabel } from "./ticketLabel";
import { getTicketSummary } from "./ticketSummaryStore";
import { createEmptyStateItem } from "./viewState";

export type UnsyncedFileSyncKey =
  | { kind: "ticket"; ticketId: number }
  | { kind: "newTicket"; documentUri?: string }
  | { kind: "comment"; ticketId: number; commentId?: number; documentUri?: string };

export class UnsyncedFileTreeItem extends vscode.TreeItem {
  readonly syncKey: UnsyncedFileSyncKey;

  constructor(label: string, iconId: string, syncKey: UnsyncedFileSyncKey, documentUri?: string, tooltip?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = "Local change";
    this.contextValue = "redmineUnsyncedFile";
    this.iconPath = new vscode.ThemeIcon(iconId);
    this.syncKey = syncKey;
    if (documentUri) {
      this.command = {
        command: "vscode.open",
        title: "Open Local File",
        arguments: [vscode.Uri.parse(documentUri)],
      };
    }
    if (tooltip) {
      this.tooltip = tooltip;
    } else if (!documentUri) {
      this.tooltip = "キューに登録済みですが、ローカルファイル URI が記録されていません。";
    }
  }
}

const buildTicketTooltip = (ticketId: number, documentUri?: string): string => {
  const subject = getTicketSummary(ticketId);
  const parts: string[] = [`チケット: ${formatTicketLabel(ticketId)}`];
  if (subject) {
    parts.push(`件名: ${subject}`);
  }
  if (documentUri) {
    parts.push(`URI: ${documentUri}`);
  }
  parts.push("状態: ローカル保存済み (未同期)");
  return parts.join("\n");
};

const buildCommentTooltip = (
  ticketId: number,
  commentId?: number,
  documentUri?: string,
): string => {
  const parts: string[] = [`チケット: ${formatTicketLabel(ticketId)}`];
  if (commentId !== undefined) {
    parts.push(`コメント ID: #${commentId}`);
  }
  if (documentUri) {
    parts.push(`URI: ${documentUri}`);
  }
  parts.push("状態: ローカル保存済み (未同期)");
  return parts.join("\n");
};

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
      const subject = getTicketSummary(ticketId);
      const label = subject
        ? `${formatTicketLabel(ticketId)} ${subject}`
        : `${formatTicketLabel(ticketId)} Ticket update`;
      items.push(
        new UnsyncedFileTreeItem(
          label,
          "file-text",
          { kind: "ticket", ticketId },
          undefined,
          buildTicketTooltip(ticketId),
        ),
      );
    });

    for (const comment of queue.comments) {
      const base = formatTicketLabel(comment.ticketId);
      if (comment.commentId !== undefined) {
        items.push(
          new UnsyncedFileTreeItem(
            `${base} Comment #${comment.commentId} update`,
            "comment",
            { kind: "comment", ticketId: comment.ticketId, commentId: comment.commentId, documentUri: comment.documentUri },
            comment.documentUri,
            buildCommentTooltip(comment.ticketId, comment.commentId, comment.documentUri),
          ),
        );
      } else {
        items.push(
          new UnsyncedFileTreeItem(
            `${base} New comment`,
            "comment",
            { kind: "comment", ticketId: comment.ticketId, documentUri: comment.documentUri },
            comment.documentUri,
            buildCommentTooltip(comment.ticketId, undefined, comment.documentUri),
          ),
        );
      }
    }

    for (const newTicket of queue.newTickets) {
      const tooltipParts = ["種別: 新規チケット"];
      if (newTicket.projectId !== undefined) {
        tooltipParts.push(`プロジェクト ID: ${newTicket.projectId}`);
      }
      if (newTicket.documentUri) {
        tooltipParts.push(`URI: ${newTicket.documentUri}`);
      }
      tooltipParts.push("状態: ローカル保存済み (未同期)");
      items.push(
        new UnsyncedFileTreeItem(
          "New ticket",
          "new-file",
          { kind: "newTicket", documentUri: newTicket.documentUri },
          newTicket.documentUri,
          tooltipParts.join("\n"),
        ),
      );
    }

    if (items.length === 0) {
      return [createEmptyStateItem("No local changes.")];
    }

    return items;
  }
}
