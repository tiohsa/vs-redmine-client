import * as vscode from "vscode";
import { addComment, updateComment } from "../redmine/comments";
import { getIssueDetail, updateIssue } from "../redmine/issues";
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
  getEditorContentType,
  getCommentIdForEditor,
  getTicketIdForEditor,
  isTicketEditor,
  registerCommentDocument,
  setEditorCommentId,
  setEditorContentType,
  setEditorProjectId,
} from "./ticketEditorRegistry";
import { ensureCommentEdit, getCommentEdit, updateCommentEdit } from "./commentEditStore";
import { CommentSaveResult } from "./commentSaveTypes";
import { applyEditorContent } from "./ticketPreview";
import { UploadSummary } from "./saveUploadTypes";

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
  const deps = { ...defaultDeps, ...input.deps };
  const edit = getCommentEdit(input.commentId);
  if (!edit) {
    return buildResult("failed", "Missing comment edit state.");
  }

  const baseDir = resolveEditorBaseDir({ editor: input.editor, documentUri: input.documentUri });
  console.log('[DEBUG syncCommentDraft] baseDir:', baseDir);
  console.log('[DEBUG syncCommentDraft] content:', input.content);
  const uploadResult = await processMarkdownImageUploads({
    content: input.content,
    baseDir,
    uploadFile: deps.uploadFile,
  });
  console.log('[DEBUG syncCommentDraft] uploadResult:', JSON.stringify(uploadResult, null, 2));
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

  try {
    // Redmine's journal update API doesn't support uploads.
    // We need to attach files to the issue first, then update the journal.
    if (uploadResult.uploads.length > 0) {
      console.log('[DEBUG syncCommentDraft] Attaching uploads to issue:', edit.ticketId);
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
    return mapErrorToResult(error);
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
  const deps = { ...defaultDeps, ...input.deps };
  const baseDir = resolveEditorBaseDir({ editor: input.editor, documentUri: input.documentUri });
  console.log('[DEBUG syncNewCommentDraft] baseDir:', baseDir);
  console.log('[DEBUG syncNewCommentDraft] content:', input.content);
  const uploadResult = await processMarkdownImageUploads({
    content: input.content,
    baseDir,
    uploadFile: deps.uploadFile,
  });
  console.log('[DEBUG syncNewCommentDraft] uploadResult:', JSON.stringify(uploadResult, null, 2));
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

export const handleCommentEditorSave = async (
  editor: vscode.TextEditor,
  deps?: Partial<CommentSaveDependencies>,
): Promise<CommentSaveResult | undefined> => {
  if (!isTicketEditor(editor)) {
    return undefined;
  }

  const contentType = getEditorContentType(editor);
  if (contentType !== "comment" && contentType !== "commentDraft") {
    return undefined;
  }

  if (contentType === "commentDraft") {
    const ticketId = getTicketIdForEditor(editor);
    if (!ticketId) {
      return undefined;
    }

    return syncNewCommentDraft({
      ticketId,
      content: editor.document.getText(),
      editor,
      deps,
      onCreated: async ({ commentId, projectId }) => {
        finalizeNewCommentDraftState({
          editor,
          ticketId,
          projectId,
          commentId,
        });
      },
    });
  }

  const commentId = getCommentIdForEditor(editor);
  if (!commentId) {
    return undefined;
  }

  return syncCommentDraft({
    commentId,
    content: editor.document.getText(),
    editor,
    deps,
  });
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
