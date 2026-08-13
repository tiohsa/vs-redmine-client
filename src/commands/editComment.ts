import * as vscode from "vscode";
import { updateComment } from "../redmine/comments";
import { uploadFileAttachment } from "../redmine/attachments";
import { Comment } from "../redmine/types";
import { getCommentLimitGuidance, validateComment } from "../utils/commentValidation";
import { showError, showInfo } from "../utils/notifications";
import { clearCommentDraft, setCommentDraft } from "../views/commentDraftStore";
import {
  getConnectionScopeForEditor,
  getEditorContentType,
  getTicketIdForEditor,
} from "../views/ticketEditorRegistry";
import { resolveEditorBaseDir } from "../utils/editorBaseDir";
import {
  CONNECTION_SCOPE_MISMATCH_MESSAGE,
  getCurrentConnectionScope,
} from "../config/connectionScope";
import type { CommentSaveDependencies } from "../views/commentSaveSync";
import { commentSyncOutcomeMessage, queueAndSyncComment } from "../app/commentSyncService";

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
  commentSyncDeps?: Partial<CommentSaveDependencies>;
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
    deps.showError(vscode.l10n.t("You can only edit your own comments."));
    return;
  }

  const editor = deps.getActiveEditor();
  if (!editor) {
    deps.showError(vscode.l10n.t("No active editor found."));
    return;
  }

  const ticketId = deps.getTicketIdForEditor(editor);
  if (!ticketId || ticketId !== comment.ticketId) {
    deps.showError(vscode.l10n.t("Open the ticket editor before updating."));
    return;
  }
  if (deps.getEditorContentType(editor) !== "comment") {
    deps.showError(vscode.l10n.t("Open the comment editor before updating."));
    return;
  }

  const operationScope = getConnectionScopeForEditor(editor) ?? getCurrentConnectionScope();
  if (operationScope !== getCurrentConnectionScope()) {
    deps.showError(CONNECTION_SCOPE_MISMATCH_MESSAGE);
    return;
  }

  const updated = editor.document.getText();
  deps.setCommentDraft(ticketId, updated, operationScope);
  const validation = deps.validateComment(updated);
  if (!validation.valid) {
    deps.showError(validation.message ?? vscode.l10n.t("Invalid comment."));
    deps.showInfo(deps.getCommentLimitGuidance());
    return;
  }

  try {
    const outcome = await queueAndSyncComment({
      operation: {
        ticketId: comment.ticketId,
        commentId: comment.id,
        baseBody: comment.body,
        lastKnownRemoteUpdatedAt: comment.updatedAt ?? comment.createdAt,
        body: updated,
        baseDir: resolveEditorBaseDir({ editor }),
        documentUri: editor.document.uri.toString(),
      },
      connectionScope: operationScope,
      deps: {
        ...deps.commentSyncDeps,
        updateComment: deps.updateComment,
        uploadFile: deps.uploadFile,
      },
    });
    if (outcome.kind !== "completed" && outcome.kind !== "no_change") {
      deps.showError(commentSyncOutcomeMessage(outcome));
      return;
    }
    deps.showInfo(vscode.l10n.t("Comment updated successfully."));
    deps.clearCommentDraft(ticketId, operationScope);
  } catch (error) {
    deps.showError((error as Error).message);
  }
};
