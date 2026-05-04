import * as vscode from "vscode";
import { addOfflineNewTicket, addOfflineTicketUpdate } from "../offlineSyncStore";
import { buildTicketEditorContent, parseTicketEditorContent } from "../ticketEditorContent";
import { getTicketDraft, markDraftStatus, setTicketDraftContent, updateDraftAfterSave } from "../ticketDraftStore";
import type { IssueMetadata } from "../ticketMetadataTypes";
import { applyEditorContent } from "../ticketPreview";
import { resolveEditorBaseDir } from "../../utils/editorBaseDir";
import { processMarkdownImageUploads } from "../../utils/markdownImageUpload";
import type { IssueDetailResult } from "../../redmine/issues";
import type { TicketUpdateFields } from "../../redmine/types";
import type { OfflineTicketUpdate } from "../offlineSyncStore";
import { createChildTickets, splitUniqueChildren } from "./ticketChildCreateSync";
import { handleTicketUploadFailure, resolveUploadSummary } from "./ticketImageUploadSync";
import { computeChanges, computeMetadataChanges, resolveMetadataForCreate, resolveMetadataUpdates } from "./ticketMetadataResolver";
import { defaultDeps } from "./ticketSyncDeps";
import { buildResult, mapErrorToResult } from "./ticketSyncResult";
import type { TicketSaveResult } from "../ticketSaveTypes";
import type { TicketSaveDependencies } from "./types";
import type { UploadToken } from "../../redmine/types";
import {
  getEditorContentType,
  getProjectIdForEditor,
  getTicketIdForEditor,
  isTicketEditor,
  NEW_TICKET_DRAFT_ID,
  setEditorDisplaySource,
} from "../ticketEditorRegistry";
import { isSaveSyncSuppressed } from "../saveSyncSuppression";
import { getDefaultProjectId } from "../../config/settings";
import { getProjectSelection } from "../../config/projectSelection";

export interface QueueTicketDraftInput {
  ticketId: number;
  content: string;
  editor?: vscode.TextEditor;
  documentUri?: vscode.Uri;
  onSubjectUpdated?: (ticketId: number, subject: string) => void;
}

export const queueTicketDraft = async (
  input: QueueTicketDraftInput,
): Promise<TicketSaveResult> => {
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

type ProcessedTicketDescription =
  | {
      ok: true;
      description: string;
      uploads: UploadToken[];
      uploadSummary: ReturnType<typeof resolveUploadSummary>;
    }
  | { ok: false; failure: TicketSaveResult };

const processTicketDescriptionUploads = async (
  update: OfflineTicketUpdate,
  deps: TicketSaveDependencies,
): Promise<ProcessedTicketDescription> => {
  const uploadResult = await processMarkdownImageUploads({
    content: update.description,
    baseDir: update.baseDir,
    uploadFile: deps.uploadFile,
  });
  const failure = handleTicketUploadFailure(uploadResult.summary);
  if (failure) { return { ok: false, failure }; }
  return {
    ok: true,
    description: uploadResult.content,
    uploads: uploadResult.uploads,
    uploadSummary: resolveUploadSummary(uploadResult.summary),
  };
};

const detectTicketUpdatedAtConflict = async (input: {
  deps: TicketSaveDependencies;
  update: OfflineTicketUpdate;
  localDescription: string;
  ensureRemoteDetail: () => Promise<IssueDetailResult>;
}): Promise<TicketSaveResult | undefined> => {
  if (!input.update.lastKnownRemoteUpdatedAt) { return undefined; }
  try {
    const remote = await input.ensureRemoteDetail();
    const remoteUpdatedAt = remote.ticket.updatedAt;
    if (remoteUpdatedAt && remoteUpdatedAt !== input.update.lastKnownRemoteUpdatedAt) {
      return buildResult("conflict", "Remote changes detected. Refresh before saving.", {
        conflictContext: {
          ticketId: input.update.ticketId,
          localSubject: input.update.subject,
          localDescription: input.localDescription,
          remoteSubject: remote.ticket.subject,
          remoteDescription: remote.ticket.description ?? "",
          remoteUpdatedAt,
        },
      });
    }
  } catch (error) {
    return mapErrorToResult(error);
  }
  return undefined;
};

const createQueuedChildTickets = async (input: {
  deps: TicketSaveDependencies;
  update: OfflineTicketUpdate;
  uniqueChildren: string[];
  ensureRemoteDetail: () => Promise<IssueDetailResult>;
}): Promise<{ createdChildIds: number[]; failure?: TicketSaveResult }> => {
  if (input.uniqueChildren.length === 0) {
    return { createdChildIds: [] };
  }

  let remoteDetail: IssueDetailResult;
  try {
    remoteDetail = await input.ensureRemoteDetail();
  } catch (error) {
    return { createdChildIds: [], failure: mapErrorToResult(error) };
  }
  const projectId = remoteDetail.ticket.projectId;
  if (!projectId) {
    return {
      createdChildIds: [],
      failure: buildResult("failed", "Missing project ID for child tickets."),
    };
  }

  let childCreateFields: TicketUpdateFields;
  try {
    childCreateFields = await resolveMetadataForCreate(input.update.metadata, input.deps, projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metadata.";
    return { createdChildIds: [], failure: buildResult("failed", message) };
  }

  const childCreateResult = await createChildTickets({
    projectId,
    parentId: input.update.ticketId,
    subjects: input.uniqueChildren,
    fields: childCreateFields,
    createIssue: input.deps.createIssue,
    deleteIssue: input.deps.deleteIssue,
    description: "",
  });
  if (childCreateResult.error) {
    await Promise.allSettled(
      childCreateResult.createdChildIds.map((issueId) => input.deps.deleteIssue(issueId)),
    );
    return {
      createdChildIds: [],
      failure: buildResult("failed", childCreateResult.error),
    };
  }
  return { createdChildIds: childCreateResult.createdChildIds };
};

const refetchUpdatedAt = async (
  deps: TicketSaveDependencies,
  ticketId: number,
  fallback: string | undefined,
): Promise<string | undefined> => {
  try {
    const detail = await deps.getIssueDetail(ticketId);
    return detail.ticket.updatedAt ?? fallback;
  } catch {
    return fallback;
  }
};

export const applyQueuedTicketUpdate = async (input: {
  update: OfflineTicketUpdate;
  deps?: Partial<TicketSaveDependencies>;
}): Promise<TicketSaveResult> => {
  const deps = { ...defaultDeps, ...input.deps };
  const update = input.update;

  const processed = await processTicketDescriptionUploads(update, deps);
  if (!processed.ok) { return processed.failure; }
  const { description, uploads, uploadSummary } = processed;

  const contentChanges = computeChanges(
    update.baseSubject,
    update.baseDescription,
    update.subject,
    description,
  );
  const metadataChanges = computeMetadataChanges(update.baseMetadata, update.metadata);
  const children = update.metadata.children ?? [];
  const { uniqueChildren, duplicateChildren } = splitUniqueChildren(children);

  let remoteDetail: IssueDetailResult | undefined;
  const ensureRemoteDetail = async (): Promise<IssueDetailResult> => {
    if (!remoteDetail) {
      remoteDetail = await deps.getIssueDetail(update.ticketId);
    }
    return remoteDetail;
  };

  if (metadataChanges.tracker !== undefined) {
    try {
      await ensureRemoteDetail();
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
  const changes: TicketUpdateFields = { ...contentChanges, ...metadataFields };
  if (uploads.length > 0) {
    changes.uploads = uploads;
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

  const conflict = await detectTicketUpdatedAtConflict({
    deps,
    update,
    localDescription: description,
    ensureRemoteDetail,
  });
  if (conflict) { return conflict; }

  const childCreate = await createQueuedChildTickets({
    deps,
    update,
    uniqueChildren,
    ensureRemoteDetail,
  });
  if (childCreate.failure) { return childCreate.failure; }
  const createdChildIds = childCreate.createdChildIds;

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

  const updatedAt = Object.keys(changes).length > 0
    ? await refetchUpdatedAt(deps, update.ticketId, update.lastKnownRemoteUpdatedAt)
    : update.lastKnownRemoteUpdatedAt;

  updateDraftAfterSave(
    update.ticketId,
    update.subject,
    description,
    { ...update.metadata, children: [] },
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

/**
 * Ctrl+S local save path. Does not call Redmine APIs.
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

  return undefined;
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

export const validateNewTicketContent = (content: string): TicketSaveResult | undefined => {
  let parsed;
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
