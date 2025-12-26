import * as vscode from "vscode";
import { updateComment } from "../redmine/comments";
import { validateComment } from "../utils/commentValidation";
import {
  getEditorContentType,
  getCommentIdForEditor,
  isTicketEditor,
} from "./ticketEditorRegistry";
import { getCommentEdit, updateCommentEdit } from "./commentEditStore";
import { CommentSaveResult } from "./commentSaveTypes";

export interface CommentSaveDependencies {
  updateComment: typeof updateComment;
}

const defaultDeps: CommentSaveDependencies = {
  updateComment,
};

const buildResult = (status: CommentSaveResult["status"], message: string): CommentSaveResult => ({
  status,
  message,
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

export const handleCommentEditorSave = async (
  editor: vscode.TextEditor,
): Promise<CommentSaveResult | undefined> => {
  if (!isTicketEditor(editor)) {
    return undefined;
  }

  if (getEditorContentType(editor) !== "comment") {
    return undefined;
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
