import * as vscode from "vscode";
import { addComment } from "../redmine/comments";
import { uploadFileAttachment } from "../redmine/attachments";
import { validateComment, getCommentLimitGuidance } from "../utils/commentValidation";
import { showError, showInfo } from "../utils/notifications";
import { clearCommentDraft, getCommentDraft, setCommentDraft } from "../views/commentDraftStore";
import {
  buildMarkdownImageUploadFailureMessage,
  hasMarkdownImageUploadFailure,
  processMarkdownImageUploads,
} from "../utils/markdownImageUpload";
import { resolveEditorBaseDir } from "../utils/editorBaseDir";

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

    const uploadResult = await processMarkdownImageUploads({
      content: input,
      baseDir: deps.resolveBaseDir(),
      uploadFile: deps.uploadFile,
    });
    if (hasMarkdownImageUploadFailure(uploadResult.summary)) {
      deps.showError(buildMarkdownImageUploadFailureMessage(uploadResult.summary));
      value = input;
      deps.setCommentDraft(options.issueId, input);
      continue;
    }

    const nextContent = uploadResult.content;
    const validation = deps.validateComment(nextContent);
    if (!validation.valid) {
      deps.showError(validation.message ?? "Invalid comment.");
      value = input;
      deps.setCommentDraft(options.issueId, input);
      continue;
    }

    try {
      await deps.addComment(
        options.issueId,
        nextContent,
        uploadResult.uploads.length > 0 ? uploadResult.uploads : undefined,
      );
      deps.showInfo("Comment added.");
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
