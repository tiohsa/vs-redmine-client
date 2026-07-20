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
import {
  buildMarkdownImageUploadFailureMessage,
  hasMarkdownImageUploadFailure,
  processMarkdownImageUploads,
} from "../utils/markdownImageUpload";
import { resolveEditorBaseDir } from "../utils/editorBaseDir";
import {
  CONNECTION_SCOPE_MISMATCH_MESSAGE,
  getCurrentConnectionScope,
} from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";

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
  const uploadResult = await runWithConnectionScope(
    operationScope,
    () => processMarkdownImageUploads({
      content: text,
      baseDir: resolveEditorBaseDir({ editor }),
      uploadFile: deps.uploadFile,
    }),
  );
  if (hasMarkdownImageUploadFailure(uploadResult.summary)) {
    deps.showError(buildMarkdownImageUploadFailureMessage(uploadResult.summary));
    return;
  }
  const nextContent = uploadResult.content;
  const validation = deps.validateComment(nextContent);
  if (!validation.valid) {
    deps.showError(validation.message ?? vscode.l10n.t("Invalid comment."));
    deps.showInfo(deps.getCommentLimitGuidance());
    return;
  }

  try {
    await runWithConnectionScope(
      operationScope,
      () => deps.addComment(
        input.issueId,
        nextContent,
        uploadResult.uploads.length > 0 ? uploadResult.uploads : undefined,
      ),
    );
    deps.showInfo(vscode.l10n.t("Comment added."));
    deps.clearCommentDraft(ticketId, operationScope);
    await input.onSuccess?.();
  } catch (error) {
    deps.showError((error as Error).message);
  }
};
