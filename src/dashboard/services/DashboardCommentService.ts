import type { DashboardServiceContext } from "./DashboardServiceContext";
import * as vscode from "vscode";
import { getIssueDetail } from "../../redmine/issues";
import { listComments } from "../../redmine/comments";
import { getCurrentUserId } from "../../redmine/users";
import { buildCommentDashboardItems } from "../viewModels/commentsDashboardViewModel";
import { openCommentInBrowser } from "../../commands/openInBrowser";
import { openCommentUpdateDraft } from "../../commands/openCommentUpdateDraft";
import { addCommentFromList } from "../../commands/addCommentFromList";

export class DashboardCommentService {
  private loadGeneration = 0;

  constructor(
    private readonly context: DashboardServiceContext,
    private readonly deps: {
      selectTicket: (ticketId: number) => Promise<void>;
    },
  ) {}

  invalidate(): void {
    this.loadGeneration++;
  }

  async loadComments(ticketId: number, throwOnError = false): Promise<void> {
    const { store } = this.context;
    if (store.getState().selectedTicketId !== ticketId) {
      return;
    }
    const generation = ++this.loadGeneration;
    store.updateNested("comments", { ticketId, loading: true, error: undefined });
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

  async openCommentInBrowser(
    ticketId: number,
    commentId: number,
    noteIndex?: number,
  ): Promise<void> {
    await openCommentInBrowser({
      comment: {
        id: commentId,
        ticketId,
        authorId: 0,
        authorName: "",
        body: "",
        editableByCurrentUser: false,
        noteIndex,
      },
    });
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
