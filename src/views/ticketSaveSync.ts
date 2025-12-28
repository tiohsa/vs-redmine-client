import * as vscode from "vscode";
import { getDefaultProjectId } from "../config/settings";
import { getProjectSelection } from "../config/projectSelection";
import {
  createIssue,
  deleteIssue,
  getIssueDetail,
  IssueDetailResult,
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
import { buildTicketEditorContent, parseTicketEditorContent } from "./ticketEditorContent";
import { IssueMetadata } from "./ticketMetadataTypes";
import {
  getEditorContentType,
  getProjectIdForEditor,
  getTicketIdForEditor,
  isTicketEditor,
  NEW_TICKET_DRAFT_ID,
  registerTicketEditor,
  removeTicketEditorByDocument,
  setEditorDisplaySource,
} from "./ticketEditorRegistry";
import { TicketEditorContent } from "./ticketEditorContent";
import { TicketSaveResult } from "./ticketSaveTypes";
import { applyEditorContent, buildTicketPreviewContent } from "./ticketPreview";

export interface TicketSaveDependencies {
  getIssueDetail: typeof getIssueDetail;
  updateIssue: typeof updateIssue;
  createIssue: typeof createIssue;
  deleteIssue: typeof deleteIssue;
  listIssueStatuses: typeof listIssueStatuses;
  listTrackers: typeof listTrackers;
  listIssuePriorities: typeof listIssuePriorities;
}

const defaultDeps: TicketSaveDependencies = {
  getIssueDetail,
  updateIssue,
  createIssue,
  deleteIssue,
  listIssueStatuses,
  listTrackers,
  listIssuePriorities,
};

export interface TicketCreateDependencies {
  createIssue: typeof createIssue;
  deleteIssue: typeof deleteIssue;
  listIssueStatuses: typeof listIssueStatuses;
  listTrackers: typeof listTrackers;
  listIssuePriorities: typeof listIssuePriorities;
}

const defaultCreateDeps: TicketCreateDependencies = {
  createIssue,
  deleteIssue,
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

const resolveProjectIdForCreate = (projectId?: number): number | undefined => {
  if (projectId) {
    return projectId;
  }
  const selection = getProjectSelection();
  if (selection.id) {
    return selection.id;
  }

  const fallback = Number(getDefaultProjectId());
  return Number.isNaN(fallback) ? undefined : fallback;
};

const resolveProjectIdForEditor = (editor: vscode.TextEditor): number | undefined =>
  resolveProjectIdForCreate(getProjectIdForEditor(editor));

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

const resolveMetadataForCreate = async (
  metadata: IssueMetadata,
  deps: TicketCreateDependencies,
): Promise<TicketUpdateFields> => {
  const [statuses, trackers, priorities] = await Promise.all([
    deps.listIssueStatuses(),
    deps.listTrackers(),
    deps.listIssuePriorities(),
  ]);

  const statusMatch = statuses.find((item) => item.name === metadata.status);
  if (!statusMatch) {
    throw new Error(`Unknown status: ${metadata.status}`);
  }

  const trackerMatch = trackers.find((item) => item.name === metadata.tracker);
  if (!trackerMatch) {
    throw new Error(`Unknown tracker: ${metadata.tracker}`);
  }

  const priorityMatch = priorities.find((item) => item.name === metadata.priority);
  if (!priorityMatch) {
    throw new Error(`Unknown priority: ${metadata.priority}`);
  }

  const fields: TicketUpdateFields = {
    statusId: statusMatch.id,
    trackerId: trackerMatch.id,
    priorityId: priorityMatch.id,
  };

  if (metadata.due_date.length > 0) {
    fields.dueDate = metadata.due_date;
  }

  return fields;
};

export const syncTicketDraft = async (input: {
  ticketId: number;
  content: string;
  editor?: vscode.TextEditor;
  deps?: TicketSaveDependencies;
}): Promise<TicketSaveResult> => {
  const deps = input.deps ?? defaultDeps;
  const draft = getTicketDraft(input.ticketId);
  if (!draft) {
    return buildResult("failed", "Missing draft state for ticket.");
  }

  let parsed;
  try {
    parsed = parseTicketEditorContent(input.content, {
      allowMissingMetadata: true,
      fallbackMetadata: draft.baseMetadata,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metadata.";
    return buildResult("failed", message);
  }

  const subject = parsed.subject || draft.baseSubject;
  const description = parsed.description;
  const metadata = parsed.metadata;
  const children = metadata.children ?? [];
  const uniqueChildren: string[] = [];
  const duplicateChildren: string[] = [];
  const seenChildren = new Set<string>();
  children.forEach((child) => {
    if (seenChildren.has(child)) {
      duplicateChildren.push(child);
    } else {
      seenChildren.add(child);
      uniqueChildren.push(child);
    }
  });
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

  if (Object.keys(changes).length === 0 && children.length === 0) {
    return buildResult("no_change", "No changes to save.");
  }

  markDraftStatus(input.ticketId, "dirty");
  let remoteDetail: IssueDetailResult | undefined;

  if (draft.lastKnownRemoteUpdatedAt) {
    try {
      remoteDetail = await deps.getIssueDetail(input.ticketId);
      const remoteUpdatedAt = remoteDetail.ticket.updatedAt;
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

  const createdChildIds: number[] = [];
  let childCreateFields: TicketUpdateFields | undefined;
  if (uniqueChildren.length > 0) {
    try {
      childCreateFields = await resolveMetadataForCreate(metadata, deps);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid metadata.";
      return buildResult("failed", message);
    }

    let projectId = remoteDetail?.ticket.projectId;
    if (!projectId) {
      try {
        remoteDetail = await deps.getIssueDetail(input.ticketId);
        projectId = remoteDetail.ticket.projectId;
      } catch (error) {
        return mapErrorToResult(error);
      }
    }
    if (!projectId) {
      return buildResult("failed", "Missing project ID for child tickets.");
    }

    try {
      for (const childSubject of uniqueChildren) {
        const childId = await deps.createIssue({
          projectId,
          subject: childSubject,
          description: "",
          statusId: childCreateFields.statusId,
          trackerId: childCreateFields.trackerId,
          priorityId: childCreateFields.priorityId,
          dueDate:
            typeof childCreateFields.dueDate === "string"
              ? childCreateFields.dueDate
              : undefined,
          parentId: input.ticketId,
        });
        if (!childId) {
          throw new Error("Child ticket creation failed.");
        }
        createdChildIds.push(childId);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Child ticket creation failed.";
      await Promise.allSettled(
        createdChildIds.map((issueId) => deps.deleteIssue(issueId)),
      );
      return buildResult("failed", message);
    }
  }

  try {
    if (Object.keys(changes).length > 0) {
      await deps.updateIssue({ issueId: input.ticketId, fields: changes });
    }
  } catch (error) {
    if (createdChildIds.length > 0) {
      await Promise.allSettled(
        createdChildIds.map((issueId) => deps.deleteIssue(issueId)),
      );
    }
    const result = mapErrorToResult(error);
    if (result.status === "conflict") {
      markDraftStatus(input.ticketId, "conflict");
    }
    return result;
  }

  let updatedAt = draft.lastKnownRemoteUpdatedAt;
  if (Object.keys(changes).length > 0) {
    try {
      const detail = await deps.getIssueDetail(input.ticketId);
      updatedAt = detail.ticket.updatedAt ?? updatedAt;
    } catch {
      // Ignore refresh errors after successful update.
    }
  }

  const clearedMetadata: IssueMetadata = { ...metadata, children: [] };
  updateDraftAfterSave(input.ticketId, subject, description, clearedMetadata, updatedAt);
  if (input.editor) {
    const nextContent = buildTicketEditorContent({
      subject,
      description,
      metadata: clearedMetadata,
      layout: parsed.layout,
      metadataBlock: parsed.metadataBlock,
    });
    await applyEditorContent(input.editor, nextContent);
  }

  if (duplicateChildren.length > 0) {
    const duplicates = Array.from(new Set(duplicateChildren)).join(", ");
    return buildResult(
      "success",
      `Redmine updated. Skipped duplicate children: ${duplicates}`,
    );
  }

  return buildResult("success", "Redmine updated.");
};

export const syncNewTicketDraft = async (input: {
  editor: vscode.TextEditor;
  deps?: TicketCreateDependencies;
}): Promise<TicketSaveResult> => {
  const deps = input.deps ?? defaultCreateDeps;
  const projectId = resolveProjectIdForEditor(input.editor);
  const { result, createdId, parsed } = await createTicketFromContent({
    content: input.editor.document.getText(),
    projectId,
    deps,
  });

  if (result.status !== "created" || !createdId || !parsed || !projectId) {
    return result;
  }

  removeTicketEditorByDocument(input.editor.document);
  registerTicketEditor(createdId, input.editor, "primary", "ticket", projectId);
  setEditorDisplaySource(input.editor, "saved");
  updateDraftAfterSave(createdId, parsed.subject, parsed.description, parsed.metadata);

  return result;
};

export const syncNewTicketDraftContent = async (input: {
  content: string;
  projectId?: number;
  deps?: TicketCreateDependencies;
}): Promise<TicketSaveResult> => {
  const deps = input.deps ?? defaultCreateDeps;
  const { result } = await createTicketFromContent({
    content: input.content,
    projectId: input.projectId,
    deps,
  });
  return result;
};

const createTicketFromContent = async (input: {
  content: string;
  projectId?: number;
  deps: TicketCreateDependencies;
}): Promise<{
  result: TicketSaveResult;
  createdId?: number;
  parsed?: TicketEditorContent;
}> => {
  const projectId = resolveProjectIdForCreate(input.projectId);
  if (!projectId) {
    return {
      result: buildResult(
        "failed",
        "Select a project or set a default project ID before creating tickets.",
      ),
    };
  }

  let parsed: TicketEditorContent;
  try {
    parsed = parseTicketEditorContent(input.content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metadata.";
    return { result: buildResult("failed", message) };
  }

  const subject = parsed.subject.trim();
  if (!subject) {
    return { result: buildResult("failed", "Ticket subject is required.") };
  }

  const children = parsed.metadata.children ?? [];

  let metadataFields: TicketUpdateFields = {};
  try {
    metadataFields = await resolveMetadataForCreate(parsed.metadata, input.deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metadata.";
    return { result: buildResult("failed", message) };
  }

  let createdId: number | undefined;
  try {
    const dueDate =
      typeof metadataFields.dueDate === "string" ? metadataFields.dueDate : undefined;
    createdId = await input.deps.createIssue({
      projectId,
      subject,
      description: parsed.description,
      statusId: metadataFields.statusId,
      trackerId: metadataFields.trackerId,
      priorityId: metadataFields.priorityId,
      dueDate,
    });
  } catch (error) {
    return { result: mapErrorToResult(error) };
  }

  if (createdId && children.length > 0) {
    const createdChildIds: number[] = [];
    try {
      for (const childSubject of children) {
        const childId = await input.deps.createIssue({
          projectId,
          subject: childSubject,
          description: "",
          statusId: metadataFields.statusId,
          trackerId: metadataFields.trackerId,
          priorityId: metadataFields.priorityId,
          dueDate: metadataFields.dueDate as string | undefined,
          parentId: createdId,
        });
        if (!childId) {
          throw new Error("Child ticket creation failed.");
        }
        createdChildIds.push(childId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Child ticket creation failed.";
      await Promise.allSettled(
        [createdId, ...createdChildIds].map((issueId) =>
          input.deps.deleteIssue(issueId),
        ),
      );
      return { result: buildResult("failed", message) };
    }
  }

  return {
    result: buildResult("created", "Ticket created."),
    createdId,
    parsed,
  };
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

  if (ticketId === NEW_TICKET_DRAFT_ID) {
    return syncNewTicketDraft({ editor });
  }

  return syncTicketDraft({
    ticketId,
    content: editor.document.getText(),
  });
};
