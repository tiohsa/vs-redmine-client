import { uploadFileAttachment } from "../../redmine/attachments";
import {
  createIssue,
  deleteIssue,
  getIssueDetail,
  listIssuePriorities,
  listIssueStatuses,
  listTrackers,
  updateIssue,
} from "../../redmine/issues";
import { getProjectTrackers } from "../../redmine/projects";
import { searchUsers } from "../../redmine/users";
import { applyEditorContent } from "../ticketPreview";
import type { TicketCreateDependencies, TicketReloadDependencies, TicketSaveDependencies } from "./types";

export const defaultDeps: TicketSaveDependencies = {
  getIssueDetail,
  updateIssue,
  createIssue,
  deleteIssue,
  listIssueStatuses,
  listTrackers,
  listIssuePriorities,
  searchUsers,
  uploadFile: uploadFileAttachment,
  getProjectTrackers,
};

export const defaultCreateDeps: TicketCreateDependencies = {
  createIssue,
  deleteIssue,
  listIssueStatuses,
  listTrackers,
  listIssuePriorities,
  searchUsers,
  uploadFile: uploadFileAttachment,
  getProjectTrackers,
};

export const defaultReloadDeps: TicketReloadDependencies = {
  getIssueDetail,
  applyEditorContent,
};
