import * as vscode from "vscode";
import { addComment } from "../redmine/comments";
import { getCommentLimitGuidance, validateComment } from "../utils/commentValidation";
import { showError, showInfo } from "../utils/notifications";

export interface AddCommentInput {
  issueId: number;
  onSuccess?: () => void | Promise<void>;
}

export const addCommentForIssue = async (input: AddCommentInput): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    showError("No active editor found.");
    return;
  }

  const text = editor.document.getText();
  const validation = validateComment(text);
  if (!validation.valid) {
    showError(validation.message ?? "Invalid comment.");
    showInfo(getCommentLimitGuidance());
    return;
  }

  try {
    await addComment(input.issueId, text);
    showInfo("Comment added.");
    await input.onSuccess?.();
  } catch (error) {
    showError((error as Error).message);
  }
};
