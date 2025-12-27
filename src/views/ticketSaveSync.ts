import * as vscode from "vscode";
import {
  getIssueDetail,
  listIssuePriorities,
  listIssueStatuses,
  listTrackers,
  updateIssue,
} from "../redmine/issues";
import { TicketUpdateFields } from "../redmine/types";
import {
  getTicketDraft,
  markDraftStatus,
  updateDraftAfterSave,
} from "./ticketDraftStore";
import { parseTicketEditorContent } from "./ticketEditorContent";
import { IssueMetadata } from "./ticketMetadataTypes";
import {
  getEditorContentType,
  getTicketIdForEditor,
  isTicketEditor,
} from "./ticketEditorRegistry";
import { TicketSaveResult } from "./ticketSaveTypes";
import { applyEditorContent, buildTicketPreviewContent } from "./ticketPreview";

export interface TicketSaveDependencies {
  getIssueDetail: typeof getIssueDetail;
  updateIssue: typeof updateIssue;
  listIssueStatuses: typeof listIssueStatuses;
  listTrackers: typeof listTrackers;
  listIssuePriorities: typeof listIssuePriorities;
}

const defaultDeps: TicketSaveDependencies = {
  getIssueDetail,
  updateIssue,
  listIssueStatuses,
  listTrackers,
  listIssuePriorities,
};

export interface TicketReloadDependencies {
  getIssueDetail: typeof getIssueDetail;
  applyEditorContent: typeof applyEditorContent;
}

const defaultReloadDeps: TicketReloadDependencies = {
  getIssueDetail,
  applyEditorContent,
};

const buildResult = (status: TicketSaveResult["status"], message: string): TicketSaveResult => ({
  status,
  message,
});

const mapErrorToResult = (error: unknown): TicketSaveResult => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  const match = message.match(/\((\d{3})\)/);
  const statusCode = match ? Number(match[1]) : undefined;

  if (statusCode === 409) {
    return buildResult("conflict", "Remote changes detected. Refresh before saving.");
  }
  if (statusCode === 404) {
    return buildResult("not_found", "Ticket not found in Redmine.");
  }
  if (statusCode === 403) {
    return buildResult("forbidden", "Access denied for this ticket.");
  }
  if (statusCode && statusCode >= 500) {
    return buildResult("unreachable", "Redmine is unreachable.");
  }

  return buildResult("failed", message);
};

const computeChanges = (
  baseSubject: string,
  baseDescription: string,
  subject: string,
  description: string,
): TicketUpdateFields => {
  const changes: TicketUpdateFields = {};
  if (subject !== baseSubject) {
    changes.subject = subject;
  }
  if (description !== baseDescription) {
    changes.description = description;
  }
  return changes;
};

const computeMetadataChanges = (
  baseMetadata: IssueMetadata,
  nextMetadata: IssueMetadata,
): Partial<IssueMetadata> => {
  const changes: Partial<IssueMetadata> = {};
  if (baseMetadata.tracker !== nextMetadata.tracker) {
    changes.tracker = nextMetadata.tracker;
  }
  if (baseMetadata.priority !== nextMetadata.priority) {
    changes.priority = nextMetadata.priority;
  }
  if (baseMetadata.status !== nextMetadata.status) {
    changes.status = nextMetadata.status;
  }
  if (baseMetadata.due_date !== nextMetadata.due_date) {
    changes.due_date = nextMetadata.due_date;
  }
  return changes;
};

const resolveMetadataUpdates = async (
  changes: Partial<IssueMetadata>,
  deps: TicketSaveDependencies,
): Promise<TicketUpdateFields> => {
  const updateFields: TicketUpdateFields = {};
  if (
    changes.tracker === undefined &&
    changes.priority === undefined &&
    changes.status === undefined &&
    changes.due_date === undefined
  ) {
    return updateFields;
  }

  const [statuses, trackers, priorities] = await Promise.all([
    deps.listIssueStatuses(),
    deps.listTrackers(),
    deps.listIssuePriorities(),
  ]);

  if (changes.status !== undefined) {
    const match = statuses.find((item) => item.name === changes.status);
    if (!match) {
      throw new Error(`Unknown status: ${changes.status}`);
    }
    updateFields.statusId = match.id;
  }

  if (changes.tracker !== undefined) {
    const match = trackers.find((item) => item.name === changes.tracker);
    if (!match) {
      throw new Error(`Unknown tracker: ${changes.tracker}`);
    }
    updateFields.trackerId = match.id;
  }

  if (changes.priority !== undefined) {
    const match = priorities.find((item) => item.name === changes.priority);
    if (!match) {
      throw new Error(`Unknown priority: ${changes.priority}`);
    }
    updateFields.priorityId = match.id;
  }

  if (changes.due_date !== undefined) {
    updateFields.dueDate = changes.due_date.length === 0 ? null : changes.due_date;
  }

  return updateFields;
};

export const syncTicketDraft = async (input: {
  ticketId: number;
  content: string;
  deps?: TicketSaveDependencies;
}): Promise<TicketSaveResult> => {
  const deps = input.deps ?? defaultDeps;
  const draft = getTicketDraft(input.ticketId);
  if (!draft) {
    return buildResult("failed", "Missing draft state for ticket.");
  }

  let parsed;
  try {
    parsed = parseTicketEditorContent(input.content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metadata.";
    return buildResult("failed", message);
  }

  const subject = parsed.subject || draft.baseSubject;
  const description = parsed.description;
  const metadata = parsed.metadata;
  const contentChanges = computeChanges(
    draft.baseSubject,
    draft.baseDescription,
    subject,
    description,
  );
  const metadataChanges = computeMetadataChanges(draft.baseMetadata, metadata);
  let metadataFields: TicketUpdateFields = {};
  try {
    metadataFields = await resolveMetadataUpdates(metadataChanges, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metadata.";
    return buildResult("failed", message);
  }
  const changes = { ...contentChanges, ...metadataFields };

  if (Object.keys(changes).length === 0) {
    return buildResult("no_change", "No changes to save.");
  }

  markDraftStatus(input.ticketId, "dirty");

  if (draft.lastKnownRemoteUpdatedAt) {
    try {
      const detail = await deps.getIssueDetail(input.ticketId);
      const remoteUpdatedAt = detail.ticket.updatedAt;
      if (remoteUpdatedAt && remoteUpdatedAt !== draft.lastKnownRemoteUpdatedAt) {
        markDraftStatus(input.ticketId, "conflict");
        return buildResult("conflict", "Remote changes detected. Refresh before saving.");
      }
    } catch (error) {
      const result = mapErrorToResult(error);
      if (result.status === "conflict") {
        markDraftStatus(input.ticketId, "conflict");
      }
      return result;
    }
  }

  try {
    await deps.updateIssue({ issueId: input.ticketId, fields: changes });
  } catch (error) {
    const result = mapErrorToResult(error);
    if (result.status === "conflict") {
      markDraftStatus(input.ticketId, "conflict");
    }
    return result;
  }

  let updatedAt = draft.lastKnownRemoteUpdatedAt;
  try {
    const detail = await deps.getIssueDetail(input.ticketId);
    updatedAt = detail.ticket.updatedAt ?? updatedAt;
  } catch {
    // Ignore refresh errors after successful update.
  }

  updateDraftAfterSave(input.ticketId, subject, description, metadata, updatedAt);
  return buildResult("success", "Redmine updated.");
};

export const reloadTicketEditor = async (input: {
  ticketId: number;
  editor: vscode.TextEditor;
  deps?: TicketReloadDependencies;
}): Promise<TicketSaveResult> => {
  const deps = input.deps ?? defaultReloadDeps;
  try {
    const detail = await deps.getIssueDetail(input.ticketId);
    const content = buildTicketPreviewContent(detail.ticket);
    await deps.applyEditorContent(input.editor, content);
    const metadata = {
      tracker: detail.ticket.trackerName ?? "",
      priority: detail.ticket.priorityName ?? "",
      status: detail.ticket.statusName ?? "",
      due_date: detail.ticket.dueDate ?? "",
    };
    updateDraftAfterSave(
      input.ticketId,
      detail.ticket.subject,
      detail.ticket.description ?? "",
      metadata,
      detail.ticket.updatedAt,
    );
    return buildResult("success", "Reloaded from Redmine.");
  } catch (error) {
    return mapErrorToResult(error);
  }
};

export const handleTicketEditorSave = async (
  editor: vscode.TextEditor,
): Promise<TicketSaveResult | undefined> => {
  if (!isTicketEditor(editor)) {
    return undefined;
  }

  if (getEditorContentType(editor) !== "ticket") {
    return undefined;
  }

  const ticketId = getTicketIdForEditor(editor);
  if (!ticketId) {
    return undefined;
  }

  return syncTicketDraft({
    ticketId,
    content: editor.document.getText(),
  });
};
