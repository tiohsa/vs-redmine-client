import * as vscode from "vscode";
import type { IssueUploadInput } from "../../redmine/issues";
import { getIssueDetail } from "../../redmine/issues";
import { addComment, updateComment } from "../../redmine/comments";
import { uploadClipboardImage, uploadFileAttachment } from "../../redmine/attachments";
import { parseTicketEditorContent, type TicketEditorContent } from "../../views/ticketEditorContent";
import { editorContentFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import { resolveMetadataForCreate } from "../../views/ticketSync/ticketMetadataResolver";
import { rewriteNewTicketEditorToTicketMode } from "../../views/ticketSync/ticketEditorRewrite";
import { updateDraftAfterSave } from "../../views/ticketDraftStore";
import { markNewTicketDraftSynced } from "../../views/newTicketDraftStore";
import type { TicketCreateDependencies, TicketSaveDependencies } from "../../views/ticketSync/types";
import { defaultCreateDeps, defaultDeps as defaultTicketDeps } from "../../views/ticketSync/ticketSyncDeps";
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

export interface OperationHandlerContext {
  connectionScope: string;
}

export interface OperationHandlerDeps {
  ticketCreate?: Partial<TicketCreateDependencies>;
  ticketUpdate?: Partial<TicketSaveDependencies>;
  comment?: Partial<any>;
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

    for (const att of attachments) {
      if (att.kind === "token") {
        tokens.push({ token: att.token, filename: att.filename ?? "attachment", content_type: att.contentType ?? "application/octet-stream" });
      } else if (att.kind === "file") {
        try {
          const res = await uploadFileAttachment(att.filePath);
          tokens.push({ token: res.token, filename: att.filename ?? res.filename, content_type: att.contentType ?? res.contentType });
        } catch (err) {
          return { ok: false, error: err as Error, commitUnknown: isRemoteCommitUnknownError(err) };
        }
      } else if (att.kind === "clipboard") {
        try {
          const res = await uploadClipboardImage();
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
    const createDeps = { ...defaultCreateDeps, ...deps?.ticketCreate };
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

export class TicketUpdateHandler implements OperationHandler<TicketUpdateIntent> {
  public async prepare(
    operation: UnifiedSyncOperation<TicketUpdateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: any } | { ok: false; outcome: SyncOutcome }> {
    const ticketId = operation.ticketId ?? operation.intent?.ticketId;
    if (!ticketId) {
      return { ok: false, outcome: { kind: "failed_before_commit", error: new Error("Missing ticketId for TicketUpdate") } };
    }
    return { ok: true, prepared: { ticketId } };
  }

  public async executeRemoteWrite(
    operation: UnifiedSyncOperation<TicketUpdateIntent>,
    prepared: any,
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
    const intent = operation.intent;
    if (!intent) {
      return { ok: false, commitUnknown: false, error: new Error("Missing TicketUpdateIntent") };
    }

    try {
      const fields: any = {
        subject: intent.subject,
        description: intent.description,
      };

      await saveDeps.updateIssue({ issueId: ticketId, fields });
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

export class CommentCreateHandler implements OperationHandler<CommentCreateIntent> {
  public async prepare(
    operation: UnifiedSyncOperation<CommentCreateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: any } | { ok: false; outcome: SyncOutcome }> {
    const ticketId = operation.ticketId ?? operation.intent?.ticketId;
    if (!ticketId) {
      return { ok: false, outcome: { kind: "failed_before_commit", error: new Error("Missing ticketId for CommentCreate") } };
    }
    return { ok: true, prepared: { ticketId, body: operation.intent?.body ?? "" } };
  }

  public async executeRemoteWrite(
    operation: UnifiedSyncOperation<CommentCreateIntent>,
    prepared: any,
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
    const body = prepared.body;
    try {
      await addComment(ticketId, body);
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
          ? { kind: "commit_unknown", operationId: operation.operationId, ticketId, message: (err as Error).message }
          : { kind: "failed_before_commit", ticketId, error: err as Error },
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
    try {
      const detail = await getIssueDetail(ticketId);
      return {
        ok: true,
        remoteId: operation.createdRemoteId,
        projectId: detail.ticket.projectId,
        remoteUpdatedAt: detail.ticket.updatedAt,
        canonical: detail,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  public async finalizeLocal(
    operation: UnifiedSyncOperation<CommentCreateIntent>,
    reconciled: any,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true } | { ok: false; message: string; pending: "local_finalize" }> {
    return { ok: true };
  }
}

export class CommentUpdateHandler implements OperationHandler<CommentUpdateIntent> {
  public async prepare(
    operation: UnifiedSyncOperation<CommentUpdateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: any } | { ok: false; outcome: SyncOutcome }> {
    const ticketId = operation.ticketId ?? operation.intent?.ticketId;
    const commentId = operation.commentId ?? operation.intent?.commentId;
    if (!ticketId || !commentId) {
      return { ok: false, outcome: { kind: "failed_before_commit", error: new Error("Missing ticketId/commentId for CommentUpdate") } };
    }
    return { ok: true, prepared: { ticketId, commentId, body: operation.intent?.body ?? "" } };
  }

  public async executeRemoteWrite(
    operation: UnifiedSyncOperation<CommentUpdateIntent>,
    prepared: any,
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
    const commentId = prepared.commentId;
    const body = prepared.body;
    try {
      await updateComment(ticketId, commentId, body);
      return {
        ok: true,
        createdRemoteId: commentId,
        remoteUpdatedAt: new Date().toISOString(),
      };
    } catch (err) {
      const commitUnknown = isRemoteCommitUnknownError(err);
      return {
        ok: false,
        commitUnknown,
        error: err as Error,
        outcome: commitUnknown
          ? { kind: "commit_unknown", operationId: operation.operationId, ticketId, commentId, message: (err as Error).message }
          : { kind: "failed_before_commit", ticketId, commentId, error: err as Error },
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
    try {
      const detail = await getIssueDetail(ticketId);
      return {
        ok: true,
        remoteId: operation.commentId,
        projectId: detail.ticket.projectId,
        remoteUpdatedAt: detail.ticket.updatedAt,
        canonical: detail,
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
    return { ok: true };
  }
}


