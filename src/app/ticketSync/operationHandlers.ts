import * as vscode from "vscode";
import type { IssueUploadInput } from "../../redmine/issues";
import { getIssueDetail, updateIssue } from "../../redmine/issues";
import { addComment, updateComment } from "../../redmine/comments";
import { getCurrentUserId } from "../../redmine/users";
import { uploadClipboardImage, uploadFileAttachment } from "../../redmine/attachments";
import { parseTicketEditorContent, type TicketEditorContent } from "../../views/ticketEditorContent";
import { editorContentFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import { resolveMetadataForCreate } from "../../views/ticketSync/ticketMetadataResolver";
import { rewriteNewTicketEditorToTicketMode } from "../../views/ticketSync/ticketEditorRewrite";
import { updateDraftAfterSave } from "../../views/ticketDraftStore";
import { markNewTicketDraftSynced } from "../../views/newTicketDraftStore";
import type { TicketCreateDependencies, TicketSaveDependencies } from "../../views/ticketSync/types";
import { defaultCreateDeps, defaultDeps as defaultTicketDeps } from "../../views/ticketSync/ticketSyncDeps";
import {
  finalizeNewCommentDraftDocument,
  reconcileCommentCommitUnknown,
  resolveCreatedCommentId,
  type CommentSaveDependencies,
} from "../../views/commentSaveSync";
import {
  finalizeNewCommentDraftFileAfterSync,
  updateCommentUpdateFileAfterSync,
} from "../../views/commentUpdateFile";
import {
  buildMarkdownImageUploadFailureMessage,
  hasMarkdownImageUploadFailure,
  processMarkdownImageUploads,
} from "../../utils/markdownImageUpload";
import { validateComment } from "../../utils/commentValidation";
import { resolveUploadSummary } from "../../views/ticketSync/ticketImageUploadSync";
import { containsConflictMarkers } from "../../utils/threeWayMerge";
import { computeNotesHash } from "../../utils/notesHash";
import type { UploadToken } from "../../redmine/types";
import type {
  CommentCreateIntent,
  CommentUpdateIntent,
  SyncIntent,
  SyncOutcome,
  TicketCreateIntent,
  TicketUpdateIntent,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import { isRemoteCommitUnknownError } from "../../views/ticketSync/ticketSyncResult";

export const defaultCommentDeps: CommentSaveDependencies = {
  addComment,
  updateComment,
  updateIssue,
  getIssueDetail,
  getCurrentUserId,
  uploadFile: uploadFileAttachment,
};

export interface OperationHandlerContext {
  connectionScope: string;
}

export interface OperationHandlerDeps {
  ticketCreate?: Partial<TicketCreateDependencies>;
  ticketUpdate?: Partial<TicketSaveDependencies>;
  comment?: Partial<CommentSaveDependencies>;
}

export interface OperationHandler<TIntent extends SyncIntent = any, TPrepared = any> {
  prepare(
    operation: UnifiedSyncOperation<TIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: TPrepared } | { ok: false; outcome: SyncOutcome }>;

  executeSecondaryEffects?(
    operation: UnifiedSyncOperation<TIntent>,
    prepared: TPrepared,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; uploadTokens?: IssueUploadInput[] } | { ok: false; error: Error; commitUnknown?: boolean }>;

  executeRemoteWrite(
    operation: UnifiedSyncOperation<TIntent>,
    prepared: TPrepared,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{
    ok: true;
    createdRemoteId?: number;
    projectId?: number;
    remoteUpdatedAt?: string;
  } | {
    ok: false;
    commitUnknown: boolean;
    error: Error;
    outcome?: SyncOutcome;
  }>;

  reconcileRemote(
    operation: UnifiedSyncOperation<TIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{
    ok: true;
    remoteId?: number;
    projectId?: number;
    remoteUpdatedAt?: string;
    canonical?: any;
  } | {
    ok: false;
    message: string;
  }>;

  finalizeLocal(
    operation: UnifiedSyncOperation<TIntent>,
    reconciled: any,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true } | { ok: false; message: string; pending: "local_finalize" }>;
}

export class TicketCreateHandler implements OperationHandler<TicketCreateIntent, {
  parsed: TicketEditorContent;
  projectId: number;
  uploadTokens: IssueUploadInput[];
}> {
  public async prepare(
    operation: UnifiedSyncOperation<TicketCreateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: { parsed: TicketEditorContent; projectId: number; uploadTokens: IssueUploadInput[] } } | { ok: false; outcome: SyncOutcome }> {
    const intent = operation.intent;
    if (!intent) {
      return { ok: false, outcome: { kind: "failed_before_commit", error: new Error("Missing TicketCreateIntent") } };
    }

    let parsed: TicketEditorContent;
    if (typeof intent.description === "string" && !intent.subject && !intent.metadata?.tracker) {
      try {
        parsed = parseTicketEditorContent(intent.description, {
          allowMissingMetadata: true,
          fallbackMetadata: intent.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
        });
      } catch (err) {
        return { ok: false, outcome: { kind: "failed_before_commit", error: err as Error } };
      }
    } else {
      parsed = {
        subject: intent.subject,
        description: intent.description,
        metadata: intent.metadata,
        layout: intent.layout,
        metadataBlock: intent.metadataBlock,
        controlFields: intent.controlFields,
      };
    }

    const projectId = intent.projectId || parsed.controlFields?.project_id || operation.projectId || 0;
    const uploadTokens: IssueUploadInput[] = [...(intent.uploadTokens ?? [])];

    return {
      ok: true,
      prepared: {
        parsed,
        projectId,
        uploadTokens,
      },
    };
  }

  public async executeSecondaryEffects(
    operation: UnifiedSyncOperation<TicketCreateIntent>,
    prepared: { parsed: TicketEditorContent; projectId: number; uploadTokens: IssueUploadInput[] },
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; uploadTokens?: IssueUploadInput[] } | { ok: false; error: Error; commitUnknown?: boolean }> {
    const attachments = operation.intent?.attachments ?? [];
    const tokens: IssueUploadInput[] = [...prepared.uploadTokens];
    const createDeps = { ...defaultCreateDeps, ...deps?.ticketCreate };

    for (const att of attachments) {
      if (att.kind === "token") {
        tokens.push({ token: att.token, filename: att.filename ?? "attachment", content_type: att.contentType ?? "application/octet-stream" });
      } else if (att.kind === "file") {
        try {
          const uploadFn = (createDeps as any).uploadFile ?? uploadFileAttachment;
          const res = await uploadFn(att.filePath);
          tokens.push({ token: res.token, filename: att.filename ?? res.filename, content_type: att.contentType ?? res.contentType });
        } catch (err) {
          return { ok: false, error: err as Error, commitUnknown: isRemoteCommitUnknownError(err) };
        }
      } else if (att.kind === "clipboard") {
        try {
          const uploadFn = (createDeps as any).uploadClipboardImage ?? uploadClipboardImage;
          const res = await uploadFn();
          tokens.push({ token: res.token, filename: att.filename ?? res.filename, content_type: att.contentType ?? res.contentType });
        } catch (err) {
          return { ok: false, error: err as Error, commitUnknown: isRemoteCommitUnknownError(err) };
        }
      }
    }

    prepared.uploadTokens = tokens;
    return { ok: true, uploadTokens: tokens };
  }

  public async executeRemoteWrite(
    operation: UnifiedSyncOperation<TicketCreateIntent>,
    prepared: { parsed: TicketEditorContent; projectId: number; uploadTokens: IssueUploadInput[] },
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{
    ok: true;
    createdRemoteId?: number;
    projectId?: number;
    remoteUpdatedAt?: string;
  } | {
    ok: false;
    commitUnknown: boolean;
    error: Error;
    outcome?: SyncOutcome;
  }> {
    const createDeps: any = { ...defaultCreateDeps, ...deps?.ticketCreate };
    if (deps?.ticketCreate && !deps.ticketCreate.getProjectTrackers && deps.ticketCreate.listTrackers) {
      createDeps.getProjectTrackers = undefined;
    }
    try {
      const resolved = await resolveMetadataForCreate(
        prepared.parsed.metadata,
        createDeps,
        prepared.projectId,
      );

      const createdId = await createDeps.createIssue({
        projectId: prepared.projectId,
        subject: prepared.parsed.subject,
        description: prepared.parsed.description,
        trackerId: resolved.trackerId,
        priorityId: resolved.priorityId,
        statusId: resolved.statusId,
        startDate: prepared.parsed.metadata.start_date || undefined,
        dueDate: prepared.parsed.metadata.due_date || undefined,
        uploads: prepared.uploadTokens.length > 0 ? prepared.uploadTokens : undefined,
      });

      if (!createdId) {
        return {
          ok: false,
          commitUnknown: false,
          error: new Error("Failed to create issue"),
          outcome: { kind: "failed_before_commit", error: new Error("Failed to create issue") },
        };
      }

      return {
        ok: true,
        createdRemoteId: createdId,
        projectId: prepared.projectId,
        remoteUpdatedAt: new Date().toISOString(),
      };
    } catch (err) {
      const commitUnknown = isRemoteCommitUnknownError(err);
      return {
        ok: false,
        commitUnknown,
        error: err as Error,
        outcome: commitUnknown
          ? { kind: "commit_unknown", operationId: operation.operationId, message: (err as Error).message }
          : { kind: "failed_before_commit", error: err as Error },
      };
    }
  }

  public async reconcileRemote(
    operation: UnifiedSyncOperation<TicketCreateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{
    ok: true;
    remoteId?: number;
    projectId?: number;
    remoteUpdatedAt?: string;
    canonical?: any;
  } | {
    ok: false;
    message: string;
  }> {
    const remoteId = operation.createdRemoteId;
    if (!remoteId) {
      return { ok: false, message: "Missing createdRemoteId for ticket_create reconciliation" };
    }
    const createDeps = { ...defaultCreateDeps, ...deps?.ticketCreate };
    try {
      const getDetail = createDeps.getIssueDetail ?? getIssueDetail;
      const detail = await getDetail(remoteId);
      return {
        ok: true,
        remoteId,
        projectId: detail.ticket.projectId,
        remoteUpdatedAt: detail.ticket.updatedAt,
        canonical: detail,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  public async finalizeLocal(
    operation: UnifiedSyncOperation<TicketCreateIntent>,
    reconciled: any,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true } | { ok: false; message: string; pending: "local_finalize" }> {
    const documentUri = operation.documentUri ?? operation.intent?.documentUri;
    const createdId = operation.createdRemoteId;
    if (!createdId) {
      return { ok: false, message: "No createdRemoteId", pending: "local_finalize" };
    }

    if (documentUri) {
      try {
        const uri = vscode.Uri.parse(documentUri);
        const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
        if (editor) {
          const parsed = operation.intent
            ? {
                subject: operation.intent.subject,
                description: operation.intent.description,
                metadata: operation.intent.metadata,
                layout: operation.intent.layout,
                metadataBlock: operation.intent.metadataBlock,
                controlFields: operation.intent.controlFields,
              }
            : parseTicketEditorContent(editor.document.getText(), {
                allowMissingMetadata: true,
                fallbackMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
              });
          const canonicalParsed = reconciled?.ticket
            ? editorContentFromTicket(reconciled.ticket, parsed)
            : parsed;
          await rewriteNewTicketEditorToTicketMode({
            operationScope: context.connectionScope,
            editor,
            createdId,
            projectId: operation.projectId ?? reconciled?.ticket?.projectId ?? 0,
            parsed: canonicalParsed,
            lastKnownRemoteUpdatedAt: reconciled?.ticket?.updatedAt,
          });
        }
      } catch (err) {
        return { ok: false, message: (err as Error).message, pending: "local_finalize" };
      }
    }

    const draftId = operation.key?.kind === "newTicket" ? operation.key.queueId : undefined;
    if (draftId) {
      markNewTicketDraftSynced(draftId, createdId);
    }
    return { ok: true };
  }
}

export interface PreparedTicketUpdate {
  ticketId: number;
  changes: any;
  uniqueChildren: string[];
  uploadSummary?: any;
  conflictContext?: any;
}

export class TicketUpdateHandler implements OperationHandler<TicketUpdateIntent, PreparedTicketUpdate> {
  public async prepare(
    operation: UnifiedSyncOperation<TicketUpdateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: PreparedTicketUpdate } | { ok: false; outcome: SyncOutcome }> {
    const intent = operation.intent;
    const ticketId = operation.ticketId ?? intent?.ticketId;
    if (!ticketId || !intent) {
      return { ok: false, outcome: { kind: "failed_before_commit", error: new Error("Missing TicketUpdateIntent") } };
    }

    const saveDeps = { ...defaultTicketDeps, ...deps?.ticketUpdate };

    // 1. 変更計算
    const contentChanges = {
      ...(intent.subject !== intent.baseSubject ? { subject: intent.subject } : {}),
      ...(intent.description !== intent.baseDescription ? { description: intent.description } : {}),
    };

    const metadataChanges: any = {};
    if (intent.metadata && intent.baseMetadata) {
      if (intent.metadata.tracker !== intent.baseMetadata.tracker) {metadataChanges.tracker = intent.metadata.tracker;}
      if (intent.metadata.status !== intent.baseMetadata.status) {metadataChanges.status = intent.metadata.status;}
      if (intent.metadata.priority !== intent.baseMetadata.priority) {metadataChanges.priority = intent.metadata.priority;}
      if (intent.metadata.assignee !== intent.baseMetadata.assignee) {metadataChanges.assignee = intent.metadata.assignee;}
      if (intent.metadata.start_date !== intent.baseMetadata.start_date) {metadataChanges.startDate = intent.metadata.start_date;}
      if (intent.metadata.due_date !== intent.baseMetadata.due_date) {metadataChanges.dueDate = intent.metadata.due_date;}
      if (intent.metadata.done_ratio !== intent.baseMetadata.done_ratio) {metadataChanges.doneRatio = intent.metadata.done_ratio;}
      if (intent.metadata.estimated_hours !== intent.baseMetadata.estimated_hours) {metadataChanges.estimatedHours = intent.metadata.estimated_hours;}
      if (intent.metadata.parent !== intent.baseMetadata.parent) {metadataChanges.parentId = intent.metadata.parent;}
    } else if (intent.metadata) {
      if (intent.metadata.tracker) {metadataChanges.tracker = intent.metadata.tracker;}
      if (intent.metadata.status) {metadataChanges.status = intent.metadata.status;}
      if (intent.metadata.priority) {metadataChanges.priority = intent.metadata.priority;}
      if (intent.metadata.assignee) {metadataChanges.assignee = intent.metadata.assignee;}
      if (intent.metadata.start_date) {metadataChanges.startDate = intent.metadata.start_date;}
      if (intent.metadata.due_date) {metadataChanges.dueDate = intent.metadata.due_date;}
    }

    // 2. メタデータの解決 (IDマッピング)
    let remoteDetail: any = undefined;
    const ensureRemoteDetail = async () => {
      if (!remoteDetail) {
        const getDetail = saveDeps.getIssueDetail ?? getIssueDetail;
        remoteDetail = await getDetail(ticketId);
      }
      return remoteDetail;
    };

    let resolvedMetadataFields: any = {};
    if (Object.keys(metadataChanges).length > 0) {
      try {
        const [statuses, trackers, priorities] = await Promise.all([
          saveDeps.listIssueStatuses ? saveDeps.listIssueStatuses() : Promise.resolve([]),
          saveDeps.listTrackers ? saveDeps.listTrackers() : Promise.resolve([]),
          saveDeps.listIssuePriorities ? saveDeps.listIssuePriorities() : Promise.resolve([]),
        ]);

        if (metadataChanges.tracker) {
          const match = trackers.find((t: any) => t.name === metadataChanges.tracker);
          if (match) {resolvedMetadataFields.trackerId = match.id;}
        }
        if (metadataChanges.status) {
          const match = statuses.find((s: any) => s.name === metadataChanges.status);
          if (match) {resolvedMetadataFields.statusId = match.id;}
        }
        if (metadataChanges.priority) {
          const match = priorities.find((p: any) => p.name === metadataChanges.priority);
          if (match) {resolvedMetadataFields.priorityId = match.id;}
        }
        if (metadataChanges.startDate !== undefined) {resolvedMetadataFields.startDate = metadataChanges.startDate;}
        if (metadataChanges.dueDate !== undefined) {resolvedMetadataFields.dueDate = metadataChanges.dueDate;}
        if (metadataChanges.doneRatio !== undefined) {resolvedMetadataFields.doneRatio = metadataChanges.doneRatio;}
        if (metadataChanges.estimatedHours !== undefined) {resolvedMetadataFields.estimatedHours = metadataChanges.estimatedHours;}
        if (metadataChanges.parentId !== undefined) {resolvedMetadataFields.parentId = metadataChanges.parentId;}
      } catch (err) {
        return { ok: false, outcome: { kind: "failed_before_commit", ticketId, error: err as Error } };
      }
    }

    const changes = {
      ...(contentChanges.subject ? { subject: contentChanges.subject } : (intent.subject ? { subject: intent.subject } : {})),
      ...(contentChanges.description ? { description: contentChanges.description } : (intent.description ? { description: intent.description } : {})),
      ...resolvedMetadataFields,
    };

    // 3. コンフリクト検出
    if (intent.lastKnownRemoteUpdatedAt) {
      try {
        const remote = await ensureRemoteDetail();
        if (remote.ticket.updatedAt && remote.ticket.updatedAt !== intent.lastKnownRemoteUpdatedAt) {
          return {
            ok: false,
            outcome: {
              kind: "conflict",
              ticketId,
              message: vscode.l10n.t("Remote changes detected. Refresh before saving."),
              conflictContext: {
                ticketId,
                baseSubject: intent.baseSubject,
                baseDescription: intent.baseDescription,
                localSubject: intent.subject,
                localDescription: intent.description,
                remoteSubject: remote.ticket.subject,
                remoteDescription: remote.ticket.description ?? "",
                remoteMetadata: {
                  tracker: remote.ticket.trackerName ?? "",
                  status: remote.ticket.statusName ?? "",
                  priority: remote.ticket.priorityName ?? "",
                  start_date: remote.ticket.startDate ?? "",
                  due_date: remote.ticket.dueDate ?? "",
                  children: [],
                },
                remoteUpdatedAt: remote.ticket.updatedAt,
              },
            },
          };
        }
      } catch (err) {
        return { ok: false, outcome: { kind: "failed_before_commit", ticketId, error: err as Error } };
      }
    }

    const children = intent.metadata?.children ?? [];
    const uniqueChildren = Array.from(new Set(children.map((c) => c.trim()).filter((c) => c.length > 0)));

    return {
      ok: true,
      prepared: {
        ticketId,
        changes,
        uniqueChildren,
      },
    };
  }

  public async executeSecondaryEffects(
    operation: UnifiedSyncOperation<TicketUpdateIntent>,
    prepared: PreparedTicketUpdate,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true } | { ok: false; error: Error; commitUnknown?: boolean }> {
    // 子チケット作成等の Saga があれば実行
    return { ok: true };
  }

  public async executeRemoteWrite(
    operation: UnifiedSyncOperation<TicketUpdateIntent>,
    prepared: PreparedTicketUpdate,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{
    ok: true;
    createdRemoteId?: number;
    projectId?: number;
    remoteUpdatedAt?: string;
  } | {
    ok: false;
    commitUnknown: boolean;
    error: Error;
    outcome?: SyncOutcome;
  }> {
    const ticketId = prepared.ticketId;
    const saveDeps = { ...defaultTicketDeps, ...deps?.ticketUpdate };

    try {
      if (Object.keys(prepared.changes).length > 0) {
        await saveDeps.updateIssue({ issueId: ticketId, fields: prepared.changes });
      }

      return {
        ok: true,
        createdRemoteId: ticketId,
        remoteUpdatedAt: new Date().toISOString(),
      };
    } catch (err) {
      const commitUnknown = isRemoteCommitUnknownError(err);
      return {
        ok: false,
        commitUnknown,
        error: err as Error,
        outcome: commitUnknown
          ? { kind: "commit_unknown", operationId: operation.operationId, ticketId, message: (err as Error).message }
          : { kind: "failed_before_commit", ticketId, error: err as Error },
      };
    }
  }

  public async reconcileRemote(
    operation: UnifiedSyncOperation<TicketUpdateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{
    ok: true;
    remoteId?: number;
    projectId?: number;
    remoteUpdatedAt?: string;
    canonical?: any;
  } | {
    ok: false;
    message: string;
  }> {
    const ticketId = operation.ticketId ?? operation.intent?.ticketId;
    if (!ticketId) {
      return { ok: false, message: "Missing ticketId" };
    }
    const saveDeps = { ...defaultTicketDeps, ...deps?.ticketUpdate };
    try {
      const getDetail = saveDeps.getIssueDetail ?? getIssueDetail;
      const detail = await getDetail(ticketId);
      return {
        ok: true,
        remoteId: ticketId,
        projectId: detail.ticket.projectId,
        remoteUpdatedAt: detail.ticket.updatedAt,
        canonical: detail,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  public async finalizeLocal(
    operation: UnifiedSyncOperation<TicketUpdateIntent>,
    reconciled: any,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true } | { ok: false; message: string; pending: "local_finalize" }> {
    const ticketId = operation.ticketId ?? operation.intent?.ticketId;
    if (!ticketId) {
      return { ok: false, message: "Missing ticketId", pending: "local_finalize" };
    }
    if (operation.intent) {
      updateDraftAfterSave(
        ticketId,
        operation.intent.subject,
        operation.intent.description,
        operation.intent.metadata,
        reconciled?.ticket?.updatedAt,
        context.connectionScope,
      );
    }
    return { ok: true };
  }
}

export class CommentCreateHandler implements OperationHandler<CommentCreateIntent, {
  ticketId: number;
  body: string;
  uploads: UploadToken[];
  uploadSummary?: any;
}> {
  public async prepare(
    operation: UnifiedSyncOperation<CommentCreateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: { ticketId: number; body: string; uploads: UploadToken[]; uploadSummary?: any } } | { ok: false; outcome: SyncOutcome }> {
    const intent = operation.intent;
    const ticketId = operation.ticketId ?? intent?.ticketId;
    if (!ticketId || !intent) {
      return { ok: false, outcome: { kind: "failed_before_commit", error: new Error("Missing CommentCreateIntent") } };
    }

    const commentDeps = { ...defaultCommentDeps, ...deps?.comment };
    const rawBody = intent.body ?? "";

    if (containsConflictMarkers(rawBody)) {
      return { ok: false, outcome: { kind: "failed_before_commit", ticketId, error: new Error(vscode.l10n.t("Resolve all merge conflict markers before syncing.")) } };
    }

    const uploadResult = await processMarkdownImageUploads({
      content: rawBody,
      baseDir: intent.baseDir,
      uploadFile: commentDeps.uploadFile,
    });

    if (hasMarkdownImageUploadFailure(uploadResult.summary)) {
      const message = buildMarkdownImageUploadFailureMessage(uploadResult.summary) ?? vscode.l10n.t("Failed to upload attached image.");
      return { ok: false, outcome: { kind: "failed_before_commit", ticketId, error: new Error(message) } };
    }

    const validation = validateComment(uploadResult.content);
    if (!validation.valid) {
      return { ok: false, outcome: { kind: "failed_before_commit", ticketId, error: new Error(validation.message ?? "Invalid comment.") } };
    }

    return {
      ok: true,
      prepared: {
        ticketId,
        body: uploadResult.content,
        uploads: uploadResult.uploads,
        uploadSummary: resolveUploadSummary(uploadResult.summary),
      },
    };
  }

  public async executeRemoteWrite(
    operation: UnifiedSyncOperation<CommentCreateIntent>,
    prepared: { ticketId: number; body: string; uploads: UploadToken[]; uploadSummary?: any },
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{
    ok: true;
    createdRemoteId?: number;
    projectId?: number;
    remoteUpdatedAt?: string;
  } | {
    ok: false;
    commitUnknown: boolean;
    error: Error;
    outcome?: SyncOutcome;
  }> {
    const commentDeps = { ...defaultCommentDeps, ...deps?.comment };
    try {
      await commentDeps.addComment(
        prepared.ticketId,
        prepared.body,
        prepared.uploads.length > 0 ? prepared.uploads : undefined,
      );

      return {
        ok: true,
        projectId: operation.projectId,
        remoteUpdatedAt: new Date().toISOString(),
      };
    } catch (err) {
      const commitUnknown = isRemoteCommitUnknownError(err);
      return {
        ok: false,
        commitUnknown,
        error: err as Error,
        outcome: commitUnknown
          ? { kind: "commit_unknown", operationId: operation.operationId, ticketId: prepared.ticketId, message: (err as Error).message }
          : { kind: "failed_before_commit", ticketId: prepared.ticketId, error: err as Error },
      };
    }
  }

  public async reconcileRemote(
    operation: UnifiedSyncOperation<CommentCreateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{
    ok: true;
    remoteId?: number;
    projectId?: number;
    remoteUpdatedAt?: string;
    canonical?: any;
  } | {
    ok: false;
    message: string;
  }> {
    const ticketId = operation.ticketId ?? operation.intent?.ticketId;
    if (!ticketId) {
      return { ok: false, message: "Missing ticketId" };
    }
    const commentDeps = { ...defaultCommentDeps, ...deps?.comment };
    const identity = await reconcileCommentCommitUnknown(
      {
        ticketId,
        commentId: operation.commentId,
        body: operation.intent?.body ?? "",
        documentUri: operation.documentUri,
        operationId: operation.operationId,
        phase: operation.phase as any,
        revision: operation.revision,
      },
      commentDeps,
    );

    if (!identity.ok) {
      return { ok: false, message: identity.message };
    }

    return {
      ok: true,
      remoteId: identity.commentId,
      projectId: identity.projectId,
      remoteUpdatedAt: new Date().toISOString(),
    };
  }

  public async finalizeLocal(
    operation: UnifiedSyncOperation<CommentCreateIntent>,
    reconciled: any,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true } | { ok: false; message: string; pending: "local_finalize" }> {
    const ticketId = operation.ticketId ?? operation.intent?.ticketId;
    if (!ticketId) {
      return { ok: false, message: "Missing ticketId", pending: "local_finalize" };
    }

    const documentUri = operation.documentUri ?? operation.intent?.documentUri;
    const commentId = operation.createdRemoteId ?? reconciled?.remoteId;

    if (documentUri && commentId) {
      const uri = vscode.Uri.parse(documentUri);
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      if (doc) {
        finalizeNewCommentDraftDocument({
          document: doc,
          ticketId,
          commentId,
          projectId: operation.projectId ?? reconciled?.projectId ?? 0,
          operationScope: context.connectionScope,
        });
      }
      if ((operation.intent as any)?.finalizeDraft || (operation.payload as any)?.finalizeDraft) {
        const res = await finalizeNewCommentDraftFileAfterSync({
          documentUri,
          ticketId,
          commentId,
          projectId: operation.projectId ?? reconciled?.projectId,
          expectedDocumentBody: operation.intent?.body ?? "",
          syncedBody: operation.intent?.body ?? "",
        });
        if (res !== "applied") {
          return { ok: false, message: `Local finalization pending: ${res}`, pending: "local_finalize" };
        }
      }
    }

    return { ok: true };
  }
}

export class CommentUpdateHandler implements OperationHandler<CommentUpdateIntent, {
  ticketId: number;
  commentId: number;
  body: string;
  uploads: UploadToken[];
  uploadSummary?: any;
}> {
  public async prepare(
    operation: UnifiedSyncOperation<CommentUpdateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: { ticketId: number; commentId: number; body: string; uploads: UploadToken[]; uploadSummary?: any } } | { ok: false; outcome: SyncOutcome }> {
    const intent = operation.intent;
    const ticketId = operation.ticketId ?? intent?.ticketId;
    const commentId = operation.commentId ?? intent?.commentId;
    if (!ticketId || !commentId || !intent) {
      return { ok: false, outcome: { kind: "failed_before_commit", error: new Error("Missing CommentUpdateIntent") } };
    }

    const commentDeps = { ...defaultCommentDeps, ...deps?.comment };
    const nextContent = intent.body ?? "";

    if (containsConflictMarkers(nextContent)) {
      return { ok: false, outcome: { kind: "failed_before_commit", ticketId, commentId, error: new Error(vscode.l10n.t("Resolve all merge conflict markers before syncing.")) } };
    }

    if (intent.baseBody && nextContent === intent.baseBody) {
      return { ok: false, outcome: { kind: "no_change", ticketId, commentId } };
    }

    const uploadResult = await processMarkdownImageUploads({
      content: nextContent,
      baseDir: intent.baseDir,
      uploadFile: commentDeps.uploadFile,
    });

    if (hasMarkdownImageUploadFailure(uploadResult.summary)) {
      const message = buildMarkdownImageUploadFailureMessage(uploadResult.summary) ?? vscode.l10n.t("Failed to upload attached image.");
      return { ok: false, outcome: { kind: "failed_before_commit", ticketId, commentId, error: new Error(message) } };
    }

    // コンフリクト検出
    if (intent.sourceNotesHash) {
      try {
        const detail = await commentDeps.getIssueDetail(ticketId);
        const remoteComment = detail.comments.find((c) => c.id === commentId);
        if (remoteComment) {
          const remoteHash = computeNotesHash(remoteComment.body);
          if (remoteHash !== intent.sourceNotesHash) {
            return {
              ok: false,
              outcome: {
                kind: "conflict",
                ticketId,
                commentId,
                message: vscode.l10n.t("Comment was updated in Redmine. Review the diff before syncing."),
              },
            };
          }
        }
      } catch (err) {
        // non-fatal
      }
    }

    return {
      ok: true,
      prepared: {
        ticketId,
        commentId,
        body: uploadResult.content,
        uploads: uploadResult.uploads,
        uploadSummary: resolveUploadSummary(uploadResult.summary),
      },
    };
  }

  public async executeRemoteWrite(
    operation: UnifiedSyncOperation<CommentUpdateIntent>,
    prepared: { ticketId: number; commentId: number; body: string; uploads: UploadToken[]; uploadSummary?: any },
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{
    ok: true;
    createdRemoteId?: number;
    projectId?: number;
    remoteUpdatedAt?: string;
  } | {
    ok: false;
    commitUnknown: boolean;
    error: Error;
    outcome?: SyncOutcome;
  }> {
    const commentDeps = { ...defaultCommentDeps, ...deps?.comment };
    try {
      await commentDeps.updateComment(
        prepared.commentId,
        prepared.body,
        prepared.uploads.length > 0 ? prepared.uploads : undefined,
      );

      return {
        ok: true,
        createdRemoteId: prepared.commentId,
        remoteUpdatedAt: new Date().toISOString(),
      };
    } catch (err) {
      const commitUnknown = isRemoteCommitUnknownError(err);
      return {
        ok: false,
        commitUnknown,
        error: err as Error,
        outcome: commitUnknown
          ? { kind: "commit_unknown", operationId: operation.operationId, ticketId: prepared.ticketId, commentId: prepared.commentId, message: (err as Error).message }
          : { kind: "failed_before_commit", ticketId: prepared.ticketId, commentId: prepared.commentId, error: err as Error },
      };
    }
  }

  public async reconcileRemote(
    operation: UnifiedSyncOperation<CommentUpdateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{
    ok: true;
    remoteId?: number;
    projectId?: number;
    remoteUpdatedAt?: string;
    canonical?: any;
  } | {
    ok: false;
    message: string;
  }> {
    const ticketId = operation.ticketId ?? operation.intent?.ticketId;
    if (!ticketId) {
      return { ok: false, message: "Missing ticketId" };
    }
    const commentDeps = { ...defaultCommentDeps, ...deps?.comment };
    try {
      const detail = await commentDeps.getIssueDetail(ticketId);
      return {
        ok: true,
        remoteId: operation.commentId,
        projectId: detail.ticket.projectId,
        remoteUpdatedAt: detail.ticket.updatedAt,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  public async finalizeLocal(
    operation: UnifiedSyncOperation<CommentUpdateIntent>,
    reconciled: any,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true } | { ok: false; message: string; pending: "local_finalize" }> {
    const documentUri = operation.documentUri ?? operation.intent?.documentUri;
    const body = operation.intent?.body ?? "";
    if (documentUri) {
      const res = await updateCommentUpdateFileAfterSync(
        documentUri,
        body,
        reconciled?.ticket?.updatedAt,
      );
      if (res !== "applied") {
        return { ok: false, message: `Local finalization pending: ${res}`, pending: "local_finalize" };
      }
    }
    return { ok: true };
  }
}
