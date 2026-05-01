import { createIssue, deleteIssue, getIssueDetail, listIssuePriorities, listIssueStatuses, listTrackers } from "../../redmine/issues";
import { getProjectTrackers } from "../../redmine/projects";
import { uploadFileAttachment } from "../../redmine/attachments";
import { searchUsers } from "../../redmine/users";
import { applyEditorContent } from "../ticketPreview";

export interface TicketSaveDependencies {
  getIssueDetail: typeof getIssueDetail;
  updateIssue: typeof import("../../redmine/issues").updateIssue;
  createIssue: typeof createIssue;
  deleteIssue: typeof deleteIssue;
  listIssueStatuses: typeof listIssueStatuses;
  listTrackers: typeof listTrackers;
  listIssuePriorities: typeof listIssuePriorities;
  searchUsers: typeof searchUsers;
  uploadFile: typeof uploadFileAttachment;
  getProjectTrackers?: typeof getProjectTrackers;
}

export interface TicketCreateDependencies {
  createIssue: typeof createIssue;
  deleteIssue: typeof deleteIssue;
  listIssueStatuses: typeof listIssueStatuses;
  listTrackers: typeof listTrackers;
  listIssuePriorities: typeof listIssuePriorities;
  searchUsers: typeof searchUsers;
  uploadFile: typeof uploadFileAttachment;
  getProjectTrackers?: typeof getProjectTrackers;
}

export interface TicketReloadDependencies {
  getIssueDetail: typeof getIssueDetail;
  applyEditorContent: typeof applyEditorContent;
}
