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
import { uploadFileAttachment } from "../redmine/attachments";
import { searchUsers } from "../redmine/users";
import { TicketUpdateFields } from "../redmine/types";
import {
  getTicketDraft,
  markDraftStatus,
  setTicketDraftContent,
  updateDraftAfterSave,
} from "./ticketDraftStore";
import {
  markNewTicketDraftFailed,
  markNewTicketDraftSynced,
  markNewTicketDraftSyncing,
} from "./newTicketDraftStore";
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
import {
  buildMarkdownImageUploadFailureMessage,
  hasMarkdownImageUploadFailure,
  MarkdownImageUploadSummary,
  processMarkdownImageUploads,
} from "../utils/markdownImageUpload";
import { resolveEditorBaseDir } from "../utils/editorBaseDir";
import { UploadSummary } from "./saveUploadTypes";
import { getOfflineSyncMode } from "../config/settings";
import {
  addOfflineTicketUpdate,
  addOfflineNewTicket,
  OfflineTicketUpdate,
} from "./offlineSyncStore";
import { withRegisteredTicketControlFields } from "./ticketControlFields";
import { suppressSaveSync, releaseSaveSync, isSaveSyncSuppressed } from "./saveSyncSuppression";

export interface TicketSaveDependencies {
  getIssueDetail: typeof getIssueDetail;
  updateIssue: typeof updateIssue;
  createIssue: typeof createIssue;
  deleteIssue: typeof deleteIssue;
  listIssueStatuses: typeof listIssueStatuses;
  listTrackers: typeof listTrackers;
  listIssuePriorities: typeof listIssuePriorities;
  searchUsers: typeof searchUsers;
  uploadFile: typeof uploadFileAttachment;
}

const defaultDeps: TicketSaveDependencies = {
  getIssueDetail,
  updateIssue,
  createIssue,
  deleteIssue,
  listIssueStatuses,
  listTrackers,
  listIssuePriorities,
  searchUsers,
  uploadFile: uploadFileAttachment,
};

export interface TicketCreateDependencies {
  createIssue: typeof createIssue;
  deleteIssue: typeof deleteIssue;
  listIssueStatuses: typeof listIssueStatuses;
  listTrackers: typeof listTrackers;
  listIssuePriorities: typeof listIssuePriorities;
  searchUsers: typeof searchUsers;
  uploadFile: typeof uploadFileAttachment;
}

const defaultCreateDeps: TicketCreateDependencies = {
  createIssue,
  deleteIssue,
  listIssueStatuses,
  listTrackers,
  listIssuePriorities,
  searchUsers,
  uploadFile: uploadFileAttachment,
};

export interface TicketReloadDependencies {
  getIssueDetail: typeof getIssueDetail;
  applyEditorContent: typeof applyEditorContent;
}

const defaultReloadDeps: TicketReloadDependencies = {
  getIssueDetail,
  applyEditorContent,
};

const buildResult = (
  status: TicketSaveResult["status"],
  message: string,
  extras: Partial<TicketSaveResult> = {},
): TicketSaveResult => ({
  status,
  message,
  ...extras,
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

const resolveUploadSummary = (
  summary: MarkdownImageUploadSummary,
): UploadSummary | undefined =>
  summary.permissionDenied || summary.failures.length > 0 ? summary : undefined;

const handleTicketUploadFailure = (
  summary: MarkdownImageUploadSummary,
): TicketSaveResult | undefined => {
  if (!hasMarkdownImageUploadFailure(summary)) {
    return undefined;
  }
  return buildResult(
    "failed",
    buildMarkdownImageUploadFailureMessage(summary),
    { uploadSummary: resolveUploadSummary(summary) },
  );
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
  const baseStartDate = baseMetadata.start_date ?? "";
  const nextStartDate = nextMetadata.start_date ?? "";
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
  if (baseStartDate !== nextStartDate) {
    changes.start_date = nextStartDate;
  }
  if (baseMetadata.done_ratio !== nextMetadata.done_ratio) {
    changes.done_ratio = nextMetadata.done_ratio;
  }
  if (baseMetadata.estimated_hours !== nextMetadata.estimated_hours) {
    changes.estimated_hours = nextMetadata.estimated_hours;
  }
  return changes;
};

const resolveMetadataUpdates = async (
  changes: Partial<IssueMetadata>,
  deps: TicketSaveDependencies,
  projectId?: number,
): Promise<TicketUpdateFields> => {
  const updateFields: TicketUpdateFields = {};
  if (
    changes.tracker === undefined &&
    changes.priority === undefined &&
    changes.status === undefined &&
    changes.due_date === undefined &&
    changes.start_date === undefined &&
    changes.done_ratio === undefined &&
    changes.estimated_hours === undefined
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

  if (changes.start_date !== undefined) {
    updateFields.startDate = changes.start_date.length === 0 ? null : changes.start_date;
  }
  if (changes.done_ratio !== undefined) {
    updateFields.doneRatio = changes.done_ratio;
  }
  if (changes.estimated_hours !== undefined) {
    updateFields.estimatedHours = changes.estimated_hours;
  }

  return updateFields;
};

const resolveMetadataForCreate = async (
  metadata: IssueMetadata,
  deps: TicketCreateDependencies,
  projectId?: number,
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

  if (metadata.start_date && metadata.start_date.length > 0) {
    fields.startDate = metadata.start_date;
  }
  if (metadata.done_ratio !== undefined) {
    fields.doneRatio = metadata.done_ratio;
  }
  if (metadata.estimated_hours !== undefined) {
    fields.estimatedHours = metadata.estimated_hours;
  }

  return fields;
};

export const syncTicketDraft = async (input: {
  ticketId: number;
  content: string;
  editor?: vscode.TextEditor;
  documentUri?: vscode.Uri;
  deps?: Partial<TicketSaveDependencies>;
  onSubjectUpdated?: (ticketId: number, subject: string) => void;
}): Promise<TicketSaveResult> => {
  if (getOfflineSyncMode() === "manual") {
    return queueTicketDraft(input);
  }
  const deps = { ...defaultDeps, ...input.deps };
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
  const uploadResult = await processMarkdownImageUploads({
    content: parsed.description,
    baseDir: resolveEditorBaseDir({ editor: input.editor, documentUri: input.documentUri }),
    uploadFile: deps.uploadFile,
  });
  const failureResult = handleTicketUploadFailure(uploadResult.summary);
  if (failureResult) {
    return failureResult;
  }
  const uploadSummary = resolveUploadSummary(uploadResult.summary);
  const description = uploadResult.content;
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

  let remoteDetail: IssueDetailResult | undefined;

  let metadataFields: TicketUpdateFields = {};
  try {
    metadataFields = await resolveMetadataUpdates(metadataChanges, deps, remoteDetail?.ticket.projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metadata.";
    return buildResult("failed", message);
  }
  const changes = { ...contentChanges, ...metadataFields };

  if (uploadResult.uploads.length > 0) {
    changes.uploads = uploadResult.uploads;
  }

  if (Object.keys(changes).length === 0 && children.length === 0) {
    return buildResult("no_change", "No changes to save.", { uploadSummary });
  }

  markDraftStatus(input.ticketId, "Dirty");

  if (draft.lastKnownRemoteUpdatedAt) {
    try {
      if (!remoteDetail) {
        remoteDetail = await deps.getIssueDetail(input.ticketId);
      }
      const remoteUpdatedAt = remoteDetail.ticket.updatedAt;
      if (remoteUpdatedAt && remoteUpdatedAt !== draft.lastKnownRemoteUpdatedAt) {
        markDraftStatus(input.ticketId, "Conflict");
        return buildResult("conflict", "Remote changes detected. Refresh before saving.", {
          conflictContext: {
            ticketId: input.ticketId,
            localSubject: subject,
            localDescription: description,
            remoteSubject: remoteDetail.ticket.subject,
            remoteDescription: remoteDetail.ticket.description ?? "",
            remoteUpdatedAt,
          },
        });
      }
    } catch (error) {
      const result = mapErrorToResult(error);
      if (result.status === "conflict") {
        markDraftStatus(input.ticketId, "Conflict");
      }
      return result;
    }
  }

  const createdChildIds: number[] = [];
  let childCreateFields: TicketUpdateFields | undefined;
  if (uniqueChildren.length > 0) {
    if (!remoteDetail) {
      try {
        remoteDetail = await deps.getIssueDetail(input.ticketId);
      } catch (error) {
        return mapErrorToResult(error);
      }
    }
    const projectId = remoteDetail?.ticket.projectId;
    if (!projectId) {
      return buildResult("failed", "Missing project ID for child tickets.");
    }

    try {
      childCreateFields = await resolveMetadataForCreate(metadata, deps, projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid metadata.";
      return buildResult("failed", message);
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
      markDraftStatus(input.ticketId, "Conflict");
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
  if (changes.subject && input.onSubjectUpdated) {
    input.onSubjectUpdated(input.ticketId, subject);
  }

  if (duplicateChildren.length > 0) {
    const duplicates = Array.from(new Set(duplicateChildren)).join(", ");
    return buildResult(
      "success",
      `Redmine updated. Skipped duplicate children: ${duplicates}`,
      { uploadSummary },
    );
  }

  return buildResult("success", "Redmine updated.", { uploadSummary });
};

export const queueTicketDraft = async (input: {
  ticketId: number;
  content: string;
  editor?: vscode.TextEditor;
  documentUri?: vscode.Uri;
  onSubjectUpdated?: (ticketId: number, subject: string) => void;
}): Promise<TicketSaveResult> => {
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
  const contentChanges = computeChanges(
    draft.baseSubject,
    draft.baseDescription,
    subject,
    parsed.description,
  );
  const metadataChanges = computeMetadataChanges(draft.baseMetadata, parsed.metadata);
  const hasChanges =
    Object.keys(contentChanges).length > 0 || Object.keys(metadataChanges).length > 0;
  const children = parsed.metadata.children ?? [];
  if (!hasChanges && children.length === 0) {
    return buildResult("no_change", "No changes to save.");
  }

  const baseDir = resolveEditorBaseDir({
    editor: input.editor,
    documentUri: input.documentUri,
  });

  addOfflineTicketUpdate(input.ticketId, {
    ticketId: input.ticketId,
    baseSubject: draft.baseSubject,
    baseDescription: draft.baseDescription,
    baseMetadata: draft.baseMetadata,
    lastKnownRemoteUpdatedAt: draft.lastKnownRemoteUpdatedAt,
    subject,
    description: parsed.description,
    metadata: parsed.metadata,
    layout: parsed.layout,
    metadataBlock: parsed.metadataBlock,
    baseDir,
  });
  markDraftStatus(input.ticketId, "Dirty");
  if (input.editor) {
    const clearedMetadata: IssueMetadata = { ...parsed.metadata, children: [] };
    const nextContent = buildTicketEditorContent({
      subject,
      description: parsed.description,
      metadata: clearedMetadata,
      layout: parsed.layout,
      metadataBlock: parsed.metadataBlock,
    });
    await applyEditorContent(input.editor, nextContent);
    setEditorDisplaySource(input.editor, "saved");
  }
  if (hasChanges && input.onSubjectUpdated) {
    input.onSubjectUpdated(input.ticketId, subject);
  }

  return buildResult("queued", "Saved for offline sync.");
};

export const syncNewTicketDraft = async (input: {
  editor: vscode.TextEditor;
  deps?: Partial<TicketCreateDependencies>;
  applyContent?: (editor: vscode.TextEditor, content: string) => Promise<void>;
}): Promise<TicketSaveResult> => {
  if (getOfflineSyncMode() === "manual") {
    return queueNewTicketDraft({ editor: input.editor });
  }
  const deps = { ...defaultCreateDeps, ...input.deps };
  const baseDir = resolveEditorBaseDir({ editor: input.editor });
  const projectId = resolveProjectIdForEditor(input.editor);

  let draftId: string | undefined;
  let originalControlFields;
  try {
    const parsedForDraftId = parseTicketEditorContent(input.editor.document.getText(), { allowMissingMetadata: true, fallbackMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] } });
    draftId = parsedForDraftId.controlFields?.draft_id;
    originalControlFields = parsedForDraftId.controlFields;
  } catch {
    // Ignore parse errors for draft_id lookup.
  }

  if (draftId) {
    markNewTicketDraftSyncing(draftId);
  }

  const { result, createdId, parsed } = await createTicketFromContent({
    content: input.editor.document.getText(),
    projectId,
    baseDir,
    deps,
  });

  if (result.status !== "created" || !createdId || !parsed || !projectId) {
    if (draftId) {
      markNewTicketDraftFailed(draftId);
    }
    return result;
  }

  if (draftId) {
    markNewTicketDraftSynced(draftId, createdId);
  }

  removeTicketEditorByDocument(input.editor.document);
  registerTicketEditor(createdId, input.editor, "primary", "ticket", projectId);
  setEditorDisplaySource(input.editor, "saved");
  updateDraftAfterSave(createdId, parsed.subject, parsed.description, parsed.metadata);

  const newControlFields = withRegisteredTicketControlFields(
    originalControlFields ?? {},
    createdId,
  );
  const newContent = buildTicketEditorContent({
    subject: parsed.subject,
    description: parsed.description,
    metadata: parsed.metadata,
    layout: parsed.layout,
    metadataBlock: parsed.metadataBlock,
    controlFields: newControlFields,
  });
  const uriString = input.editor.document.uri.toString();
  suppressSaveSync(uriString);
  try {
    const doApply = input.applyContent ?? applyEditorContent;
    await doApply(input.editor, newContent);
  } finally {
    releaseSaveSync(uriString);
  }

  return result;
};

export const syncNewTicketDraftContent = async (input: {
  content: string;
  projectId?: number;
  documentUri?: vscode.Uri;
  deps?: Partial<TicketCreateDependencies>;
  onCreated?: (createdId: number, parsed: TicketEditorContent) => void;
}): Promise<TicketSaveResult> => {
  if (getOfflineSyncMode() === "manual") {
    return queueNewTicketDraftContent(input);
  }
  const deps = { ...defaultCreateDeps, ...input.deps };
  const baseDir = resolveEditorBaseDir({ documentUri: input.documentUri });
  const { result, createdId, parsed } = await createTicketFromContent({
    content: input.content,
    projectId: input.projectId,
    baseDir,
    deps,
  });
  if (result.status === "created" && createdId && parsed) {
    updateDraftAfterSave(createdId, parsed.subject, parsed.description, parsed.metadata);
    input.onCreated?.(createdId, parsed);
  }
  return result;
};

const createTicketFromContent = async (input: {
  content: string;
  projectId?: number;
  baseDir?: string;
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
    metadataFields = await resolveMetadataForCreate(parsed.metadata, input.deps, projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metadata.";
    return { result: buildResult("failed", message) };
  }

  const uploadResult = await processMarkdownImageUploads({
    content: parsed.description,
    baseDir: input.baseDir,
    uploadFile: input.deps.uploadFile,
  });
  const failureResult = handleTicketUploadFailure(uploadResult.summary);
  if (failureResult) {
    return { result: failureResult };
  }
  const uploadSummary = resolveUploadSummary(uploadResult.summary);
  parsed = {
    ...parsed,
    description: uploadResult.content,
  };

  let createdId: number | undefined;
  try {
    const dueDate =
      typeof metadataFields.dueDate === "string" ? metadataFields.dueDate : undefined;
    createdId = await input.deps.createIssue({
      projectId,
      subject,
      description: uploadResult.content,
      uploads: uploadResult.uploads.length > 0 ? uploadResult.uploads : undefined,
      statusId: metadataFields.statusId,
      trackerId: metadataFields.trackerId,
      priorityId: metadataFields.priorityId,
      dueDate,
      parentId: parsed.metadata.parent,
      startDate: metadataFields.startDate as string | undefined, // Type assertion if needed, but strictNullChecks likely standard
      doneRatio: metadataFields.doneRatio,
      estimatedHours: metadataFields.estimatedHours,
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
      return { result: buildResult("failed", message, { uploadSummary }) };
    }
  }

  return {
    result: buildResult("created", "Ticket created.", { uploadSummary }),
    createdId,
    parsed,
  };
};

export const createTicketFromQueuedContent = async (input: {
  content: string;
  projectId?: number;
  baseDir?: string;
  deps?: Partial<TicketCreateDependencies>;
}): Promise<{
  result: TicketSaveResult;
  createdId?: number;
  parsed?: TicketEditorContent;
}> => {
  const deps = { ...defaultCreateDeps, ...input.deps };
  const output = await createTicketFromContent({
    content: input.content,
    projectId: input.projectId,
    baseDir: input.baseDir,
    deps,
  });
  if (output.result.status === "created" && output.createdId && output.parsed) {
    updateDraftAfterSave(
      output.createdId,
      output.parsed.subject,
      output.parsed.description,
      output.parsed.metadata,
    );
  }
  return output;
};

export const applyQueuedTicketUpdate = async (input: {
  update: OfflineTicketUpdate;
  deps?: Partial<TicketSaveDependencies>;
}): Promise<TicketSaveResult> => {
  const deps = { ...defaultDeps, ...input.deps };
  const update = input.update;
  const uploadResult = await processMarkdownImageUploads({
    content: update.description,
    baseDir: update.baseDir,
    uploadFile: deps.uploadFile,
  });
  const failureResult = handleTicketUploadFailure(uploadResult.summary);
  if (failureResult) {
    return failureResult;
  }
  const uploadSummary = resolveUploadSummary(uploadResult.summary);
  const description = uploadResult.content;
  const contentChanges = computeChanges(
    update.baseSubject,
    update.baseDescription,
    update.subject,
    description,
  );
  const metadataChanges = computeMetadataChanges(update.baseMetadata, update.metadata);
  const children = update.metadata.children ?? [];
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

  let remoteDetail: IssueDetailResult | undefined;

  let metadataFields: TicketUpdateFields = {};
  try {
    metadataFields = await resolveMetadataUpdates(metadataChanges, deps, remoteDetail?.ticket.projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metadata.";
    return buildResult("failed", message);
  }
  const changes = { ...contentChanges, ...metadataFields };
  if (uploadResult.uploads.length > 0) {
    changes.uploads = uploadResult.uploads;
  }

  if (Object.keys(changes).length === 0 && children.length === 0) {
    updateDraftAfterSave(
      update.ticketId,
      update.subject,
      description,
      { ...update.metadata, children: [] },
      update.lastKnownRemoteUpdatedAt,
    );
    return buildResult("no_change", "No changes to save.", { uploadSummary });
  }

  if (update.lastKnownRemoteUpdatedAt) {
    try {
      if (!remoteDetail) {
        remoteDetail = await deps.getIssueDetail(update.ticketId);
      }
      const remoteUpdatedAt = remoteDetail.ticket.updatedAt;
      if (remoteUpdatedAt && remoteUpdatedAt !== update.lastKnownRemoteUpdatedAt) {
        return buildResult("conflict", "Remote changes detected. Refresh before saving.", {
          conflictContext: {
            ticketId: update.ticketId,
            localSubject: update.subject,
            localDescription: description,
            remoteSubject: remoteDetail.ticket.subject,
            remoteDescription: remoteDetail.ticket.description ?? "",
            remoteUpdatedAt,
          },
        });
      }
    } catch (error) {
      return mapErrorToResult(error);
    }
  }

  const createdChildIds: number[] = [];
  let childCreateFields: TicketUpdateFields | undefined;
  if (uniqueChildren.length > 0) {
    if (!remoteDetail) {
      try {
        remoteDetail = await deps.getIssueDetail(update.ticketId);
      } catch (error) {
        return mapErrorToResult(error);
      }
    }
    const projectId = remoteDetail?.ticket.projectId;
    if (!projectId) {
      return buildResult("failed", "Missing project ID for child tickets.");
    }

    try {
      childCreateFields = await resolveMetadataForCreate(update.metadata, deps, projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid metadata.";
      return buildResult("failed", message);
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
          parentId: update.ticketId,
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
      await deps.updateIssue({ issueId: update.ticketId, fields: changes });
    }
  } catch (error) {
    if (createdChildIds.length > 0) {
      await Promise.allSettled(
        createdChildIds.map((issueId) => deps.deleteIssue(issueId)),
      );
    }
    return mapErrorToResult(error);
  }

  let updatedAt = update.lastKnownRemoteUpdatedAt;

  if (Object.keys(changes).length > 0) {
    try {
      const detail = await deps.getIssueDetail(update.ticketId);
      updatedAt = detail.ticket.updatedAt ?? updatedAt;
    } catch {
      // Ignore refresh errors after successful update.
    }
  }

  const clearedMetadata: IssueMetadata = { ...update.metadata, children: [] };
  updateDraftAfterSave(
    update.ticketId,
    update.subject,
    description,
    clearedMetadata,
    updatedAt,
  );

  if (duplicateChildren.length > 0) {
    const duplicates = Array.from(new Set(duplicateChildren)).join(", ");
    return buildResult(
      "success",
      `Redmine updated. Skipped duplicate children: ${duplicates}`,
      { uploadSummary },
    );
  }

  return buildResult("success", "Redmine updated.", { uploadSummary });
};

const validateNewTicketContent = (content: string): TicketSaveResult | undefined => {
  let parsed: TicketEditorContent;
  try {
    parsed = parseTicketEditorContent(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metadata.";
    return buildResult("failed", message);
  }

  const subject = parsed.subject.trim();
  if (!subject) {
    return buildResult("failed", "Ticket subject is required.");
  }

  return undefined;
};

export const queueNewTicketDraft = async (input: {
  editor: vscode.TextEditor;
}): Promise<TicketSaveResult> => {
  const content = input.editor.document.getText();
  const validation = validateNewTicketContent(content);
  if (validation) {
    return validation;
  }
  addOfflineNewTicket({
    content,
    projectId: resolveProjectIdForEditor(input.editor),
    documentUri: input.editor.document.uri.toString(),
    baseDir: resolveEditorBaseDir({ editor: input.editor }),
  });
  setEditorDisplaySource(input.editor, "saved");
  return buildResult("queued", "Saved for offline sync.");
};

export const queueNewTicketDraftContent = async (input: {
  content: string;
  projectId?: number;
  documentUri?: vscode.Uri;
}): Promise<TicketSaveResult> => {
  const validation = validateNewTicketContent(input.content);
  if (validation) {
    return validation;
  }
  addOfflineNewTicket({
    content: input.content,
    projectId: input.projectId,
    documentUri: input.documentUri?.toString(),
    baseDir: resolveEditorBaseDir({ documentUri: input.documentUri }),
  });
  return buildResult("queued", "Saved for offline sync.");
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

/**
 * Ctrl+S 時のローカル保存処理。Redmine API は呼ばない。
 * 明示的な同期は `syncEditorToRedmine` コマンドで行う。
 */
export const saveTicketDraftLocally = (
  editor: vscode.TextEditor,
): TicketSaveResult | undefined => {
  if (!isTicketEditor(editor)) { return undefined; }
  if (getEditorContentType(editor) !== "ticket") { return undefined; }

  const ticketId = getTicketIdForEditor(editor);
  if (!ticketId) { return undefined; }

  if (ticketId === NEW_TICKET_DRAFT_ID) {
    addOfflineNewTicket({
      content: editor.document.getText(),
      documentUri: editor.document.uri.toString(),
    });
    return buildResult("queued", "新規チケットの下書きをローカルに保存しました。");
  }

  const content = editor.document.getText();
  try {
    const parsed = parseTicketEditorContent(content, {
      allowMissingMetadata: true,
      fallbackMetadata: {
        tracker: "",
        priority: "",
        status: "",
        due_date: "",
        children: [],
      },
    });
    setTicketDraftContent(ticketId, parsed);
    markDraftStatus(ticketId, "Dirty");
    const draft = getTicketDraft(ticketId);
    if (draft) {
      addOfflineTicketUpdate(ticketId, {
        ticketId,
        baseSubject: draft.baseSubject,
        baseDescription: draft.baseDescription,
        baseMetadata: draft.baseMetadata,
        lastKnownRemoteUpdatedAt: draft.lastKnownRemoteUpdatedAt,
        subject: parsed.subject ?? draft.baseSubject,
        description: parsed.description ?? draft.baseDescription,
        metadata: parsed.metadata ?? draft.baseMetadata,
        layout: parsed.layout,
        metadataBlock: parsed.metadataBlock,
      });
    }
    return buildResult("queued", "ローカルに保存しました。Redmine への反映には同期コマンドを実行してください。");
  } catch {
    return buildResult("failed", "ドラフトの解析に失敗しました。");
  }
};

export const handleTicketEditorSave = async (
  editor: vscode.TextEditor,
  _options: { onSubjectUpdated?: (ticketId: number, subject: string) => void } = {},
): Promise<TicketSaveResult | undefined> => {
  if (isSaveSyncSuppressed(editor.document.uri.toString())) {
    return undefined;
  }

  const result = saveTicketDraftLocally(editor);
  if (result !== undefined) {
    return result;
  }

  // ticket エディタ以外（コメント等）は従来通り何もしない
  return undefined;
};
