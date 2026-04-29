import { Comment } from "../../redmine/types";
import type { DashboardCommentItem } from "../dashboardProtocol";

export const buildCommentDashboardItems = (comments: Comment[]): DashboardCommentItem[] =>
  comments.map((c) => ({
    id: c.id,
    authorName: c.authorName,
    body: c.body,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    editableByCurrentUser: c.editableByCurrentUser,
  }));
