import * as vscode from "vscode";
import { addComment } from "../redmine/comments";
import { uploadFileAttachment } from "../redmine/attachments";
import { validateComment, getCommentLimitGuidance } from "../utils/commentValidation";
import { showError, showInfo } from "../utils/notifications";
import { clearCommentDraft, getCommentDraft, setCommentDraft } from "../views/commentDraftStore";
import { resolveEditorBaseDir } from "../utils/editorBaseDir";
import { getCurrentConnectionScope } from "../config/connectionScope";
import type { CommentSaveDependencies } from "../views/commentSaveSync";
import { commentSyncOutcomeMessage, queueAndSyncComment } from "../app/commentSyncService";

export interface CommentPromptOptions {
  issueId: number;
  onSuccess?: () => void | Promise<void>;
}

export interface CommentPromptDependencies {
  showInputBox: typeof vscode.window.showInputBox;
  addComment: typeof addComment;
  uploadFile: typeof uploadFileAttachment;
  validateComment: typeof validateComment;
  getCommentLimitGuidance: typeof getCommentLimitGuidance;
  showError: typeof showError;
  showInfo: typeof showInfo;
  getCommentDraft: typeof getCommentDraft;
  setCommentDraft: typeof setCommentDraft;
  clearCommentDraft: typeof clearCommentDraft;
  resolveBaseDir: () => string | undefined;
  commentSyncDeps?: Partial<CommentSaveDependencies>;
}

const defaultDeps: CommentPromptDependencies = {
  showInputBox: vscode.window.showInputBox,
  addComment,
  uploadFile: uploadFileAttachment,
  validateComment,
  getCommentLimitGuidance,
  showError,
  showInfo,
  getCommentDraft,
  setCommentDraft,
  clearCommentDraft,
  resolveBaseDir: () => resolveEditorBaseDir(),
};

export const promptForComment = async (
  options: CommentPromptOptions,
  deps: CommentPromptDependencies = defaultDeps,
): Promise<void> => {
  let value = deps.getCommentDraft(options.issueId);

  while (true) {
    const input = await deps.showInputBox({
      prompt: "Add comment",
      value,
      placeHolder: deps.getCommentLimitGuidance(),
      ignoreFocusOut: true,
    });

    if (input === undefined) {
      return;
    }

    const validation = deps.validateComment(input);
    if (!validation.valid) {
      deps.showError(validation.message ?? vscode.l10n.t("Invalid comment."));
      value = input;
      deps.setCommentDraft(options.issueId, input);
      continue;
    }

    try {
      const operationScope = getCurrentConnectionScope();
      const outcome = await queueAndSyncComment({
        operation: {
          ticketId: options.issueId,
          body: input,
          baseDir: deps.resolveBaseDir(),
          documentUri: `redmine-comment-prompt:${options.issueId}`,
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
        value = input;
        deps.setCommentDraft(options.issueId, input);
        continue;
      }
      deps.showInfo(vscode.l10n.t("Comment added."));
      value = "";
      deps.clearCommentDraft(options.issueId);
      await options.onSuccess?.();
    } catch (error) {
      deps.showError((error as Error).message);
      value = input;
      deps.setCommentDraft(options.issueId, input);
    }
  }
};
