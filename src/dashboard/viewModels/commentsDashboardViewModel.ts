import { Comment } from "../../redmine/types";
import type { DashboardCommentItem, DashboardUnsyncedKey } from "../dashboardProtocol";
import { getOfflineSyncQueue, isAbandoned } from "../../views/offlineSyncStore";
import { getCurrentConnectionScope } from "../../config/connectionScope";
import { isCommentEditing } from "../../views/commentEditStore";

export const buildCommentDashboardItems = (
  comments: Comment[],
  ticketId?: number,
): DashboardCommentItem[] => {
  const connectionScope = getCurrentConnectionScope();
  const queue = getOfflineSyncQueue(connectionScope);
  const targetTicketId = ticketId ?? comments[0]?.ticketId;
  const localUnsyncedComments: DashboardCommentItem[] =
    targetTicketId === undefined
      ? []
      : queue.comments
        .filter((entry) => entry.ticketId === targetTicketId && entry.commentId === undefined && !isAbandoned(entry))
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
    const activeQueuedEntry = c.editableByCurrentUser
      ? queue.comments.find(
          (entry) =>
            entry.ticketId === c.ticketId &&
            !isAbandoned(entry) &&
            entry.commentId === c.id &&
            entry.sourceNotesHash !== undefined,
        )
      : undefined;
    const syncKey: DashboardUnsyncedKey | undefined = activeQueuedEntry
      ? { kind: "comment", ticketId: c.ticketId, commentId: c.id }
      : undefined;
    const isEditing = c.editableByCurrentUser
      ? isCommentEditing(c.ticketId, c.id, connectionScope, activeQueuedEntry?.body)
      : false;
    return {
      id: c.id,
      noteIndex: c.noteIndex,
      authorName: c.authorName,
      body: c.body,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      editableByCurrentUser: c.editableByCurrentUser,
      hasUnsyncedEdit: syncKey !== undefined,
      isEditing,
      syncKey,
    };
  });
  return [...localUnsyncedComments, ...remoteComments];
};
