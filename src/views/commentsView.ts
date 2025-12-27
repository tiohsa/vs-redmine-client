import * as vscode from "vscode";
import { getApiKey, getBaseUrl } from "../config/settings";
import { listComments } from "../redmine/comments";
import { getCurrentUserId } from "../redmine/users";
import { Comment } from "../redmine/types";
import { showError } from "../utils/notifications";
import { setCommentAddContext } from "./commentViewContext";
import { formatCommentDescription, formatCommentLabel } from "./commentListFormat";
import { MAX_VIEW_ITEMS } from "./viewLimits";
import { createEmptyStateItem, createErrorStateItem } from "./viewState";

export const COMMENT_RELOAD_COMMAND = "todoex.reloadComment";

export const evaluateAddCommentPermission = (
  ticketId: number | undefined,
  baseUrl: string,
  apiKey: string,
): boolean => Boolean(ticketId) && baseUrl.length > 0 && apiKey.length > 0;

export const refreshAddCommentContext = (
  ticketId: number | undefined,
  baseUrl = getBaseUrl(),
  apiKey = getApiKey(),
): boolean => {
  const canAdd = evaluateAddCommentPermission(ticketId, baseUrl, apiKey);
  void setCommentAddContext(canAdd);
  return canAdd;
};

export const buildCommentsViewItems = (
  comments: Comment[],
  ticketId?: number,
  errorMessage?: string,
): vscode.TreeItem[] => {
  if (errorMessage) {
    return [createErrorStateItem(errorMessage)];
  }

  if (!ticketId) {
    return [createEmptyStateItem("Select a ticket to view comments.")];
  }

  if (comments.length === 0) {
    return [createEmptyStateItem("No comments for the selected ticket.")];
  }

  return comments
    .slice(0, MAX_VIEW_ITEMS)
    .map((comment) => new CommentTreeItem(comment));
};

export class CommentsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  private comments: Comment[] = [];
  private ticketId?: number;
  private errorMessage?: string;

  readonly onDidChangeTreeData = this.emitter.event;

  setTicketId(ticketId: number | undefined): void {
    this.ticketId = ticketId;
    refreshAddCommentContext(this.ticketId);
    this.refresh();
  }

  refreshForTicket(ticketId: number): void {
    this.ticketId = ticketId;
    this.refresh();
  }

  refresh(): void {
    void this.loadComments();
  }

  getTicketId(): number | undefined {
    return this.ticketId;
  }

  async loadComments(): Promise<void> {
    refreshAddCommentContext(this.ticketId);
    if (!this.ticketId) {
      this.errorMessage = undefined;
      this.comments = [];
      this.emitter.fire();
      return;
    }

    try {
      this.errorMessage = undefined;
      const currentUserId = await getCurrentUserId();
      this.comments = await listComments(this.ticketId, currentUserId);
      this.emitter.fire();
    } catch (error) {
      const message = (error as Error).message;
      this.errorMessage = `Failed to load comments: ${message}`;
      showError(this.errorMessage);
      this.emitter.fire();
    }
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    return this.getViewItems();
  }

  getViewItems(): vscode.TreeItem[] {
    return buildCommentsViewItems(this.comments, this.ticketId, this.errorMessage);
  }
}

export class CommentTreeItem extends vscode.TreeItem {
  constructor(public readonly comment: Comment) {
    super(formatCommentLabel(comment), vscode.TreeItemCollapsibleState.None);
    this.description = formatCommentDescription(comment);
    this.contextValue = comment.editableByCurrentUser
      ? "redmineCommentEditable"
      : "redmineComment";
  }
}
