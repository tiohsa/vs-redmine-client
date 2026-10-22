import { describeOfflineSync } from "./offlineSyncPresentation";
import * as vscode from "vscode";
import {
  getOfflineSyncQueue,
  isAbandoned,
  onOfflineSyncQueueChanged,
} from "./offlineSyncStore";
import { formatTicketLabel } from "./ticketLabel";
import { getTicketSummary } from "./ticketSummaryStore";
import { createEmptyStateItem } from "./viewState";
import { getCurrentConnectionScope } from "../config/connectionScope";

export type UnsyncedFileSyncKey =
  | { kind: "ticket"; ticketId: number }
  | { kind: "newTicket"; queueId?: string; documentUri?: string }
  | { kind: "comment"; ticketId: number; commentId?: number; documentUri?: string; operationId?: string };

export class UnsyncedFileTreeItem extends vscode.TreeItem {
  readonly syncKey: UnsyncedFileSyncKey;

  constructor(label: string, iconId: string, syncKey: UnsyncedFileSyncKey, documentUri?: string, tooltip?: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description ?? vscode.l10n.t("Waiting to sync");
    this.contextValue = "redmineUnsyncedFile";
    this.iconPath = new vscode.ThemeIcon(iconId);
    this.syncKey = syncKey;
    if (documentUri) {
      this.command = {
        command: "vscode.open",
        title: vscode.l10n.t("Open Local File"),
        arguments: [vscode.Uri.parse(documentUri)],
      };
    }
    if (tooltip) {
      this.tooltip = tooltip;
    } else if (!documentUri) {
      this.tooltip = vscode.l10n.t("Queued but no local file URI recorded.");
    }
  }
}

const buildTicketTooltip = (
  ticketId: number,
  documentUri?: string,
  status = vscode.l10n.t("Status: Saved locally (unsynced)"),
): string => {
  const subject = getTicketSummary(ticketId);
  const parts: string[] = [vscode.l10n.t("Ticket: {0}", formatTicketLabel(ticketId))];
  if (subject) {
    parts.push(vscode.l10n.t("Subject: {0}", subject));
  }
  if (documentUri) {
    parts.push(`URI: ${documentUri}`);
  }
  parts.push(status);
  return parts.join("\n");
};

const buildCommentTooltip = (
  ticketId: number,
  commentId?: number,
  documentUri?: string,
  status = vscode.l10n.t("Status: Saved locally (unsynced)"),
): string => {
  const parts: string[] = [vscode.l10n.t("Ticket: {0}", formatTicketLabel(ticketId))];
  if (commentId !== undefined) {
    parts.push(vscode.l10n.t("Comment ID: #{0}", commentId));
  }
  if (documentUri) {
    parts.push(`URI: ${documentUri}`);
  }
  parts.push(status);
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
    const queue = getOfflineSyncQueue(getCurrentConnectionScope());
    const items: vscode.TreeItem[] = [];

    queue.tickets.forEach((update, ticketId) => {
      if (isAbandoned(update)) { return; }
      const subject = getTicketSummary(ticketId);
      const label = subject
        ? `${formatTicketLabel(ticketId)} ${subject}`
        : `${formatTicketLabel(ticketId)} ${vscode.l10n.t("Ticket update")}`;
      items.push(
        new UnsyncedFileTreeItem(
          label,
          "file-text",
          { kind: "ticket", ticketId },
          undefined,
          buildTicketTooltip(
            ticketId,
            update.documentUri,
            describeOfflineSync(update).detail,
          ),
          describeOfflineSync(update).label,
        ),
      );
    });

    for (const comment of queue.comments) {
      if (isAbandoned(comment)) { continue; }
      const base = formatTicketLabel(comment.ticketId);
      if (comment.commentId !== undefined) {
        items.push(
          new UnsyncedFileTreeItem(
            `${base} ${vscode.l10n.t("Comment #{0} update", comment.commentId)}`,
            "comment",
            { kind: "comment", ticketId: comment.ticketId, operationId: comment.operationId, commentId: comment.commentId, documentUri: comment.documentUri },
            comment.documentUri,
            buildCommentTooltip(comment.ticketId, comment.commentId, comment.documentUri, describeOfflineSync(comment).detail),
            describeOfflineSync(comment).label,
          ),
        );
      } else {
        items.push(
          new UnsyncedFileTreeItem(
            `${base} ${vscode.l10n.t("New comment")}`,
            "comment",
            { kind: "comment", ticketId: comment.ticketId, operationId: comment.operationId, documentUri: comment.documentUri },
            comment.documentUri,
            buildCommentTooltip(comment.ticketId, undefined, comment.documentUri, describeOfflineSync(comment).detail),
            describeOfflineSync(comment).label,
          ),
        );
      }
    }

    for (const newTicket of queue.newTickets) {
      if (isAbandoned(newTicket)) { continue; }
      const tooltipParts = [vscode.l10n.t("Type: New ticket")];
      if (newTicket.projectId !== undefined) {
        tooltipParts.push(vscode.l10n.t("Project ID: {0}", newTicket.projectId));
      }
      if (newTicket.documentUri) {
        tooltipParts.push(`URI: ${newTicket.documentUri}`);
      }
      tooltipParts.push(
        describeOfflineSync(newTicket).detail,
      );
      items.push(
        new UnsyncedFileTreeItem(
          vscode.l10n.t("New ticket"),
          "new-file",
          { kind: "newTicket", queueId: newTicket.queueId, documentUri: newTicket.documentUri },
          newTicket.documentUri,
          tooltipParts.join("\n"),
          describeOfflineSync(newTicket).label,
        ),
      );
    }

    if (items.length === 0) {
      return [createEmptyStateItem("No local changes.")];
    }

    return items;
  }
}
