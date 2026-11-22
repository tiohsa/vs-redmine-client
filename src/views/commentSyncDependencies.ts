import { addComment, updateComment } from "../redmine/comments";
import { getIssueDetail, updateIssue } from "../redmine/issues";
import { getCurrentUserId } from "../redmine/users";
import { uploadFileAttachment } from "../redmine/attachments";

export interface CommentSaveDependencies {
  addComment: typeof addComment;
  updateComment: typeof updateComment;
  updateIssue: typeof updateIssue;
  getIssueDetail: typeof getIssueDetail;
  getCurrentUserId: typeof getCurrentUserId;
  uploadFile: typeof uploadFileAttachment;
}

export const defaultCommentSaveDeps: CommentSaveDependencies = {
  addComment,
  updateComment,
  updateIssue,
  getIssueDetail,
  getCurrentUserId,
  uploadFile: uploadFileAttachment,
};
