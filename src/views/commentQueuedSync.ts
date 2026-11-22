import * as vscode from "vscode";
import { UploadToken } from "../redmine/types";
import { updateCommentEdit } from "./commentEditStore";
import { CommentSaveResult } from "./commentSaveTypes";
import { resolveUploadSummary } from "./ticketSync/ticketImageUploadSync";
import { OfflineCommentUpdate } from "./offlineSyncStore";
import { isRemoteCommitUnknownError } from "./ticketSync/ticketSyncResult";
import { containsConflictMarkers } from "../utils/threeWayMerge";

import { defaultCommentSaveDeps as defaultDeps, type CommentSaveDependencies } from "./commentSyncDependencies";
import { buildResult, buildUnresolvedResult, mapErrorToResult, mapHashBasedUpdateError } from "./commentSyncResult";
import { processCommentContent } from "./commentContentProcessing";
import { fetchPersistedCommentInfo } from "./commentRemoteIdentity";
import { detectUpdatedAtConflict, detectHashBasedConflict } from "./commentRemoteConflict";

const applyQueuedExistingComment = async (input: {
  operationScope?: string;
  deps: CommentSaveDependencies;
  update: OfflineCommentUpdate & { commentId: number };
  nextContent: string;
  uploads: UploadToken[];
  uploadSummary: ReturnType<typeof resolveUploadSummary>;
  beforeRemoteWrite?: () => Promise<void>;
  afterRemoteWrite?: () => Promise<void>;
  reconcileOnly?: boolean;
}): Promise<CommentSaveResult> => {
  const { deps, update, nextContent, uploads, uploadSummary } = input;

  if (containsConflictMarkers(nextContent)) {
    return buildResult("failed", vscode.l10n.t("Resolve all merge conflict markers before syncing."));
  }

  if (update.baseBody && nextContent === update.baseBody) {
    return buildResult("no_change", "No changes to save.", { uploadSummary });
  }

  if (input.reconcileOnly) {
    return buildResult("success", "Comment update committed.", { uploadSummary });
  }

  if (update.sourceNotesHash) {
    const conflict = await detectHashBasedConflict({
      deps,
      commentId: update.commentId,
      ticketId: update.ticketId,
      operationScope: input.operationScope,
      sourceNotesHash: update.sourceNotesHash,
      baseBody: update.baseBody ?? "",
      localBody: nextContent,
    });
    if (conflict) { return conflict; }
  } else if (update.lastKnownRemoteUpdatedAt) {
    const conflict = await detectUpdatedAtConflict({
      deps,
      commentId: update.commentId,
      ticketId: update.ticketId,
      operationScope: input.operationScope,
      lastKnownRemoteUpdatedAt: update.lastKnownRemoteUpdatedAt,
      baseBody: update.baseBody ?? "",
      localBody: nextContent,
    });
    if (conflict) { return conflict; }
  }

  try {
    await input.beforeRemoteWrite?.();
  } catch (error) {
    return buildResult(
      "failed",
      error instanceof Error ? error.message : "Sync journal persistence failed.",
      { uploadSummary },
    );
  }
  try {
    await deps.updateComment(
      update.commentId,
      nextContent,
      uploads.length > 0 ? uploads : undefined,
    );
  } catch (error) {
    const mapped = mapErrorToResult(error);
    const result = update.sourceNotesHash ? mapHashBasedUpdateError(mapped) : mapped;
    return {
      ...result,
      remoteWriteAttempted: true,
      remoteCommitUnknown: isRemoteCommitUnknownError(error),
    };
  }

  try {
    await input.afterRemoteWrite?.();
  } catch (error) {
    return buildResult(
      "failed",
      error instanceof Error ? error.message : "Remote commit journal failed.",
      { uploadSummary, remoteWriteAttempted: true, remoteCommitted: true },
    );
  }

  updateCommentEdit(
    update.commentId,
    nextContent,
    update.lastKnownRemoteUpdatedAt,
    input.operationScope,
  );
  return buildResult("success", "Comment updated.", {
    uploadSummary,
    remoteWriteAttempted: true,
    remoteCommitted: true,
  });
};

const applyQueuedNewComment = async (input: {
  deps: CommentSaveDependencies;
  ticketId: number;
  nextContent: string;
  uploads: UploadToken[];
  uploadSummary: ReturnType<typeof resolveUploadSummary>;
  beforeRemoteWrite?: () => Promise<void>;
  afterRemoteWrite?: () => Promise<void>;
  reconcileOnly?: boolean;
}): Promise<CommentSaveResult> => {
  const { deps, ticketId, nextContent, uploads, uploadSummary } = input;

  if (!input.reconcileOnly) {
    try {
      await input.beforeRemoteWrite?.();
    } catch (error) {
      return buildResult(
        "failed",
        error instanceof Error ? error.message : "Sync journal persistence failed.",
        { uploadSummary },
      );
    }
    try {
      await deps.addComment(ticketId, nextContent, uploads.length > 0 ? uploads : undefined);
    } catch (error) {
      return {
        ...mapErrorToResult(error),
        remoteWriteAttempted: true,
        remoteCommitUnknown: isRemoteCommitUnknownError(error),
      };
    }
    try {
      await input.afterRemoteWrite?.();
    } catch (error) {
      return buildUnresolvedResult(
        error instanceof Error ? error.message : "Remote commit journal failed.",
        { uploadSummary, remoteWriteAttempted: true, remoteCommitted: true },
      );
    }
  }

  const persisted = await fetchPersistedCommentInfo(deps, ticketId, nextContent);
  if (!persisted.ok) {
    return buildUnresolvedResult(persisted.message, {
      uploadSummary,
      remoteWriteAttempted: !input.reconcileOnly,
      remoteCommitted: true,
    });
  }
  return buildResult("created", "Comment added.", {
    commentId: persisted.commentId,
    projectId: persisted.projectId,
    uploadSummary,
    remoteWriteAttempted: !input.reconcileOnly,
    remoteCommitted: true,
  });
};

export const applyQueuedCommentUpdate = async (input: {
  update: OfflineCommentUpdate;
  deps?: Partial<CommentSaveDependencies>;
  operationScope?: string;
  beforeRemoteWrite?: () => Promise<void>;
  afterRemoteWrite?: () => Promise<void>;
  reconcileOnly?: boolean;
}): Promise<CommentSaveResult> => {
  const deps = { ...defaultDeps, ...input.deps };
  const update = input.update;
  const processed = await processCommentContent({
    content: update.body,
    baseDir: update.baseDir,
    deps,
  });
  if (!processed.ok) { return processed.failure; }
  const { content: nextContent, uploads, uploadSummary } = processed;

  if (update.commentId) {
    return applyQueuedExistingComment({
      deps,
      update: { ...update, commentId: update.commentId },
      nextContent,
      uploads,
      uploadSummary,
      operationScope: input.operationScope,
      beforeRemoteWrite: input.beforeRemoteWrite,
      afterRemoteWrite: input.afterRemoteWrite,
      reconcileOnly: input.reconcileOnly,
    });
  }

  return applyQueuedNewComment({
    deps,
    ticketId: update.ticketId,
    nextContent,
    uploads,
    uploadSummary,
    beforeRemoteWrite: input.beforeRemoteWrite,
    afterRemoteWrite: input.afterRemoteWrite,
    reconcileOnly: input.reconcileOnly,
  });
};
