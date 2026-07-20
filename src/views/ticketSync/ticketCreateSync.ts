import * as vscode from "vscode";
import { getDefaultProjectId, getOfflineSyncMode } from "../../config/settings";
import { getProjectSelection } from "../../config/projectSelection";
import { processMarkdownImageUploads } from "../../utils/markdownImageUpload";
import { resolveEditorBaseDir } from "../../utils/editorBaseDir";
import { removeOfflineNewTicket } from "../offlineSyncStore";
import { markNewTicketDraftFailed, markNewTicketDraftSynced, markNewTicketDraftSyncing } from "../newTicketDraftStore";
import { parseTicketEditorContent, type TicketEditorContent } from "../ticketEditorContent";
import { updateDraftAfterSave } from "../ticketDraftStore";
import { getProjectIdForEditor } from "../ticketEditorRegistry";
import type { TicketSaveResult } from "../ticketSaveTypes";
import type { TicketUpdateFields } from "../../redmine/types";
import { handleTicketUploadFailure, resolveUploadSummary } from "./ticketImageUploadSync";
import { resolveMetadataForCreate } from "./ticketMetadataResolver";
import { createChildTickets } from "./ticketChildCreateSync";
import { rewriteNewTicketEditorToTicketMode } from "./ticketEditorRewrite";
import { queueNewTicketDraft, queueNewTicketDraftContent } from "./ticketQueueSync";
import { buildResult, mapErrorToResult } from "./ticketSyncResult";
import { defaultCreateDeps } from "./ticketSyncDeps";
import type { TicketCreateDependencies } from "./types";

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

export const syncNewTicketDraft = async (input: {
  operationScope?: string;
  editor: vscode.TextEditor;
  deps?: Partial<TicketCreateDependencies>;
  applyContent?: (editor: vscode.TextEditor, content: string) => Promise<void>;
}): Promise<TicketSaveResult> => {
  if (getOfflineSyncMode() === "manual") {
    return queueNewTicketDraft({ editor: input.editor, operationScope: input.operationScope });
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

  await rewriteNewTicketEditorToTicketMode({
    operationScope: input.operationScope,
    editor: input.editor,
    createdId,
    projectId,
    parsed,
    originalControlFields,
    applyContent: input.applyContent,
  });

  return result;
};

export const syncNewTicketDraftContent = async (input: {
  operationScope?: string;
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
    updateDraftAfterSave(
      createdId,
      parsed.subject,
      parsed.description,
      parsed.metadata,
      undefined,
      input.operationScope,
    );
    input.onCreated?.(createdId, parsed);
  }
  return result;
};

export const createTicketFromContent = async (input: {
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
      startDate: metadataFields.startDate as string | undefined,
      doneRatio: metadataFields.doneRatio,
      estimatedHours: metadataFields.estimatedHours,
      assigneeId: metadataFields.assigneeId,
    });
  } catch (error) {
    return { result: mapErrorToResult(error) };
  }

  if (createdId && children.length > 0) {
    const childCreateResult = await createChildTickets({
      projectId,
      parentId: createdId,
      subjects: children,
      fields: metadataFields,
      createIssue: input.deps.createIssue,
      deleteIssue: input.deps.deleteIssue,
      description: "",
    });
    if (childCreateResult.error) {
      try {
        await input.deps.deleteIssue(createdId);
      } catch {
        // ignore rollback failure
      }
      await Promise.allSettled(
        childCreateResult.createdChildIds.map((issueId) => input.deps.deleteIssue(issueId)),
      );
      return { result: buildResult("failed", childCreateResult.error, { uploadSummary }) };
    }
  }

  if (!createdId) {
    return { result: buildResult("failed", "Ticket creation failed.", { uploadSummary }) };
  }

  if (uploadResult.uploads.length > 0 && !parsed.description) {
    parsed = {
      ...parsed,
      description: uploadResult.content,
    };
  }

  return {
    result: buildResult("created", "Ticket created.", { uploadSummary }),
    createdId,
    parsed,
  };
};

export const createTicketFromQueuedContent = async (input: {
  operationScope?: string;
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
      undefined,
      input.operationScope,
    );
  }
  return output;
};
