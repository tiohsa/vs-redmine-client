import * as vscode from "vscode";
import { addComment, updateComment } from "../redmine/comments";
import { getIssueDetail, updateIssue } from "../redmine/issues";
import { computeNotesHash } from "../utils/notesHash";
import { getCurrentUserId } from "../redmine/users";
import { Comment } from "../redmine/types";
import { validateComment } from "../utils/commentValidation";
import { uploadFileAttachment } from "../redmine/attachments";
import {
  buildMarkdownImageUploadFailureMessage,
  hasMarkdownImageUploadFailure,
  MarkdownImageUploadSummary,
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
import { UploadSummary } from "./saveUploadTypes";
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

const resolveUploadSummary = (
  summary: MarkdownImageUploadSummary,
): UploadSummary | undefined =>
  summary.permissionDenied || summary.failures.length > 0 ? summary : undefined;

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

export const finalizeNewCommentDraftState = (input: {
  editor: vscode.TextEditor;
  ticketId: number;
  projectId: number;
  commentId: number;
}): void => {
  setEditorContentType(input.editor, "comment");
  setEditorProjectId(input.editor, input.projectId);
  setEditorCommentId(input.editor, input.commentId);
  ensureCommentEdit(input.commentId, input.ticketId, input.editor.document.getText());
};

export const finalizeNewCommentDraftDocument = (input: {
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
  );
  ensureCommentEdit(input.commentId, input.ticketId, input.document.getText());
};

export const syncCommentDraft = async (input: {
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
    const edit = getCommentEdit(input.commentId);
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
    });
    updateCommentEdit(input.commentId, input.content, edit.lastKnownRemoteUpdatedAt);
    if (input.editor) {
      setEditorDisplaySource(input.editor, "saved");
    }
    return buildResult("queued", "Saved for offline sync.");
  }
  const deps = { ...defaultDeps, ...input.deps };
  const edit = getCommentEdit(input.commentId);
  if (!edit) {
    return buildResult("failed", "Missing comment edit state.");
  }

  const baseDir = resolveEditorBaseDir({ editor: input.editor, documentUri: input.documentUri });
  const uploadResult = await processMarkdownImageUploads({
    content: input.content,
    baseDir,
    uploadFile: deps.uploadFile,
  });
  const uploadSummary = resolveUploadSummary(uploadResult.summary);
  if (hasMarkdownImageUploadFailure(uploadResult.summary)) {
    return buildResult(
      "failed",
      buildMarkdownImageUploadFailureMessage(uploadResult.summary),
      { uploadSummary },
    );
  }
  const nextContent = uploadResult.content;

  const validation = validateComment(nextContent);
  if (!validation.valid) {
    return buildResult("failed", validation.message ?? "Invalid comment.");
  }

  if (nextContent === edit.baseBody) {
    return buildResult("no_change", "No changes to save.", { uploadSummary });
  }

  // Pre-save conflict detection: check if remote was updated since we loaded
  if (edit.lastKnownRemoteUpdatedAt) {
    try {
      const detail = await deps.getIssueDetail(edit.ticketId);
      const remoteComment = detail.comments.find((c) => c.id === input.commentId);
      if (remoteComment && remoteComment.updatedAt !== edit.lastKnownRemoteUpdatedAt) {
        return buildResult("conflict", "Remote changes detected. Refresh before saving.", {
          conflictContext: {
            commentId: input.commentId,
            ticketId: edit.ticketId,
            localBody: nextContent,
            remoteBody: remoteComment.body,
            remoteUpdatedAt: remoteComment.updatedAt,
          },
        });
      }
    } catch {
      // If we can't fetch remote, continue with save attempt
    }
  }

  try {
    // Redmine's journal update API doesn't support uploads.
    // We need to attach files to the issue first, then update the journal.
    if (uploadResult.uploads.length > 0) {
      await deps.updateIssue({
        issueId: edit.ticketId,
        fields: { uploads: uploadResult.uploads },
      });
    }
    await deps.updateComment(
      input.commentId,
      nextContent,
    );
  } catch (error) {
    const result = mapErrorToResult(error);
    // If conflict, try to fetch the remote comment for diff display
    if (result.status === "conflict") {
      try {
        const detail = await deps.getIssueDetail(edit.ticketId);
        const remoteComment = detail.comments.find((c) => c.id === input.commentId);
        if (remoteComment) {
          return buildResult("conflict", result.message, {
            conflictContext: {
              commentId: input.commentId,
              ticketId: edit.ticketId,
              localBody: nextContent,
              remoteBody: remoteComment.body,
              remoteUpdatedAt: remoteComment.updatedAt,
            },
          });
        }
      } catch {
        // Ignore fetch error, return original conflict result
      }
    }
    return result;
  }

  updateCommentEdit(input.commentId, nextContent);
  if (input.editor && nextContent !== input.content) {
    await applyEditorContent(input.editor, nextContent);
  }
  return buildResult("success", "Comment updated.", { uploadSummary });
};

export const syncNewCommentDraft = async (input: {
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
    });
    if (input.editor) {
      setEditorDisplaySource(input.editor, "saved");
    }
    return buildResult("queued", "Saved for offline sync.");
  }
  const deps = { ...defaultDeps, ...input.deps };
  const baseDir = resolveEditorBaseDir({ editor: input.editor, documentUri: input.documentUri });
  const uploadResult = await processMarkdownImageUploads({
    content: input.content,
    baseDir,
    uploadFile: deps.uploadFile,
  });
  const uploadSummary = resolveUploadSummary(uploadResult.summary);
  if (hasMarkdownImageUploadFailure(uploadResult.summary)) {
    return buildResult(
      "failed",
      buildMarkdownImageUploadFailureMessage(uploadResult.summary),
      { uploadSummary },
    );
  }
  const nextContent = uploadResult.content;

  const validation = validateComment(nextContent);
  if (!validation.valid) {
    return buildResult("failed", validation.message ?? "Invalid comment.");
  }

  try {
    await deps.addComment(
      input.ticketId,
      nextContent,
      uploadResult.uploads.length > 0 ? uploadResult.uploads : undefined,
    );
  } catch (error) {
    return mapErrorToResult(error);
  }

  let currentUserId: number | undefined;
  try {
    currentUserId = await deps.getCurrentUserId();
  } catch {
    currentUserId = undefined;
  }

  try {
    const detail = await deps.getIssueDetail(input.ticketId);
    const commentId = resolveCreatedCommentId(
      detail.comments,
      nextContent,
      currentUserId,
    );
    if (!commentId) {
      return buildUnresolvedResult(
        "Comment added, but the comment ID could not be resolved.",
        { uploadSummary },
      );
    }

    const projectId = detail.ticket.projectId;
    if (input.onCreated) {
      try {
        await input.onCreated({ commentId, projectId });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Rename failed.";
        return buildUnresolvedResult(`Comment added, but ${message}`, { uploadSummary });
      }
    }

    if (input.editor && nextContent !== input.content) {
      await applyEditorContent(input.editor, nextContent);
    }
    return buildResult("created", "Comment added.", {
      commentId,
      projectId,
      uploadSummary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve comment ID.";
    return buildUnresolvedResult(`Comment added, but ${message}`, { uploadSummary });
  }
};

export const saveCommentDraftLocally = (
  editor: vscode.TextEditor,
): CommentSaveResult | undefined => {
  if (!isTicketEditor(editor)) { return undefined; }
  const contentType = getEditorContentType(editor);
  if (contentType !== "comment" && contentType !== "commentDraft") { return undefined; }
  const ticketId = getTicketIdForEditor(editor);
  if (!ticketId) { return undefined; }
  const body = editor.document.getText();
  setCommentDraft(ticketId, body);
  const commentId = getCommentIdForEditor(editor);
  addOfflineCommentUpdate({
    ticketId,
    commentId,
    body,
    documentUri: editor.document.uri.toString(),
  });
  return buildResult("queued", "ローカルに保存しました。Redmine への反映には同期コマンドを実行してください。");
};

export const saveCommentDocumentLocally = (input: {
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
  });
  return buildResult("queued", "ローカルに保存しました。Redmine への反映には同期コマンドを実行してください。");
};

export const handleCommentEditorSave = async (
  editor: vscode.TextEditor,
  _deps?: Partial<CommentSaveDependencies>,
): Promise<CommentSaveResult | undefined> => {
  return saveCommentDraftLocally(editor);
};

export const applyQueuedCommentUpdate = async (input: {
  update: OfflineCommentUpdate;
  deps?: Partial<CommentSaveDependencies>;
}): Promise<CommentSaveResult> => {
  const deps = { ...defaultDeps, ...input.deps };
  const update = input.update;
  const uploadResult = await processMarkdownImageUploads({
    content: update.body,
    baseDir: update.baseDir,
    uploadFile: deps.uploadFile,
  });
  const uploadSummary = resolveUploadSummary(uploadResult.summary);
  if (hasMarkdownImageUploadFailure(uploadResult.summary)) {
    return buildResult(
      "failed",
      buildMarkdownImageUploadFailureMessage(uploadResult.summary),
      { uploadSummary },
    );
  }
  const nextContent = uploadResult.content;

  const validation = validateComment(nextContent);
  if (!validation.valid) {
    return buildResult("failed", validation.message ?? "Invalid comment.");
  }

  if (update.commentId) {
    if (update.baseBody && nextContent === update.baseBody) {
      return buildResult("no_change", "No changes to save.", { uploadSummary });
    }

    if (update.sourceNotesHash) {
      // hash ベースの競合検知: source_notes_hash と現在の Redmine 側 notes hash を比較する
      try {
        const detail = await deps.getIssueDetail(update.ticketId);
        const remoteComment = detail.comments.find((c) => c.id === update.commentId);
        if (!remoteComment) {
          return buildResult("not_found", "対象コメントが見つかりません。Redmine側で削除または変更された可能性があります。");
        }
        const remoteHash = computeNotesHash(remoteComment.body);
        if (remoteHash !== update.sourceNotesHash) {
          return buildResult("conflict", "Redmine側でコメントが更新されています。同期前に差分を確認してください。", {
            conflictContext: {
              commentId: update.commentId,
              ticketId: update.ticketId,
              localBody: nextContent,
              remoteBody: remoteComment.body,
              remoteUpdatedAt: remoteComment.updatedAt,
            },
          });
        }
      } catch (err) {
        const mapped = mapErrorToResult(err);
        if (mapped.status === "not_found") { return mapped; }
        // 取得エラーは無視して更新を試みる
      }
    } else if (update.lastKnownRemoteUpdatedAt) {
      try {
        const detail = await deps.getIssueDetail(update.ticketId);
        const remoteComment = detail.comments.find((c) => c.id === update.commentId);
        if (remoteComment && remoteComment.updatedAt !== update.lastKnownRemoteUpdatedAt) {
          return buildResult("conflict", "Remote changes detected. Refresh before saving.", {
            conflictContext: {
              commentId: update.commentId,
              ticketId: update.ticketId,
              localBody: nextContent,
              remoteBody: remoteComment.body,
              remoteUpdatedAt: remoteComment.updatedAt,
            },
          });
        }
      } catch {
        // Ignore fetch error, continue update attempt
      }
    }

    try {
      await deps.updateComment(
        update.commentId,
        nextContent,
        uploadResult.uploads.length > 0 ? uploadResult.uploads : undefined,
      );
    } catch (error) {
      const mapped = mapErrorToResult(error);
      if (update.sourceNotesHash) {
        // 405 は API 非対応として案内する
        if (mapped.status === "failed" && /405/.test(mapped.message)) {
          return buildResult("failed", "このRedmine環境では、Webviewから既存コメントを直接更新できません。Redmine標準画面で編集してください。");
        }
        if (mapped.status === "forbidden") {
          return buildResult("forbidden", "このコメントを編集する権限がありません。Redmineの権限設定を確認してください。");
        }
        if (mapped.status === "not_found") {
          return buildResult("not_found", "対象コメントが見つかりません。Redmine側で削除または変更された可能性があります。");
        }
      }
      return mapped;
    }

    updateCommentEdit(update.commentId, nextContent, update.lastKnownRemoteUpdatedAt);
    return buildResult("success", "Comment updated.", { uploadSummary });
  }

  try {
    await deps.addComment(
      update.ticketId,
      nextContent,
      uploadResult.uploads.length > 0 ? uploadResult.uploads : undefined,
    );
  } catch (error) {
    return mapErrorToResult(error);
  }

  let currentUserId: number | undefined;
  try {
    currentUserId = await deps.getCurrentUserId();
  } catch {
    currentUserId = undefined;
  }

  try {
    const detail = await deps.getIssueDetail(update.ticketId);
    const commentId = resolveCreatedCommentId(
      detail.comments,
      nextContent,
      currentUserId,
    );
    if (!commentId) {
      return buildUnresolvedResult(
        "Comment added, but the comment ID could not be resolved.",
        { uploadSummary },
      );
    }
    return buildResult("created", "Comment added.", {
      commentId,
      projectId: detail.ticket.projectId,
      uploadSummary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve comment ID.";
    return buildUnresolvedResult(`Comment added, but ${message}`, { uploadSummary });
  }
};

export const reloadCommentEditor = async (input: {
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
    updateCommentEdit(input.commentId, comment.body);
    return buildResult("success", "Comment reloaded.");
  } catch (error) {
    return mapErrorToResult(error);
  }
};
