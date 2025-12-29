import * as vscode from "vscode";
import { addComment, listComments, updateComment } from "../redmine/comments";
import { getIssueDetail } from "../redmine/issues";
import { getCurrentUserId } from "../redmine/users";
import { validateComment } from "../utils/commentValidation";
import {
  getEditorContentType,
  getCommentIdForEditor,
  getTicketIdForEditor,
  isTicketEditor,
  setEditorCommentId,
  setEditorContentType,
} from "./ticketEditorRegistry";
import { ensureCommentEdit, getCommentEdit, updateCommentEdit } from "./commentEditStore";
import { CommentSaveResult } from "./commentSaveTypes";
import { applyEditorContent } from "./ticketPreview";

export interface CommentSaveDependencies {
  addComment: typeof addComment;
  updateComment: typeof updateComment;
}

const defaultDeps: CommentSaveDependencies = {
  addComment,
  updateComment,
};

export interface CommentCreateDependencies extends CommentSaveDependencies {
  listComments: typeof listComments;
  getCurrentUserId: typeof getCurrentUserId;
}

const defaultCreateDeps: CommentCreateDependencies = {
  addComment,
  updateComment,
  listComments,
  getCurrentUserId,
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
  commentId?: number,
): CommentSaveResult => ({
  status,
  message,
  commentId,
});

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

export const syncCommentDraft = async (input: {
  commentId: number;
  content: string;
  deps?: CommentSaveDependencies;
}): Promise<CommentSaveResult> => {
  const deps = input.deps ?? defaultDeps;
  const edit = getCommentEdit(input.commentId);
  if (!edit) {
    return buildResult("failed", "Missing comment edit state.");
  }

  const validation = validateComment(input.content);
  if (!validation.valid) {
    return buildResult("failed", validation.message ?? "Invalid comment.");
  }

  if (input.content === edit.baseBody) {
    return buildResult("no_change", "No changes to save.");
  }

  try {
    await deps.updateComment(input.commentId, input.content);
  } catch (error) {
    return mapErrorToResult(error);
  }

  updateCommentEdit(input.commentId, input.content);
  return buildResult("success", "Comment updated.");
};

export const syncNewCommentDraft = async (input: {
  ticketId: number;
  content: string;
  deps?: Partial<CommentCreateDependencies>;
}): Promise<CommentSaveResult> => {
  const deps = { ...defaultCreateDeps, ...input.deps };
  const validation = validateComment(input.content);
  if (!validation.valid) {
    return buildResult("failed", validation.message ?? "Invalid comment.");
  }

  try {
    await deps.addComment(input.ticketId, input.content);
  } catch (error) {
    return mapErrorToResult(error);
  }

  const commentId = await resolveCreatedCommentId({
    ticketId: input.ticketId,
    content: input.content,
    deps,
  });

  return buildResult("created", "Comment added.", commentId);
};

export const handleCommentEditorSave = async (
  editor: vscode.TextEditor,
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

    const result = await syncNewCommentDraft({
      ticketId,
      content: editor.document.getText(),
    });
    if (result.status === "created" && result.commentId) {
      setEditorContentType(editor, "comment");
      setEditorCommentId(editor, result.commentId);
      ensureCommentEdit(result.commentId, ticketId, editor.document.getText());
    }
    return result;
  }

  const commentId = getCommentIdForEditor(editor);
  if (!commentId) {
    return undefined;
  }

  return syncCommentDraft({
    commentId,
    content: editor.document.getText(),
  });
};

const resolveCreatedCommentId = async (input: {
  ticketId: number;
  content: string;
  deps: CommentCreateDependencies;
}): Promise<number | undefined> => {
  try {
    const currentUserId = await input.deps.getCurrentUserId();
    const normalizedBody = input.content.trim();
    const comments = await input.deps.listComments(input.ticketId, currentUserId);
    const matches = comments.filter(
      (comment) =>
        comment.authorId === currentUserId &&
        comment.body.trim() === normalizedBody,
    );
    if (matches.length === 0) {
      return undefined;
    }

    const latest = matches.reduce((prev, next) => {
      const prevTime = Date.parse(prev.updatedAt ?? prev.createdAt ?? "") || 0;
      const nextTime = Date.parse(next.updatedAt ?? next.createdAt ?? "") || 0;
      if (nextTime > prevTime) {
        return next;
      }
      return prev;
    });

    return latest.id;
  } catch {
    return undefined;
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
