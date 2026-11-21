import { Comment } from "../redmine/types";
import { OfflineCommentUpdate } from "./offlineSyncStore";

import { defaultCommentSaveDeps as defaultDeps, type CommentSaveDependencies } from "./commentSyncDependencies";

export const normalizeCommentBody = (body: string): string => body.trim();

export const resolveCreatedCommentId = (
  comments: Comment[],
  submittedBody: string,
  currentUserId?: number,
): number | undefined => {
  const normalized = normalizeCommentBody(submittedBody);

  if (!normalized || currentUserId === undefined) {
    return undefined;
  }

  const candidates = comments.filter((comment) => {
    if (normalizeCommentBody(comment.body) !== normalized) {
      return false;
    }
    return comment.authorId === currentUserId;
  });

  if (candidates.length !== 1) {
    return undefined;
  }

  return candidates[0].id;
};

export const reconcileCommentCommitUnknown = async (
  update: OfflineCommentUpdate,
  overrides: Partial<CommentSaveDependencies> = {},
  candidateCommentId?: number,
): Promise<
  | { ok: true; commentId: number; projectId: number }
  | { ok: false; message: string }
> => {
  const deps = { ...defaultDeps, ...overrides };
  try {
    const [detail, currentUserId] = await Promise.all([
      deps.getIssueDetail(update.ticketId),
      deps.getCurrentUserId().catch(() => undefined),
    ]);
    if (detail.ticket.id !== update.ticketId) {
      return { ok: false, message: "The reconciliation response belongs to another ticket." };
    }
    const normalizedBody = normalizeCommentBody(update.body);
    const candidates = detail.comments.filter((comment) =>
      comment.ticketId === update.ticketId &&
      normalizeCommentBody(comment.body) === normalizedBody &&
      (candidateCommentId === undefined || comment.id === candidateCommentId) &&
      (update.commentId === undefined
        ? currentUserId !== undefined && comment.authorId === currentUserId
        : comment.id === update.commentId &&
          (currentUserId === undefined || comment.authorId === currentUserId)),
    );
    if (candidates.length !== 1) {
      return {
        ok: false,
        message: candidates.length === 0
          ? "No uniquely matching committed comment was found in Redmine."
          : "Multiple matching comments were found; automatic linking is disabled.",
      };
    }
    return {
      ok: true,
      commentId: candidates[0].id,
      projectId: detail.ticket.projectId,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Comment reconciliation failed.",
    };
  }
};

export const fetchPersistedCommentInfo = async (
  deps: CommentSaveDependencies,
  ticketId: number,
  nextContent: string,
): Promise<{ ok: true; commentId: number; projectId: number } | { ok: false; message: string }> => {
  let currentUserId: number | undefined;
  try {
    currentUserId = await deps.getCurrentUserId();
  } catch {
    currentUserId = undefined;
  }
  try {
    const detail = await deps.getIssueDetail(ticketId);
    const commentId = resolveCreatedCommentId(detail.comments, nextContent, currentUserId);
    if (!commentId) {
      return { ok: false, message: "Comment added, but the comment ID could not be resolved." };
    }
    return { ok: true, commentId, projectId: detail.ticket.projectId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve comment ID.";
    return { ok: false, message: `Comment added, but ${message}` };
  }
};
