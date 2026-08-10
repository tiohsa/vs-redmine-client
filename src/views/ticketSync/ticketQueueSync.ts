import * as vscode from "vscode";
import {
  addOfflineNewTicket,
  addOfflineTicketUpdate,
} from "../offlineSyncStore";
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
import {
  buildResult,
  isRemoteCommitUnknownError,
  mapErrorToResult,
} from "./ticketSyncResult";
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
import { editorContentFromTicket } from "./ticketRemoteContent";
import { rewriteDocumentWithRegisteredFields } from "../editorDocumentRewrite";

export interface QueueTicketDraftInput {
  operationScope?: string;
  ticketId: number;
  content: string;
  editor?: vscode.TextEditor;
  documentUri?: vscode.Uri;
  onSubjectUpdated?: (ticketId: number, subject: string) => void;
  queueUnchanged?: boolean;
}

export const queueTicketDraft = async (
  input: QueueTicketDraftInput,
): Promise<TicketSaveResult> => {
  const draft = getTicketDraft(input.ticketId, input.operationScope);
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
  if (!hasChanges && children.length === 0 && !input.queueUnchanged) {
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
    controlFields: parsed.controlFields,
    baseDir,
    documentUri: input.editor?.document.uri.toString() ?? input.documentUri?.toString(),
    connectionScope: input.operationScope,
    operationId: `${input.operationScope ?? "legacy"}:ticket:${input.ticketId}`,
    phase: "queued",
  }, input.operationScope);
  if (!hasChanges && children.length === 0) {
    return buildResult("no_change", "No changes to save.");
  }
  markDraftStatus(input.ticketId, "Dirty", input.operationScope);
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

const reconcileQueuedTicketUpdate = async (input: {
  deps: TicketSaveDependencies;
  update: OfflineTicketUpdate;
  operationScope?: string;
  uploadSummary?: ReturnType<typeof resolveUploadSummary>;
}): Promise<TicketSaveResult> => {
  let detail: IssueDetailResult;
  try {
    detail = await input.deps.getIssueDetail(input.update.ticketId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remote read-back failed.";
    return buildResult("failed", `remote_reconcile_pending: ${message}`, {
      uploadSummary: input.uploadSummary,
    });
  }

  if (!detail.ticket.updatedAt) {
    return buildResult(
      "failed",
      "remote_reconcile_pending: Remote read-back did not include an updated revision.",
      { uploadSummary: input.uploadSummary },
    );
  }

  try {
    const canonical = editorContentFromTicket(detail.ticket, {
      layout: input.update.layout,
      metadataBlock: input.update.metadataBlock,
      controlFields: input.update.controlFields,
    });
    if (input.update.documentUri) {
      const rewritten = await rewriteDocumentWithRegisteredFields(
        input.update.documentUri,
        input.update.ticketId,
        {},
        detail.ticket.projectId,
        canonical,
      );
      if (!rewritten) {
        return buildResult("failed", "local_finalize_pending", {
          uploadSummary: input.uploadSummary,
        });
      }
    }
    updateDraftAfterSave(
      input.update.ticketId,
      canonical.subject,
      canonical.description,
      canonical.metadata,
      detail.ticket.updatedAt,
      input.operationScope,
    );
    return buildResult("success", "Redmine updated.", {
      uploadSummary: input.uploadSummary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local finalization failed.";
    return buildResult("failed", `local_finalize_pending: ${message}`, {
      uploadSummary: input.uploadSummary,
    });
  }
};

export const applyQueuedTicketUpdate = async (input: {
  operationScope?: string;
  update: OfflineTicketUpdate;
  deps?: Partial<TicketSaveDependencies>;
  deferReconciliation?: boolean;
  beforeRemoteWrite?: () => Promise<void>;
  afterRemoteWrite?: (createdChildIds: number[]) => Promise<void>;
}): Promise<TicketSaveResult> => {
  const deps = { ...defaultDeps, ...input.deps };
  const update = input.update;

  if (
    update.phase === "remote_committed" ||
    update.phase === "reconciliation_pending" ||
    update.phase === "local_finalize_pending"
  ) {
    if (input.deferReconciliation) {
      return buildResult("success", "Remote commit pending reconciliation.");
    }
    return reconcileQueuedTicketUpdate({
      deps,
      update,
      operationScope: input.operationScope,
    });
  }

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

  if (metadataChanges.tracker !== undefined || metadataChanges.assignee !== undefined) {
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
    if (input.deferReconciliation) {
      return buildResult("no_change", "No changes to save.", { uploadSummary });
    }
    const reconciled = await reconcileQueuedTicketUpdate({
      deps,
      update,
      operationScope: input.operationScope,
      uploadSummary,
    });
    return reconciled.status === "success"
      ? buildResult("no_change", "No changes to save.", { uploadSummary })
      : reconciled;
  }

  const conflict = await detectTicketUpdatedAtConflict({
    deps,
    update,
    localDescription: description,
    ensureRemoteDetail,
  });
  if (conflict) { return conflict; }

  if (input.beforeRemoteWrite) {
    try {
      await input.beforeRemoteWrite();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync journal persistence failed.";
      return buildResult("failed", message, { uploadSummary });
    }
  }

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
    return {
      ...mapErrorToResult(error),
      remoteWriteAttempted: true,
      remoteCommitUnknown: isRemoteCommitUnknownError(error),
    };
  }

  if (input.afterRemoteWrite) {
    try {
      await input.afterRemoteWrite(createdChildIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync journal persistence failed.";
      return buildResult("failed", `remote_commit_journal_failed: ${message}`, { uploadSummary });
    }
  }

  if (!input.deferReconciliation) {
    const reconciled = await reconcileQueuedTicketUpdate({
      deps,
      update: { ...update, phase: "remote_committed", createdChildIds },
      operationScope: input.operationScope,
      uploadSummary,
    });
    if (reconciled.status !== "success") {
      return reconciled;
    }
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

/**
 * Ctrl+S local save path. Does not call Redmine APIs.
 */
export const saveTicketDraftLocally = (
  editor: vscode.TextEditor,
  operationScope?: string,
): TicketSaveResult | undefined => {
  if (!isTicketEditor(editor)) { return undefined; }
  if (getEditorContentType(editor) !== "ticket") { return undefined; }

  const ticketId = getTicketIdForEditor(editor);
  if (!ticketId) { return undefined; }

  if (ticketId === NEW_TICKET_DRAFT_ID) {
    addOfflineNewTicket({
      content: editor.document.getText(),
      documentUri: editor.document.uri.toString(),
    }, operationScope);
    return buildResult("queued", vscode.l10n.t("New ticket draft saved locally."));
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
    setTicketDraftContent(ticketId, parsed, operationScope);
    markDraftStatus(ticketId, "Dirty", operationScope);
    const draft = getTicketDraft(ticketId, operationScope);
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
        controlFields: parsed.controlFields,
        documentUri: editor.document.uri.toString(),
        connectionScope: operationScope,
        operationId: `${operationScope ?? "legacy"}:ticket:${ticketId}`,
        phase: "queued",
      }, operationScope);
    }
    return buildResult("queued", vscode.l10n.t("Saved locally. Run a sync command to apply changes to Redmine."));
  } catch {
    return buildResult("failed", vscode.l10n.t("Failed to parse draft."));
  }
};

export const handleTicketEditorSave = async (
  editor: vscode.TextEditor,
  options: { onSubjectUpdated?: (ticketId: number, subject: string) => void; operationScope?: string } = {},
): Promise<TicketSaveResult | undefined> => {
  if (isSaveSyncSuppressed(editor.document.uri.toString())) {
    return undefined;
  }

  const result = saveTicketDraftLocally(editor, options.operationScope);
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
  operationScope?: string;
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
  }, input.operationScope);
  setEditorDisplaySource(input.editor, "saved");
  return buildResult("queued", "Saved for offline sync.");
};

export const queueNewTicketDraftContent = async (input: {
  operationScope?: string;
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
  }, input.operationScope);
  return buildResult("queued", "Saved for offline sync.");
};
