import * as vscode from "vscode";
import { addComment } from "../redmine/comments";
import { validateComment, getCommentLimitGuidance } from "../utils/commentValidation";
import { showError, showInfo } from "../utils/notifications";

export interface CommentPromptOptions {
  issueId: number;
  onSuccess?: () => void | Promise<void>;
}

export const promptForComment = async (options: CommentPromptOptions): Promise<void> => {
  let value = "";

  while (true) {
    const input = await vscode.window.showInputBox({
      prompt: "Add comment",
      value,
      placeHolder: getCommentLimitGuidance(),
      ignoreFocusOut: true,
    });

    if (input === undefined) {
      return;
    }

    const validation = validateComment(input);
    if (!validation.valid) {
      showError(validation.message ?? "Invalid comment.");
      value = input;
      continue;
    }

    try {
      await addComment(options.issueId, input);
      showInfo("Comment added.");
      value = "";
      await options.onSuccess?.();
    } catch (error) {
      showError((error as Error).message);
      value = input;
    }
  }
};
