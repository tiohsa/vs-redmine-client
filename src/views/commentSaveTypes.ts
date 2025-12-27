export type CommentSaveStatus =
  | "success"
  | "created"
  | "no_change"
  | "conflict"
  | "unreachable"
  | "forbidden"
  | "not_found"
  | "failed";

export interface CommentSaveResult {
  status: CommentSaveStatus;
  message: string;
}
