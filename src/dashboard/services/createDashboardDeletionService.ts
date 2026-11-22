import { getCurrentConnectionScope } from "../../config/connectionScope";
import { runWithConnectionScope } from "../../redmine/client";
import { deleteIssue, getIssueDetail } from "../../redmine/issues";
import { updateComment } from "../../redmine/comments";
import { RedmineHttpError } from "../../redmine/httpError";
import { assertCanDelete, getTicketIdsWithPendingChanges, runProtectedDelete } from "./dashboardDeletionProtection";
import { getPendingChangeReview } from "./dashboardPendingDeletionChanges";
import { confirmPendingChangeReview, DashboardDeletionService } from "../../layers/extension-host/features/delete-redmine-items";
import type { DashboardControllerOptions } from "../DashboardController";
import type { DashboardTicketService } from "./DashboardTicketService";
import type { DashboardCommentService } from "./DashboardCommentService";
import type { DashboardUnsyncedService } from "./DashboardUnsyncedService";

export function createDashboardDeletionService(deps: Pick<DashboardControllerOptions, "store" | "notifyError" | "notifySuccess" | "revealUnsyncedView"> & {
  getBoundConnectionScope: () => string;
  ticketService: DashboardTicketService;
  commentService: DashboardCommentService;
  unsyncedService: DashboardUnsyncedService;
  cancelDetail: () => void;
}): DashboardDeletionService {
  return new DashboardDeletionService({
      getIssueDetail,
      deleteIssue,
      clearJournalNotes: (journalId) => updateComment(journalId, ""),
      getConnectionScope: getCurrentConnectionScope,
      withConnectionScope: runWithConnectionScope,
      getHttpStatusCode: (error) => error instanceof RedmineHttpError ? error.statusCode : undefined,
      getConnectionGeneration: () => getCurrentConnectionScope() === deps.getBoundConnectionScope()
        ? deps.store.getState().connectionGeneration
        : -1,
      assertCanDelete,
      runProtectedDelete,
      getPendingTicketIds: getTicketIdsWithPendingChanges,
      getPendingChangeReview,
      reviewPendingChanges: confirmPendingChangeReview,
      openUnsynced: (ids) => {
        deps.unsyncedService.revealPendingChanges(ids);
        deps.revealUnsyncedView?.();
      },
      refreshTickets: async (ticketIds) => {
        deps.ticketService.removeDeletedTickets(ticketIds);
        await deps.ticketService.loadTickets();
      },
      refreshComments: async (ticketId, commentId) => {
        deps.commentService.removeDeletedComment(ticketId, commentId);
        await deps.commentService.loadComments(ticketId);
      },
      clearSelectedTicket: (ticketId) => {
        if (deps.store.getState().selectedTicketId === ticketId) { deps.cancelDetail(); }
      },
      clearSelectedComment: (ticketId, commentId) => {
        const state = deps.store.getState();
        if (state.selectedTicketId === ticketId && state.comments.selectedCommentId === commentId) {
          deps.commentService.selectComment(ticketId, {});
        }
      },
      notifyError: deps.notifyError,
      notifySuccess: deps.notifySuccess,
    });
}
