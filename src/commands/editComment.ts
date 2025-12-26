import * as vscode from "vscode";
import { updateComment } from "../redmine/comments";
import { Comment } from "../redmine/types";
import { showError, showInfo } from "../utils/notifications";

export const editComment = async (comment: Comment): Promise<void> => {
  if (!comment.editableByCurrentUser) {
    showError("You can only edit your own comments.");
    return;
  }

  const updated = await vscode.window.showInputBox({
    prompt: "Edit comment",
    value: comment.body,
  });

  if (updated === undefined) {
    return;
  }

  try {
    await updateComment(comment.id, updated);
    showInfo("Comment updated successfully.");
  } catch (error) {
    showError((error as Error).message);
  }
};
