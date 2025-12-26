import * as vscode from "vscode";
import { listComments } from "../redmine/comments";
import { Comment } from "../redmine/types";
import { showError } from "../utils/notifications";

export class CommentsTreeProvider implements vscode.TreeDataProvider<CommentTreeItem> {
  private readonly emitter = new vscode.EventEmitter<
    CommentTreeItem | undefined | void
  >();
  private comments: Comment[] = [];
  private ticketId?: number;

  readonly onDidChangeTreeData = this.emitter.event;

  setTicketId(ticketId: number | undefined): void {
    this.ticketId = ticketId;
    this.refresh();
  }

  refresh(): void {
    void this.loadComments();
  }

  async loadComments(): Promise<void> {
    if (!this.ticketId) {
      this.comments = [];
      this.emitter.fire();
      return;
    }

    try {
      this.comments = await listComments(this.ticketId);
      this.emitter.fire();
    } catch (error) {
      showError((error as Error).message);
    }
  }

  getTreeItem(element: CommentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CommentTreeItem): vscode.ProviderResult<CommentTreeItem[]> {
    if (element) {
      return [];
    }

    return this.comments.map((comment) => new CommentTreeItem(comment));
  }
}

export class CommentTreeItem extends vscode.TreeItem {
  constructor(public readonly comment: Comment) {
    super(comment.authorName, vscode.TreeItemCollapsibleState.None);
    this.description = comment.body.slice(0, 80);
    this.contextValue = comment.editableByCurrentUser
      ? "redmineCommentEditable"
      : "redmineComment";
  }
}
