import * as vscode from "vscode";
import { computeNotesHash } from "../utils/notesHash";
import { Comment } from "../redmine/types";
import { CommentSaveResult } from "./commentSaveTypes";

import { type CommentSaveDependencies } from "./commentSyncDependencies";
import { buildResult, mapErrorToResult } from "./commentSyncResult";

const buildConflictResult = (input: {
  message: string;
  commentId: number;
  ticketId: number;
  operationScope?: string;
  baseBody: string;
  localBody: string;
  remoteComment: Comment;
}): CommentSaveResult =>
  buildResult("conflict", input.message, {
    conflictContext: {
      ...(input.operationScope ? { connectionScope: input.operationScope } : {}),
      commentId: input.commentId,
      ticketId: input.ticketId,
      baseBody: input.baseBody,
      localBody: input.localBody,
      remoteBody: input.remoteComment.body,
      remoteUpdatedAt: input.remoteComment.updatedAt,
    },
  });

export const detectUpdatedAtConflict = async (input: {
  deps: CommentSaveDependencies;
  commentId: number;
  ticketId: number;
  operationScope?: string;
  lastKnownRemoteUpdatedAt: string;
  baseBody: string;
  localBody: string;
}): Promise<CommentSaveResult | undefined> => {
  try {
    const detail = await input.deps.getIssueDetail(input.ticketId);
    const remoteComment = detail.comments.find((c) => c.id === input.commentId);
    if (detail.ticket.id !== input.ticketId || !remoteComment) {
      return buildResult("not_found", vscode.l10n.t("Comment not found in Redmine."));
    }
    if (remoteComment.updatedAt !== input.lastKnownRemoteUpdatedAt) {
      return buildConflictResult({
        message: "Remote changes detected. Refresh before saving.",
        commentId: input.commentId,
        ticketId: input.ticketId,
        operationScope: input.operationScope,
        baseBody: input.baseBody,
        localBody: input.localBody,
        remoteComment,
      });
    }
  } catch (error) {
    return mapErrorToResult(error);
  }
  return undefined;
};

export const enrichConflictWithRemote = async (input: {
  deps: CommentSaveDependencies;
  result: CommentSaveResult;
  commentId: number;
  ticketId: number;
  operationScope?: string;
  baseBody: string;
  localBody: string;
}): Promise<CommentSaveResult> => {
  if (input.result.status !== "conflict") {
    return input.result;
  }
  try {
    const detail = await input.deps.getIssueDetail(input.ticketId);
    const remoteComment = detail.comments.find((c) => c.id === input.commentId);
    if (remoteComment) {
      return buildConflictResult({
        message: input.result.message,
        commentId: input.commentId,
        ticketId: input.ticketId,
        operationScope: input.operationScope,
        baseBody: input.baseBody,
        localBody: input.localBody,
        remoteComment,
      });
    }
  } catch {
    // Ignore enrichment failure; return original conflict result.
  }
  return input.result;
};

export const detectHashBasedConflict = async (input: {
  deps: CommentSaveDependencies;
  commentId: number;
  ticketId: number;
  operationScope?: string;
  sourceNotesHash: string;
  baseBody: string;
  localBody: string;
}): Promise<CommentSaveResult | undefined> => {
  try {
    const detail = await input.deps.getIssueDetail(input.ticketId);
    const remoteComment = detail.comments.find((c) => c.id === input.commentId);
    if (!remoteComment) {
      return buildResult("not_found", vscode.l10n.t("Comment not found. It may have been deleted or changed in Redmine."));
    }
    const remoteHash = computeNotesHash(remoteComment.body);
    if (remoteHash !== input.sourceNotesHash) {
      return buildConflictResult({
        message: vscode.l10n.t("Comment was updated in Redmine. Review the diff before syncing."),
        commentId: input.commentId,
        ticketId: input.ticketId,
        operationScope: input.operationScope,
        baseBody: input.baseBody,
        localBody: input.localBody,
        remoteComment,
      });
    }
  } catch (err) {
    const mapped = mapErrorToResult(err);
    if (mapped.status === "not_found") { return mapped; }
    // Other fetch errors are non-fatal — fall through to update attempt.
  }
  return undefined;
};
