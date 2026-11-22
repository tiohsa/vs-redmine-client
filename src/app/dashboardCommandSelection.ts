import * as vscode from "vscode";
import type { Comment, Ticket } from "../redmine/types";
import type { DashboardCommentItem, DashboardState } from "../dashboard/dashboardProtocol";

export const toSelectedTicket = (state: DashboardState): Ticket | undefined => {
  const id = state.selectedTicketId;
  if (!id) {
    return undefined;
  }
  const fromList = state.tickets.find((t) => t.id === id);
  if (fromList?.projectId) {
    return {
      id: fromList.id,
      subject: fromList.subject,
      description: state.selectedTicket?.description,
      statusName: fromList.statusName,
      priorityName: fromList.priorityName,
      trackerName: fromList.trackerName,
      assigneeName: fromList.assigneeName,
      dueDate: fromList.dueDate,
      startDate: fromList.startDate,
      projectId: fromList.projectId,
      projectName: fromList.projectName,
      parentId: fromList.parentId,
      updatedAt: state.selectedTicket?.lastSyncedAt,
    };
  }
  const detail = state.selectedTicket;
  if (!detail?.projectId) {
    return undefined;
  }
  return {
    id: detail.id,
    subject: detail.subject,
    description: detail.description,
    statusName: detail.statusName,
    priorityName: detail.priorityName,
    trackerName: detail.trackerName,
    assigneeName: detail.assigneeName,
    dueDate: detail.dueDate,
    startDate: detail.startDate,
    projectId: detail.projectId,
    projectName: detail.projectName,
    parentId: detail.parentId,
    updatedAt: detail.lastSyncedAt,
  };
};

export const pickDashboardComment = async (state: DashboardState): Promise<Comment | undefined> => {
  const ticketId = state.comments.ticketId;
  if (!ticketId || state.comments.items.length === 0) {
    return undefined;
  }
  const hasCommentId = (
    comment: DashboardCommentItem,
  ): comment is DashboardCommentItem & { id: number } => comment.id !== undefined;
  const items = state.comments.items.filter(hasCommentId).map((comment) => ({
    label: `#${comment.id} ${comment.authorName}`,
    description: comment.updatedAt ?? comment.createdAt ?? "",
    detail: comment.body.slice(0, 80),
    comment,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t("Select comment"),
    placeHolder: vscode.l10n.t("Select a comment to edit or view in browser"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) {
    return undefined;
  }
  return {
    id: picked.comment.id,
    ticketId,
    authorId: 0,
    authorName: picked.comment.authorName,
    body: picked.comment.body,
    createdAt: picked.comment.createdAt,
    updatedAt: picked.comment.updatedAt,
    editableByCurrentUser: picked.comment.editableByCurrentUser,
  };
};

export const requireSelectedTicket = (
  state: DashboardState,
  errorMessage: string,
): Ticket | undefined => {
  const selected = toSelectedTicket(state);
  if (!selected) {
    vscode.window.showErrorMessage(errorMessage);
    return undefined;
  }
  return selected;
};
