import * as vscode from "vscode";
import { updateComment } from "../redmine/comments";
import { uploadFileAttachment } from "../redmine/attachments";
import { Comment } from "../redmine/types";
import { getCommentLimitGuidance, validateComment } from "../utils/commentValidation";
import { showError, showInfo } from "../utils/notifications";
import { clearCommentDraft, setCommentDraft } from "../views/commentDraftStore";
import { getEditorContentType, getTicketIdForEditor } from "../views/ticketEditorRegistry";
import {
  buildMarkdownImageUploadFailureMessage,
  hasMarkdownImageUploadFailure,
  processMarkdownImageUploads,
} from "../utils/markdownImageUpload";
import { resolveEditorBaseDir } from "../utils/editorBaseDir";

export interface EditCommentDependencies {
  getActiveEditor: () => vscode.TextEditor | undefined;
  updateComment: typeof updateComment;
  uploadFile: typeof uploadFileAttachment;
  showError: typeof showError;
  showInfo: typeof showInfo;
  validateComment: typeof validateComment;
  getCommentLimitGuidance: typeof getCommentLimitGuidance;
  setCommentDraft: typeof setCommentDraft;
  clearCommentDraft: typeof clearCommentDraft;
  getTicketIdForEditor: typeof getTicketIdForEditor;
  getEditorContentType: typeof getEditorContentType;
}

const defaultDeps: EditCommentDependencies = {
  getActiveEditor: () => vscode.window.activeTextEditor,
  updateComment,
  uploadFile: uploadFileAttachment,
  showError,
  showInfo,
  validateComment,
  getCommentLimitGuidance,
  setCommentDraft,
  clearCommentDraft,
  getTicketIdForEditor,
  getEditorContentType,
};

export const editComment = async (
  comment: Comment,
  deps: EditCommentDependencies = defaultDeps,
): Promise<void> => {
  if (!comment.editableByCurrentUser) {
    deps.showError("You can only edit your own comments.");
    return;
  }

  const editor = deps.getActiveEditor();
  if (!editor) {
    deps.showError("No active editor found.");
    return;
  }

  const ticketId = deps.getTicketIdForEditor(editor);
  if (!ticketId || ticketId !== comment.ticketId) {
    deps.showError("Open the ticket editor before updating.");
    return;
  }
  if (deps.getEditorContentType(editor) !== "comment") {
    deps.showError("Open the comment editor before updating.");
    return;
  }

  const updated = editor.document.getText();
  deps.setCommentDraft(ticketId, updated);
  const uploadResult = await processMarkdownImageUploads({
    content: updated,
    baseDir: resolveEditorBaseDir({ editor }),
    uploadFile: deps.uploadFile,
  });
  if (hasMarkdownImageUploadFailure(uploadResult.summary)) {
    deps.showError(buildMarkdownImageUploadFailureMessage(uploadResult.summary));
    return;
  }
  const nextContent = uploadResult.content;
  const validation = deps.validateComment(nextContent);
  if (!validation.valid) {
    deps.showError(validation.message ?? "Invalid comment.");
    deps.showInfo(deps.getCommentLimitGuidance());
    return;
  }

  try {
    await deps.updateComment(
      comment.id,
      nextContent,
      uploadResult.uploads.length > 0 ? uploadResult.uploads : undefined,
    );
    deps.showInfo("Comment updated successfully.");
    deps.clearCommentDraft(ticketId);
  } catch (error) {
    deps.showError((error as Error).message);
  }
};
