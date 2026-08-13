import type { CommentSaveDependencies } from "../views/commentSaveSync";
import {
  addOfflineCommentUpdate,
  type OfflineCommentUpdate,
} from "../views/offlineSyncStore";
import { runWithConnectionScope } from "../redmine/client";
import { createSyncEngine, type SyncEngineOutcome } from "./syncEngine";

export const queueAndSyncComment = async (input: {
  operation: OfflineCommentUpdate;
  connectionScope: string;
  deps?: Partial<CommentSaveDependencies>;
}): Promise<SyncEngineOutcome> => {
  addOfflineCommentUpdate(input.operation, input.connectionScope);
  const key = {
    kind: "comment" as const,
    ticketId: input.operation.ticketId,
    commentId: input.operation.commentId,
    documentUri: input.operation.documentUri,
  };
  return runWithConnectionScope(
    input.connectionScope,
    () => createSyncEngine({ comments: input.deps }).syncOne(
      key,
      { connectionScope: input.connectionScope },
    ),
  );
};

export const commentSyncOutcomeMessage = (outcome: SyncEngineOutcome): string => {
  switch (outcome.kind) {
    case "failed_before_commit": return outcome.error.message;
    case "conflict":
    case "commit_unknown":
    case "remote_committed": return outcome.message ?? "Comment recovery is pending.";
    default: return "Comment synchronization did not complete.";
  }
};
