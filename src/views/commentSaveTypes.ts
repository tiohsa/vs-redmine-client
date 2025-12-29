export type CommentSaveStatus =
  | "success"
  | "created"
  | "created_unresolved"
  | "no_change"
  | "conflict"
  | "unreachable"
  | "forbidden"
  | "not_found"
  | "failed";

export interface CommentSaveResult {
  status: CommentSaveStatus;
  message: string;
  commentId?: number;
  projectId?: number;
}

export const COMMENT_TYPE_LABEL = "comment";
