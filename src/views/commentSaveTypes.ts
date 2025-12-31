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

export interface CommentConflictContext {
  commentId: number;
  ticketId: number;
  localBody: string;
  remoteBody: string;
  remoteUpdatedAt?: string;
}

export interface CommentSaveResult {
  status: CommentSaveStatus;
  message: string;
  commentId?: number;
  projectId?: number;
  uploadSummary?: UploadSummary;
  conflictContext?: CommentConflictContext;
}

export const COMMENT_TYPE_LABEL = "comment";
import { UploadSummary } from "./saveUploadTypes";

