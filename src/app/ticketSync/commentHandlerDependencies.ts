import { getIssueDetail, updateIssue } from "../../redmine/issues";
import { addComment, updateComment } from "../../redmine/comments";
import { getCurrentUserId } from "../../redmine/users";
import { uploadFileAttachment } from "../../redmine/attachments";
import { type CommentSaveDependencies } from "../../views/commentSaveSync";

export const defaultCommentDeps: CommentSaveDependencies = {
  addComment,
  updateComment,
  updateIssue,
  getIssueDetail,
  getCurrentUserId,
  uploadFile: uploadFileAttachment,
};
