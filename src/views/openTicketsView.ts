import * as vscode from "vscode";
import {
  getAllEditorRecords,
} from "./ticketEditorRegistry";
import { formatTicketLabel } from "./ticketLabel";
import { createEmptyStateItem } from "./viewState";
import { TicketEditorRecord } from "./ticketEditorTypes";

const buildEditorLabel = (record: TicketEditorRecord): string => {
  const ticketLabel = formatTicketLabel(record.ticketId);
  if (record.contentType === "ticket") {
    return ticketLabel;
  }
  if (record.commentId) {
    return `${ticketLabel} Comment #${record.commentId}`;
  }
  return `${ticketLabel} Comment (draft)`;
};

const buildEditorDescription = (record: TicketEditorRecord): string => {
  if (record.contentType === "ticket") {
    return record.kind === "extra" ? "Ticket (extra)" : "Ticket";
  }
  if (record.commentId) {
    return "Comment";
  }
  return "Comment (draft)";
};

const resolveEditorIcon = (record: TicketEditorRecord): vscode.ThemeIcon => {
  if (record.contentType === "ticket") {
    return new vscode.ThemeIcon("file-text");
  }
  return new vscode.ThemeIcon("comment");
};

export class OpenEditorTreeItem extends vscode.TreeItem {
  constructor(public readonly record: TicketEditorRecord) {
    super(buildEditorLabel(record), vscode.TreeItemCollapsibleState.None);
    this.id = record.uri;
    this.description = buildEditorDescription(record);
    this.contextValue = "redmineOpenEditor";
    this.iconPath = resolveEditorIcon(record);
    this.command = {
      command: "redmine-client.focusTicketEditor",
      title: "Focus Ticket Editor",
      arguments: [{ ticketId: record.ticketId, uri: record.uri }],
    };
  }
}

export class OpenEditorsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();

  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    const records = getAllEditorRecords().filter(
      (record) =>
        record.contentType === "ticket" ||
        record.contentType === "comment" ||
        record.contentType === "commentDraft",
    );
    if (records.length === 0) {
      return [createEmptyStateItem("No open ticket/comment editors.")];
    }

    const ordered = records
      .slice()
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .map((record) => new OpenEditorTreeItem(record));

    return ordered;
  }
}
