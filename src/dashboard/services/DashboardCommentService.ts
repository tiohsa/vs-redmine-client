import type { DashboardServiceContext } from "./DashboardServiceContext";
import { getIssueDetail } from "../../redmine/issues";
import { buildCommentDashboardItems } from "../viewModels/commentsDashboardViewModel";
import { openCommentInBrowser } from "../../commands/openInBrowser";
import { openCommentUpdateDraft } from "../../commands/openCommentUpdateDraft";
import { addCommentFromList } from "../../commands/addCommentFromList";

export class DashboardCommentService {
  constructor(
    private readonly context: DashboardServiceContext,
    private readonly deps: {
      selectTicket: (ticketId: number) => Promise<void>;
    },
  ) {}

  async loadComments(ticketId: number): Promise<void> {
    const { store } = this.context;
    store.updateNested("comments", { ticketId, loading: true, error: undefined });
    try {
      const detail = await getIssueDetail(ticketId);
      store.updateNested("comments", {
        loading: false,
        items: buildCommentDashboardItems(detail.comments),
      });
    } catch (err) {
      const msg = (err as Error).message;
      store.updateNested("comments", {
        loading: false,
        error: `Failed to load comments: ${msg}`,
      });
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
      const detail = await getIssueDetail(ticketId);
      const comment = detail.comments.find((c) => c.id === commentId);
      if (comment) {
        await openCommentUpdateDraft(comment, detail.ticket);
      }
    } catch {
      // Ignore preparation failures.
    }
  }

  async addComment(ticketId: number): Promise<void> {
    void this.deps.selectTicket(ticketId);
    await addCommentFromList(ticketId);
  }
}
