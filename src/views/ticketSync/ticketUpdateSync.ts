import * as vscode from "vscode";
import { getOfflineSyncMode } from "../../config/settings";
import type { IssueDetailResult } from "../../redmine/issues";
import type { TicketUpdateFields } from "../../redmine/types";
import { resolveEditorBaseDir } from "../../utils/editorBaseDir";
import { processMarkdownImageUploads } from "../../utils/markdownImageUpload";
import { applyEditorContent } from "../ticketPreview";
import {
  buildTicketEditorContent,
  parseTicketEditorContent,
} from "../ticketEditorContent";
import { getTicketDraft, markDraftStatus, updateDraftAfterSave } from "../ticketDraftStore";
import type { IssueMetadata } from "../ticketMetadataTypes";
import type { TicketSaveResult } from "../ticketSaveTypes";
import { computeChanges, computeMetadataChanges, resolveMetadataForCreate, resolveMetadataUpdates } from "./ticketMetadataResolver";
import { handleTicketUploadFailure, resolveUploadSummary } from "./ticketImageUploadSync";
import { queueTicketDraft } from "./ticketQueueSync";
import { buildResult, mapErrorToResult } from "./ticketSyncResult";
import { defaultDeps, defaultReloadDeps } from "./ticketSyncDeps";
import { createChildTickets, splitUniqueChildren } from "./ticketChildCreateSync";
import type { TicketReloadDependencies, TicketSaveDependencies } from "./types";
import { buildTicketPreviewContent } from "../ticketPreview";

export interface SyncTicketDraftInput {
  ticketId: number;
  content: string;
  editor?: vscode.TextEditor;
  documentUri?: vscode.Uri;
  deps?: Partial<TicketSaveDependencies>;
  onSubjectUpdated?: (ticketId: number, subject: string) => void;
}

export interface ReloadTicketEditorInput {
  ticketId: number;
  editor: vscode.TextEditor;
  deps?: TicketReloadDependencies;
}

export const syncTicketDraft = async (
  input: SyncTicketDraftInput,
): Promise<TicketSaveResult> => {
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
  const { uniqueChildren, duplicateChildren } = splitUniqueChildren(children);
  const contentChanges = computeChanges(
    draft.baseSubject,
    draft.baseDescription,
    subject,
    description,
  );
  const metadataChanges = computeMetadataChanges(draft.baseMetadata, metadata);

  let remoteDetail: IssueDetailResult | undefined;

  if (metadataChanges.tracker !== undefined) {
    try {
      remoteDetail = await deps.getIssueDetail(input.ticketId);
    } catch (error) {
      return mapErrorToResult(error);
    }
  }

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

    const childCreateResult = await createChildTickets({
      projectId,
      parentId: input.ticketId,
      subjects: uniqueChildren,
      fields: childCreateFields,
      createIssue: deps.createIssue,
      deleteIssue: deps.deleteIssue,
      description: "",
    });
    if (childCreateResult.error) {
      await Promise.allSettled(
        childCreateResult.createdChildIds.map((issueId) => deps.deleteIssue(issueId)),
      );
      return buildResult("failed", childCreateResult.error);
    }
    createdChildIds.push(...childCreateResult.createdChildIds);
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

export const reloadTicketEditor = async (
  input: ReloadTicketEditorInput,
): Promise<TicketSaveResult> => {
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
