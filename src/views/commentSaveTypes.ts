export type CommentSaveStatus =
  | "success"
  | "created"
  | "created_unresolved"
  | "queued"
  | "merged"
  | "no_change"
  | "conflict"
  | "unreachable"
  | "forbidden"
  | "not_found"
  | "failed";

export interface CommentConflictContext {
  commentId: number;
  ticketId: number;
  baseBody: string;
  /** False when the queue only has a source hash and cannot perform a valid three-way merge. */
  baseBodyKnown?: boolean;
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
  remoteWriteAttempted?: boolean;
  remoteCommitUnknown?: boolean;
  remoteCommitted?: boolean;
}

export const COMMENT_TYPE_LABEL = "comment";
import { UploadSummary } from "./saveUploadTypes";
