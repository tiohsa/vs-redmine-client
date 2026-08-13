import * as vscode from "vscode";
import { addComment } from "../redmine/comments";
import { uploadFileAttachment } from "../redmine/attachments";
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

export interface AddCommentInput {
  issueId: number;
  onSuccess?: () => void | Promise<void>;
}

export interface AddCommentDependencies {
  getActiveEditor: () => vscode.TextEditor | undefined;
  addComment: typeof addComment;
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

const defaultDeps: AddCommentDependencies = {
  getActiveEditor: () => vscode.window.activeTextEditor,
  addComment,
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

export const addCommentForIssue = async (
  input: AddCommentInput,
  deps: AddCommentDependencies = defaultDeps,
): Promise<void> => {
  const editor = deps.getActiveEditor();
  if (!editor) {
    deps.showError(vscode.l10n.t("No active editor found."));
    return;
  }

  const ticketId = deps.getTicketIdForEditor(editor);
  if (!ticketId || ticketId !== input.issueId) {
    deps.showError(vscode.l10n.t("Open the ticket editor before adding a comment."));
    return;
  }
  if (deps.getEditorContentType(editor) !== "comment") {
    deps.showError(vscode.l10n.t("Open the comment editor before adding a comment."));
    return;
  }

  const operationScope = getConnectionScopeForEditor(editor) ?? getCurrentConnectionScope();
  if (operationScope !== getCurrentConnectionScope()) {
    deps.showError(CONNECTION_SCOPE_MISMATCH_MESSAGE);
    return;
  }

  const text = editor.document.getText();
  deps.setCommentDraft(ticketId, text, operationScope);
  const validation = deps.validateComment(text);
  if (!validation.valid) {
    deps.showError(validation.message ?? vscode.l10n.t("Invalid comment."));
    deps.showInfo(deps.getCommentLimitGuidance());
    return;
  }

  try {
    const outcome = await queueAndSyncComment({
      operation: {
        ticketId: input.issueId,
        body: text,
        baseDir: resolveEditorBaseDir({ editor }),
        documentUri: editor.document.uri.toString(),
      },
      connectionScope: operationScope,
      deps: {
        ...deps.commentSyncDeps,
        addComment: deps.addComment,
        uploadFile: deps.uploadFile,
      },
    });
    if (outcome.kind !== "completed") {
      deps.showError(commentSyncOutcomeMessage(outcome));
      return;
    }
    deps.showInfo(vscode.l10n.t("Comment added."));
    deps.clearCommentDraft(ticketId, operationScope);
    await input.onSuccess?.();
  } catch (error) {
    deps.showError((error as Error).message);
  }
};
