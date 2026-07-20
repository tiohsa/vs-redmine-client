import { Comment } from "../../redmine/types";
import type { DashboardCommentItem, DashboardUnsyncedKey } from "../dashboardProtocol";
import { getOfflineSyncQueue } from "../../views/offlineSyncStore";
import { getCurrentConnectionScope } from "../../config/connectionScope";

export const buildCommentDashboardItems = (
  comments: Comment[],
  ticketId?: number,
): DashboardCommentItem[] => {
  const queue = getOfflineSyncQueue(getCurrentConnectionScope());
  const targetTicketId = ticketId ?? comments[0]?.ticketId;
  const localUnsyncedComments: DashboardCommentItem[] =
    targetTicketId === undefined
      ? []
      : queue.comments
        .filter((entry) => entry.ticketId === targetTicketId && entry.commentId === undefined)
        .map((entry) => ({
          authorName: "Local draft",
          body: entry.body,
          editableByCurrentUser: false,
          hasUnsyncedEdit: true,
          isLocalUnsynced: true,
          syncKey: entry.documentUri
            ? {
                kind: "comment",
                ticketId: entry.ticketId,
                documentUri: entry.documentUri,
              }
            : undefined,
        }));
  const remoteComments = comments.map((c) => {
    const syncKey: DashboardUnsyncedKey | undefined =
      c.editableByCurrentUser &&
      queue.comments.some(
        (entry) =>
          entry.ticketId === c.ticketId &&
          entry.commentId === c.id &&
          entry.sourceNotesHash !== undefined,
      )
        ? { kind: "comment", ticketId: c.ticketId, commentId: c.id }
        : undefined;
    return {
      id: c.id,
      authorName: c.authorName,
      body: c.body,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      editableByCurrentUser: c.editableByCurrentUser,
      hasUnsyncedEdit: syncKey !== undefined,
      syncKey,
    };
  });
  return [...localUnsyncedComments, ...remoteComments];
};
