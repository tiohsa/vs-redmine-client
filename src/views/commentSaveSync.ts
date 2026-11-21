import * as vscode from "vscode";
import { validateComment } from "../utils/commentValidation";
import { resolveEditorBaseDir } from "../utils/editorBaseDir";
import { setEditorDisplaySource } from "./ticketEditorRegistry";
import { getCommentEdit, updateCommentEdit } from "./commentEditStore";
import { CommentSaveResult } from "./commentSaveTypes";
import { applyEditorContent } from "./ticketPreview";
import { getOfflineSyncMode } from "../config/settings";
import { addOfflineCommentUpdateAsync } from "./offlineSyncStore";
import { containsConflictMarkers } from "../utils/threeWayMerge";

import { defaultCommentSaveDeps as defaultDeps, type CommentSaveDependencies } from "./commentSyncDependencies";
import { buildResult, buildUnresolvedResult, mapErrorToResult } from "./commentSyncResult";
import { processCommentContent } from "./commentContentProcessing";
import { fetchPersistedCommentInfo } from "./commentRemoteIdentity";
import { detectUpdatedAtConflict, enrichConflictWithRemote } from "./commentRemoteConflict";
import { hasAbandonedComment, abandonedCommentResult } from "./commentDraftLocalState";

export type { CommentSaveDependencies } from "./commentSyncDependencies";
export { shouldRefreshComments } from "./commentSyncResult";
export { normalizeCommentBody, resolveCreatedCommentId, reconcileCommentCommitUnknown } from "./commentRemoteIdentity";
export {
  finalizeNewCommentDraftState,
  finalizeNewCommentDraftDocument,
  saveCommentDraftLocally,
  saveCommentDocumentLocally,
  handleCommentEditorSave,
} from "./commentDraftLocalState";
export { applyQueuedCommentUpdate } from "./commentQueuedSync";
export { reloadCommentEditor, type CommentReloadDependencies } from "./commentReload";

export const syncCommentDraft = async (input: {
  operationScope?: string;
  commentId: number;
  content: string;
  editor?: vscode.TextEditor;
  documentUri?: vscode.Uri;
  deps?: Partial<CommentSaveDependencies>;
}): Promise<CommentSaveResult> => {
  const guardedEdit = getCommentEdit(input.commentId, input.operationScope);
  if (guardedEdit && hasAbandonedComment(guardedEdit.ticketId, input.commentId,
    input.documentUri?.toString() ?? input.editor?.document.uri.toString(), input.operationScope)) {
    return abandonedCommentResult();
  }
  if (getOfflineSyncMode() === "manual") {
    const validation = validateComment(input.content);
    if (!validation.valid) {
      return buildResult("failed", validation.message ?? "Invalid comment.");
    }
    const edit = getCommentEdit(input.commentId, input.operationScope);
    if (!edit) {
      return buildResult("failed", "Missing comment edit state.");
    }
    const baseDir = resolveEditorBaseDir({ editor: input.editor, documentUri: input.documentUri });
    await addOfflineCommentUpdateAsync({
      ticketId: edit.ticketId,
      commentId: input.commentId,
      baseBody: edit.baseBody,
      lastKnownRemoteUpdatedAt: edit.lastKnownRemoteUpdatedAt,
      body: input.content,
      baseDir,
      documentUri: input.documentUri?.toString() ?? input.editor?.document.uri.toString(),
    }, input.operationScope);
    updateCommentEdit(
      input.commentId,
      input.content,
      edit.lastKnownRemoteUpdatedAt,
      input.operationScope,
    );
    if (input.editor) {
      setEditorDisplaySource(input.editor, "saved");
    }
    return buildResult("queued", "Saved for offline sync.");
  }
  const deps = { ...defaultDeps, ...input.deps };
  const edit = getCommentEdit(input.commentId, input.operationScope);
  if (!edit) {
    return buildResult("failed", "Missing comment edit state.");
  }

  const baseDir = resolveEditorBaseDir({ editor: input.editor, documentUri: input.documentUri });
  const processed = await processCommentContent({ content: input.content, baseDir, deps });
  if (!processed.ok) { return processed.failure; }
  const { content: nextContent, uploads, uploadSummary } = processed;
  if (containsConflictMarkers(nextContent)) {
    return buildResult("failed", vscode.l10n.t("Resolve all merge conflict markers before syncing."));
  }

  if (nextContent === edit.baseBody) {
    return buildResult("no_change", "No changes to save.", { uploadSummary });
  }

  if (edit.lastKnownRemoteUpdatedAt) {
    const conflict = await detectUpdatedAtConflict({
      deps,
      commentId: input.commentId,
      ticketId: edit.ticketId,
      operationScope: input.operationScope,
      lastKnownRemoteUpdatedAt: edit.lastKnownRemoteUpdatedAt,
      baseBody: edit.baseBody,
      localBody: nextContent,
    });
    if (conflict) { return conflict; }
  }

  try {
    // Redmine's journal update API doesn't support uploads.
    // Attach files to the issue first, then update the journal.
    if (uploads.length > 0) {
      await deps.updateIssue({ issueId: edit.ticketId, fields: { uploads } });
    }
    await deps.updateComment(input.commentId, nextContent, uploads.length > 0 ? uploads : undefined);
  } catch (error) {
    return enrichConflictWithRemote({
      deps,
      result: mapErrorToResult(error),
      commentId: input.commentId,
      ticketId: edit.ticketId,
      operationScope: input.operationScope,
      baseBody: edit.baseBody,
      localBody: nextContent,
    });
  }

  updateCommentEdit(input.commentId, nextContent, undefined, input.operationScope);
  if (input.editor && nextContent !== input.content) {
    await applyEditorContent(input.editor, nextContent);
  }
  return buildResult("success", "Comment updated.", { uploadSummary });
};

export const syncNewCommentDraft = async (input: {
  operationScope?: string;
  ticketId: number;
  content: string;
  editor?: vscode.TextEditor;
  documentUri?: vscode.Uri;
  deps?: Partial<CommentSaveDependencies>;
  onCreated?: (created: { commentId: number; projectId: number }) => Promise<void>;
}): Promise<CommentSaveResult> => {
  if (hasAbandonedComment(input.ticketId, undefined,
    input.documentUri?.toString() ?? input.editor?.document.uri.toString(), input.operationScope)) {
    return abandonedCommentResult();
  }
  if (getOfflineSyncMode() === "manual") {
    const validation = validateComment(input.content);
    if (!validation.valid) {
      return buildResult("failed", validation.message ?? "Invalid comment.");
    }
    const baseDir = resolveEditorBaseDir({ editor: input.editor, documentUri: input.documentUri });
    await addOfflineCommentUpdateAsync({
      ticketId: input.ticketId,
      body: input.content,
      baseDir,
      documentUri: input.documentUri?.toString() ?? input.editor?.document.uri.toString(),
    }, input.operationScope);
    if (input.editor) {
      setEditorDisplaySource(input.editor, "saved");
    }
    return buildResult("queued", "Saved for offline sync.");
  }
  const deps = { ...defaultDeps, ...input.deps };
  const baseDir = resolveEditorBaseDir({ editor: input.editor, documentUri: input.documentUri });
  const processed = await processCommentContent({ content: input.content, baseDir, deps });
  if (!processed.ok) { return processed.failure; }
  const { content: nextContent, uploads, uploadSummary } = processed;

  try {
    await deps.addComment(input.ticketId, nextContent, uploads.length > 0 ? uploads : undefined);
  } catch (error) {
    return mapErrorToResult(error);
  }

  const persisted = await fetchPersistedCommentInfo(deps, input.ticketId, nextContent);
  if (!persisted.ok) {
    return buildUnresolvedResult(persisted.message, { uploadSummary });
  }

  if (input.onCreated) {
    try {
      await input.onCreated({ commentId: persisted.commentId, projectId: persisted.projectId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Rename failed.";
      return buildUnresolvedResult(`Comment added, but ${message}`, { uploadSummary });
    }
  }

  if (input.editor && nextContent !== input.content) {
    await applyEditorContent(input.editor, nextContent);
  }
  return buildResult("created", "Comment added.", {
    commentId: persisted.commentId,
    projectId: persisted.projectId,
    uploadSummary,
  });
};
