import * as vscode from "vscode";
import { addComment, updateComment } from "../redmine/comments";
import { getIssueDetail, updateIssue } from "../redmine/issues";
import { computeNotesHash } from "../utils/notesHash";
import { getCurrentUserId } from "../redmine/users";
import { Comment, UploadToken } from "../redmine/types";
import { validateComment } from "../utils/commentValidation";
import { uploadFileAttachment } from "../redmine/attachments";
import {
  buildMarkdownImageUploadFailureMessage,
  hasMarkdownImageUploadFailure,
  processMarkdownImageUploads,
} from "../utils/markdownImageUpload";
import { resolveEditorBaseDir } from "../utils/editorBaseDir";
import {
  getCommentIdForEditor,
  getEditorContentType,
  getTicketIdForEditor,
  isTicketEditor,
  registerCommentDocument,
  setEditorCommentId,
  setEditorContentType,
  setEditorProjectId,
  setEditorDisplaySource,
} from "./ticketEditorRegistry";
import { ensureCommentEdit, getCommentEdit, updateCommentEdit } from "./commentEditStore";
import { CommentSaveResult } from "./commentSaveTypes";
import { applyEditorContent } from "./ticketPreview";
import { resolveUploadSummary } from "./ticketSync/ticketImageUploadSync";
import { getOfflineSyncMode } from "../config/settings";
import { addOfflineCommentUpdate, OfflineCommentUpdate } from "./offlineSyncStore";
import { setCommentDraft } from "./commentDraftStore";

export interface CommentSaveDependencies {
  addComment: typeof addComment;
  updateComment: typeof updateComment;
  updateIssue: typeof updateIssue;
  getIssueDetail: typeof getIssueDetail;
  getCurrentUserId: typeof getCurrentUserId;
  uploadFile: typeof uploadFileAttachment;
}

const defaultDeps: CommentSaveDependencies = {
  addComment,
  updateComment,
  updateIssue,
  getIssueDetail,
  getCurrentUserId,
  uploadFile: uploadFileAttachment,
};

export interface CommentReloadDependencies {
  getIssueDetail: typeof getIssueDetail;
  applyEditorContent: typeof applyEditorContent;
}

const defaultReloadDeps: CommentReloadDependencies = {
  getIssueDetail,
  applyEditorContent,
};

const buildResult = (
  status: CommentSaveResult["status"],
  message: string,
  extras: Partial<CommentSaveResult> = {},
): CommentSaveResult => ({
  status,
  message,
  ...extras,
});

export const shouldRefreshComments = (status: CommentSaveResult["status"]): boolean =>
  status === "created" || status === "created_unresolved" || status === "success";

const mapErrorToResult = (error: unknown): CommentSaveResult => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  const match = message.match(/\((\d{3})\)/);
  const statusCode = match ? Number(match[1]) : undefined;

  if (statusCode === 409) {
    return buildResult("conflict", "Remote changes detected. Refresh before saving.");
  }
  if (statusCode === 404) {
    return buildResult("not_found", "Comment not found in Redmine.");
  }
  if (statusCode === 403) {
    return buildResult("forbidden", "Access denied for this comment.");
  }
  if (statusCode && statusCode >= 500) {
    return buildResult("unreachable", "Redmine is unreachable.");
  }

  return buildResult("failed", message);
};

const normalizeCommentBody = (body: string): string => body.trim();

const resolveCreatedCommentId = (
  comments: Comment[],
  body: string,
  currentUserId?: number,
): number | undefined => {
  const normalized = normalizeCommentBody(body);
  if (!normalized) {
    return undefined;
  }

  const candidates = comments.filter((comment) => {
    if (normalizeCommentBody(comment.body) !== normalized) {
      return false;
    }
    if (currentUserId === undefined) {
      return true;
    }
    return comment.authorId === currentUserId;
  });

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates[candidates.length - 1].id;
};

const buildUnresolvedResult = (
  message: string,
  extras: Partial<CommentSaveResult> = {},
): CommentSaveResult => buildResult("created_unresolved", message, extras);

type ProcessedCommentContent =
  | {
      ok: true;
      content: string;
      uploads: UploadToken[];
      uploadSummary: ReturnType<typeof resolveUploadSummary>;
    }
  | { ok: false; failure: CommentSaveResult };

const processCommentContent = async (input: {
  content: string;
  baseDir?: string;
  deps: CommentSaveDependencies;
}): Promise<ProcessedCommentContent> => {
  const uploadResult = await processMarkdownImageUploads({
    content: input.content,
    baseDir: input.baseDir,
    uploadFile: input.deps.uploadFile,
  });
  const uploadSummary = resolveUploadSummary(uploadResult.summary);
  if (hasMarkdownImageUploadFailure(uploadResult.summary)) {
    return {
      ok: false,
      failure: buildResult(
        "failed",
        buildMarkdownImageUploadFailureMessage(uploadResult.summary),
        { uploadSummary },
      ),
    };
  }
  const nextContent = uploadResult.content;
  const validation = validateComment(nextContent);
  if (!validation.valid) {
    return { ok: false, failure: buildResult("failed", validation.message ?? "Invalid comment.") };
  }
  return { ok: true, content: nextContent, uploads: uploadResult.uploads, uploadSummary };
};

const buildConflictResult = (input: {
  message: string;
  commentId: number;
  ticketId: number;
  localBody: string;
  remoteComment: Comment;
}): CommentSaveResult =>
  buildResult("conflict", input.message, {
    conflictContext: {
      commentId: input.commentId,
      ticketId: input.ticketId,
      localBody: input.localBody,
      remoteBody: input.remoteComment.body,
      remoteUpdatedAt: input.remoteComment.updatedAt,
    },
  });

const detectUpdatedAtConflict = async (input: {
  deps: CommentSaveDependencies;
  commentId: number;
  ticketId: number;
  lastKnownRemoteUpdatedAt: string;
  localBody: string;
}): Promise<CommentSaveResult | undefined> => {
  try {
    const detail = await input.deps.getIssueDetail(input.ticketId);
    const remoteComment = detail.comments.find((c) => c.id === input.commentId);
    if (remoteComment && remoteComment.updatedAt !== input.lastKnownRemoteUpdatedAt) {
      return buildConflictResult({
        message: "Remote changes detected. Refresh before saving.",
        commentId: input.commentId,
        ticketId: input.ticketId,
        localBody: input.localBody,
        remoteComment,
      });
    }
  } catch {
    // Fetch failure is non-fatal here — fall through to save attempt.
  }
  return undefined;
};

const enrichConflictWithRemote = async (input: {
  deps: CommentSaveDependencies;
  result: CommentSaveResult;
  commentId: number;
  ticketId: number;
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
        localBody: input.localBody,
        remoteComment,
      });
    }
  } catch {
    // Ignore enrichment failure; return original conflict result.
  }
  return input.result;
};

const fetchPersistedCommentInfo = async (
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

export const finalizeNewCommentDraftState = (input: {
  operationScope?: string;
  editor: vscode.TextEditor;
  ticketId: number;
  projectId: number;
  commentId: number;
}): void => {
  setEditorContentType(input.editor, "comment");
  setEditorProjectId(input.editor, input.projectId);
  setEditorCommentId(input.editor, input.commentId);
  ensureCommentEdit(
    input.commentId,
    input.ticketId,
    input.editor.document.getText(),
    undefined,
    input.operationScope,
  );
};

export const finalizeNewCommentDraftDocument = (input: {
  operationScope?: string;
  document: vscode.TextDocument;
  ticketId: number;
  projectId: number;
  commentId: number;
}): void => {
  registerCommentDocument(
    input.ticketId,
    input.commentId,
    input.document,
    input.projectId,
    input.operationScope,
  );
  ensureCommentEdit(
    input.commentId,
    input.ticketId,
    input.document.getText(),
    undefined,
    input.operationScope,
  );
};

export const syncCommentDraft = async (input: {
  operationScope?: string;
  commentId: number;
  content: string;
  editor?: vscode.TextEditor;
  documentUri?: vscode.Uri;
  deps?: Partial<CommentSaveDependencies>;
}): Promise<CommentSaveResult> => {
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
    addOfflineCommentUpdate({
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

  if (nextContent === edit.baseBody) {
    return buildResult("no_change", "No changes to save.", { uploadSummary });
  }

  if (edit.lastKnownRemoteUpdatedAt) {
    const conflict = await detectUpdatedAtConflict({
      deps,
      commentId: input.commentId,
      ticketId: edit.ticketId,
      lastKnownRemoteUpdatedAt: edit.lastKnownRemoteUpdatedAt,
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
    await deps.updateComment(input.commentId, nextContent);
  } catch (error) {
    return enrichConflictWithRemote({
      deps,
      result: mapErrorToResult(error),
      commentId: input.commentId,
      ticketId: edit.ticketId,
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
  if (getOfflineSyncMode() === "manual") {
    const validation = validateComment(input.content);
    if (!validation.valid) {
      return buildResult("failed", validation.message ?? "Invalid comment.");
    }
    const baseDir = resolveEditorBaseDir({ editor: input.editor, documentUri: input.documentUri });
    addOfflineCommentUpdate({
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

export const saveCommentDraftLocally = (
  editor: vscode.TextEditor,
  operationScope?: string,
): CommentSaveResult | undefined => {
  if (!isTicketEditor(editor)) { return undefined; }
  const contentType = getEditorContentType(editor);
  if (contentType !== "comment" && contentType !== "commentDraft") { return undefined; }
  const ticketId = getTicketIdForEditor(editor);
  if (!ticketId) { return undefined; }
  const body = editor.document.getText();
  setCommentDraft(ticketId, body, operationScope);
  const commentId = getCommentIdForEditor(editor);
  addOfflineCommentUpdate({
    ticketId,
    commentId,
    body,
    documentUri: editor.document.uri.toString(),
  }, operationScope);
  return buildResult("queued", vscode.l10n.t("Saved locally. Run a sync command to apply changes to Redmine."));
};

export const saveCommentDocumentLocally = (input: {
  operationScope?: string;
  ticketId: number;
  commentId?: number;
  content: string;
  documentUri: vscode.Uri;
}): CommentSaveResult => {
  addOfflineCommentUpdate({
    ticketId: input.ticketId,
    commentId: input.commentId,
    body: input.content,
    documentUri: input.documentUri.toString(),
  }, input.operationScope);
  return buildResult("queued", vscode.l10n.t("Saved locally. Run a sync command to apply changes to Redmine."));
};

export const handleCommentEditorSave = async (
  editor: vscode.TextEditor,
  _deps?: Partial<CommentSaveDependencies>,
  operationScope?: string,
): Promise<CommentSaveResult | undefined> => {
  return saveCommentDraftLocally(editor, operationScope);
};

const detectHashBasedConflict = async (input: {
  deps: CommentSaveDependencies;
  commentId: number;
  ticketId: number;
  sourceNotesHash: string;
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

const mapHashBasedUpdateError = (mapped: CommentSaveResult): CommentSaveResult => {
  if (mapped.status === "failed" && /405/.test(mapped.message)) {
    return buildResult("failed", vscode.l10n.t("This Redmine environment does not support updating comments via the Webview. Use the Redmine web interface to edit."));
  }
  if (mapped.status === "forbidden") {
    return buildResult("forbidden", vscode.l10n.t("You do not have permission to edit this comment. Check Redmine permission settings."));
  }
  if (mapped.status === "not_found") {
    return buildResult("not_found", vscode.l10n.t("Comment not found. It may have been deleted or changed in Redmine."));
  }
  return mapped;
};

const applyQueuedExistingComment = async (input: {
  operationScope?: string;
  deps: CommentSaveDependencies;
  update: OfflineCommentUpdate & { commentId: number };
  nextContent: string;
  uploads: UploadToken[];
  uploadSummary: ReturnType<typeof resolveUploadSummary>;
}): Promise<CommentSaveResult> => {
  const { deps, update, nextContent, uploads, uploadSummary } = input;

  if (update.baseBody && nextContent === update.baseBody) {
    return buildResult("no_change", "No changes to save.", { uploadSummary });
  }

  if (update.sourceNotesHash) {
    const conflict = await detectHashBasedConflict({
      deps,
      commentId: update.commentId,
      ticketId: update.ticketId,
      sourceNotesHash: update.sourceNotesHash,
      localBody: nextContent,
    });
    if (conflict) { return conflict; }
  } else if (update.lastKnownRemoteUpdatedAt) {
    const conflict = await detectUpdatedAtConflict({
      deps,
      commentId: update.commentId,
      ticketId: update.ticketId,
      lastKnownRemoteUpdatedAt: update.lastKnownRemoteUpdatedAt,
      localBody: nextContent,
    });
    if (conflict) { return conflict; }
  }

  try {
    await deps.updateComment(
      update.commentId,
      nextContent,
      uploads.length > 0 ? uploads : undefined,
    );
  } catch (error) {
    const mapped = mapErrorToResult(error);
    return update.sourceNotesHash ? mapHashBasedUpdateError(mapped) : mapped;
  }

  updateCommentEdit(
    update.commentId,
    nextContent,
    update.lastKnownRemoteUpdatedAt,
    input.operationScope,
  );
  return buildResult("success", "Comment updated.", { uploadSummary });
};

const applyQueuedNewComment = async (input: {
  deps: CommentSaveDependencies;
  ticketId: number;
  nextContent: string;
  uploads: UploadToken[];
  uploadSummary: ReturnType<typeof resolveUploadSummary>;
}): Promise<CommentSaveResult> => {
  const { deps, ticketId, nextContent, uploads, uploadSummary } = input;

  try {
    await deps.addComment(ticketId, nextContent, uploads.length > 0 ? uploads : undefined);
  } catch (error) {
    return mapErrorToResult(error);
  }

  const persisted = await fetchPersistedCommentInfo(deps, ticketId, nextContent);
  if (!persisted.ok) {
    return buildUnresolvedResult(persisted.message, { uploadSummary });
  }
  return buildResult("created", "Comment added.", {
    commentId: persisted.commentId,
    projectId: persisted.projectId,
    uploadSummary,
  });
};

export const applyQueuedCommentUpdate = async (input: {
  update: OfflineCommentUpdate;
  deps?: Partial<CommentSaveDependencies>;
  operationScope?: string;
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
    });
  }

  return applyQueuedNewComment({
    deps,
    ticketId: update.ticketId,
    nextContent,
    uploads,
    uploadSummary,
  });
};

export const reloadCommentEditor = async (input: {
  operationScope?: string;
  ticketId: number;
  commentId: number;
  editor: vscode.TextEditor;
  deps?: CommentReloadDependencies;
}): Promise<CommentSaveResult> => {
  const deps = input.deps ?? defaultReloadDeps;
  try {
    const detail = await deps.getIssueDetail(input.ticketId);
    const comment = detail.comments.find((entry) => entry.id === input.commentId);
    if (!comment) {
      return buildResult("not_found", "Comment not found in Redmine.");
    }

    await deps.applyEditorContent(input.editor, comment.body);
    updateCommentEdit(input.commentId, comment.body, undefined, input.operationScope);
    return buildResult("success", "Comment reloaded.");
  } catch (error) {
    return mapErrorToResult(error);
  }
};
