import type { DashboardServiceContext } from "./DashboardServiceContext";
import * as vscode from "vscode";
import { getIssueDetail } from "../../redmine/issues";
import { listComments } from "../../redmine/comments";
import type { Comment } from "../../redmine/types";
import { getCurrentUserId } from "../../redmine/users";
import { buildCommentDashboardItems } from "../viewModels/commentsDashboardViewModel";
import { openIssueInBrowser } from "../../commands/openInBrowser";
import { openCommentUpdateDraft } from "../../commands/openCommentUpdateDraft";
import { addCommentFromList } from "../../commands/addCommentFromList";

export interface CommentSelectionTarget {
  commentId?: number;
  documentUri?: string;
}

export class DashboardCommentService {
  private loadGeneration = 0;
  private readonly cachedCommentsByTicket = new Map<number, Comment[]>();

  constructor(
    private readonly context: DashboardServiceContext,
    private readonly deps: {
      selectTicket: (ticketId: number) => Promise<void>;
    },
  ) {}

  invalidate(): void {
    this.loadGeneration++;
    this.cachedCommentsByTicket.clear();
  }

  refreshPresentation(ticketId: number): void {
    const { store } = this.context;
    const state = store.getState();
    if (
      state.selectedTicketId !== ticketId ||
      state.comments.ticketId !== ticketId ||
      state.comments.loading
    ) {
      return;
    }
    const comments = this.cachedCommentsByTicket.get(ticketId);
    if (!comments) {
      return;
    }
    store.updateNested("comments", {
      items: buildCommentDashboardItems(comments, ticketId),
    });
  }

  selectComment(ticketId: number, selection: CommentSelectionTarget): void {
    const { store } = this.context;
    const state = store.getState();
    if (state.selectedTicketId !== ticketId) {
      return;
    }
    const nextCommentId = selection.commentId;
    const nextCommentUri =
      nextCommentId !== undefined ? undefined : selection.documentUri;
    if (
      state.comments.ticketId === ticketId &&
      state.comments.selectedCommentId === nextCommentId &&
      state.comments.selectedCommentUri === nextCommentUri
    ) {
      return;
    }
    store.updateNested("comments", {
      selectedCommentId: nextCommentId,
      selectedCommentUri: nextCommentUri,
    });
  }

  removeDeletedComment(ticketId: number, commentId: number): void {
    const cached = this.cachedCommentsByTicket.get(ticketId);
    if (cached) {
      this.cachedCommentsByTicket.set(ticketId, cached.filter(comment => comment.id !== commentId));
    }
    const { store } = this.context;
    const comments = store.getState().comments;
    if (comments.ticketId === ticketId) {
      store.updateNested("comments", { items: comments.items.filter(comment => comment.id !== commentId) });
    }
  }

  async loadComments(
    ticketId: number,
    throwOnError = false,
    selection?: CommentSelectionTarget,
  ): Promise<void> {
    const { store } = this.context;
    const state = store.getState();
    if (state.selectedTicketId !== ticketId) {
      return;
    }
    const nextCommentId = selection
      ? selection.commentId
      : state.comments.ticketId === ticketId
        ? state.comments.selectedCommentId
        : undefined;
    const nextCommentUri = selection
      ? selection.commentId !== undefined
        ? undefined
        : selection.documentUri
      : state.comments.ticketId === ticketId
        ? state.comments.selectedCommentUri
        : undefined;
    const generation = ++this.loadGeneration;
    store.updateNested("comments", {
      ticketId,
      loading: true,
      error: undefined,
      selectedCommentId: nextCommentId,
      selectedCommentUri: nextCommentUri,
    });
    try {
      const currentUserId = await getCurrentUserId();
      const comments = await listComments(ticketId, currentUserId);
      if (
        generation !== this.loadGeneration ||
        store.getState().selectedTicketId !== ticketId ||
        store.getState().comments.ticketId !== ticketId
      ) {
        return;
      }
      this.cachedCommentsByTicket.clear();
      this.cachedCommentsByTicket.set(ticketId, comments);
      store.updateNested("comments", {
        loading: false,
        items: buildCommentDashboardItems(comments, ticketId),
      });
    } catch (err) {
      if (
        generation !== this.loadGeneration ||
        store.getState().selectedTicketId !== ticketId ||
        store.getState().comments.ticketId !== ticketId
      ) {
        return;
      }
      const msg = (err as Error).message;
      store.updateNested("comments", {
        loading: false,
        error: `Failed to load comments: ${msg}`,
      });
      if (throwOnError) {
        throw err;
      }
    }
  }

  async openCommentInBrowser(ticketId: number, commentId: number): Promise<void> {
    await openIssueInBrowser({ ticketId, commentId }, { comments: this.context.store.getState().comments });
  }

  async editTicketComment(ticketId: number, commentId: number): Promise<void> {
    try {
      const [detail, currentUserId] = await Promise.all([
        getIssueDetail(ticketId),
        getCurrentUserId(),
      ]);
      const comment = detail.comments.find((c) => c.id === commentId);
      if (!comment) {
        return;
      }
      if (comment.authorId !== currentUserId) {
        this.context.notifyToast(
          "error",
          vscode.l10n.t("You do not have permission to edit this comment. Check Redmine permission settings."),
        );
        return;
      }
      await openCommentUpdateDraft(comment, detail.ticket);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.context.notifyToast(
        "error",
        vscode.l10n.t("Unable to resolve the comment for this editor.") + ` (${message})`,
      );
    }
  }

  async addComment(ticketId: number): Promise<void> {
    void this.deps.selectTicket(ticketId);
    await addCommentFromList(ticketId);
  }
}
