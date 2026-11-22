import type { UploadToken } from "../../redmine/types";

export interface PreparedCommentData {
  ticketId: number;
  commentId?: number;
  rawBody: string;
  body: string;
  imageLinks: Array<{ path: string; range: { start: number; end: number }; resolvedPath?: string }>;
  uploads: UploadToken[];
  uploadSummary?: any;
  alreadyApplied?: boolean;
}
