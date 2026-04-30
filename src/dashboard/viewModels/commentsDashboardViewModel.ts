import { Comment } from "../../redmine/types";
import type { DashboardCommentItem } from "../dashboardProtocol";
import { getOfflineSyncQueue } from "../../views/offlineSyncStore";

export const buildCommentDashboardItems = (comments: Comment[]): DashboardCommentItem[] => {
  const queue = getOfflineSyncQueue();
  const unsyncedJournalIds = new Set(
    queue.comments
      .filter((c) => c.commentId !== undefined && c.sourceNotesHash !== undefined)
      .map((c) => c.commentId as number),
  );
  return comments.map((c) => ({
    id: c.id,
    authorName: c.authorName,
    body: c.body,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    editableByCurrentUser: c.editableByCurrentUser,
    hasUnsyncedEdit: unsyncedJournalIds.has(c.id),
  }));
};
