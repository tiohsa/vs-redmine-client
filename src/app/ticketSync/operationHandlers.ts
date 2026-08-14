import * as vscode from "vscode";
import type { IssueUploadInput } from "../../redmine/issues";
import { getIssueDetail, updateIssue } from "../../redmine/issues";
import { addComment, updateComment } from "../../redmine/comments";
import { getCurrentUserId } from "../../redmine/users";
import { uploadClipboardImage, uploadFileAttachment } from "../../redmine/attachments";
import { buildTicketEditorContent, parseTicketEditorContent, type TicketEditorContent } from "../../views/ticketEditorContent";
import { editorContentFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import {
  computeChanges,
  computeMetadataChanges,
  resolveMetadataForCreate,
  resolveMetadataUpdates,
} from "../../views/ticketSync/ticketMetadataResolver";
import { rewriteNewTicketEditorToTicketMode } from "../../views/ticketSync/ticketEditorRewrite";
import { compareAndRewriteDocumentWithRegisteredFields } from "../../views/editorDocumentRewrite";
import { updateDraftAfterSave } from "../../views/ticketDraftStore";
import { markNewTicketDraftSynced } from "../../views/newTicketDraftStore";
import { rebaseTicketEditorContent } from "./ticketIntentRebase";
import {
  getOfflineSyncQueue,
  planOfflineSyncEffectAsync,
  transitionOfflineSyncEffectAsync,
  updateOfflineNewTicketAsync,
} from "../../views/offlineSyncStore";
import { registerTicketDocument, removeTicketEditorByUri } from "../../views/ticketEditorRegistry";
import type { TicketCreateDependencies, TicketSaveDependencies } from "../../views/ticketSync/types";
import { defaultCreateDeps, defaultDeps as defaultTicketDeps } from "../../views/ticketSync/ticketSyncDeps";
import {
  finalizeNewCommentDraftDocument,
  normalizeCommentBody,
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

import type { DocumentPort } from "./ports";

export interface OperationHandlerDeps {
  ticketCreate?: Partial<TicketCreateDependencies>;
  ticketUpdate?: Partial<TicketSaveDependencies>;
  comment?: Partial<CommentSaveDependencies>;
  documents?: DocumentPort;
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

export type PreparedTicketCreate = {
  parsed: TicketEditorContent;
  projectId: number;
  uploadTokens: IssueUploadInput[];
  resolved?: any;
};

export class TicketCreateHandler implements OperationHandler<TicketCreateIntent, PreparedTicketCreate> {
  public async prepare(
    operation: UnifiedSyncOperation<TicketCreateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: PreparedTicketCreate } | { ok: false; outcome: SyncOutcome }> {
    const intent = operation.intent;
    if (!intent) {
      return { ok: false, outcome: { kind: "failed_before_commit", error: new Error("Missing TicketCreateIntent") } };
    }

    let parsed: TicketEditorContent;
    if (typeof intent.content === "string" && intent.content.trim().length > 0) {
      try {
        parsed = parseTicketEditorContent(intent.content, {
          allowMissingMetadata: true,
          allowMissingSubject: true,
          fallbackMetadata: intent.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
        });
      } catch (err) {
        return { ok: false, outcome: { kind: "failed_before_commit", error: err as Error } };
      }
      if (intent.subject && !parsed.subject) {
        parsed.subject = intent.subject;
      }
      if (intent.description && !parsed.description) {
        parsed.description = intent.description;
      }
      if (intent.metadata) {
        parsed.metadata = { ...parsed.metadata, ...intent.metadata };
      }
    } else if (typeof intent.description === "string" && !intent.subject && !intent.metadata?.tracker) {
      try {
        parsed = parseTicketEditorContent(intent.description, {
          allowMissingMetadata: true,
          allowMissingSubject: true,
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

    const createDeps: any = deps?.ticketCreate
      ? { ...defaultCreateDeps, ...deps.ticketCreate, getProjectTrackers: deps.ticketCreate.getProjectTrackers }
      : { ...defaultCreateDeps };
    let resolved: any = undefined;
    try {
      resolved = await resolveMetadataForCreate(
        parsed.metadata,
        createDeps,
        projectId,
      );
    } catch (err) {
      return {
        ok: false,
        outcome: { kind: "failed_before_commit", error: err as Error },
      };
    }

    return {
      ok: true,
      prepared: {
        parsed,
        projectId,
        uploadTokens,
        resolved,
      },
    };
  }

  public async executeSecondaryEffects(
    operation: UnifiedSyncOperation<TicketCreateIntent>,
    prepared: { parsed: TicketEditorContent; projectId: number; uploadTokens: IssueUploadInput[]; resolved?: any },
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; uploadTokens?: IssueUploadInput[] } | { ok: false; error: Error; commitUnknown?: boolean }> {
    const attachments = operation.intent?.attachments ?? [];
    const tokens: IssueUploadInput[] = [...prepared.uploadTokens];
    const createDeps = { ...defaultCreateDeps, ...deps?.ticketCreate };

    for (const att of attachments) {
      if (att.kind === "token") {
        if (!tokens.some((t) => t.token === att.token)) {
          tokens.push({ token: att.token, filename: att.filename ?? "attachment", content_type: att.contentType ?? "application/octet-stream" });
        }
      } else if (att.kind === "file") {
        if (tokens.some((t) => t.filename === att.filename)) {
          continue;
        }
        try {
          const uploadFn = (createDeps as any).uploadFile ?? uploadFileAttachment;
          const res = await uploadFn(att.filePath);
          tokens.push({ token: res.token, filename: att.filename ?? res.filename, content_type: att.contentType ?? res.contentType });
        } catch (err) {
          return { ok: false, error: err as Error, commitUnknown: isRemoteCommitUnknownError(err) };
        }
      } else if (att.kind === "clipboard") {
        if (tokens.some((t) => t.filename === att.filename || (tokens.length > 0 && att.filename === undefined))) {
          continue;
        }
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
    prepared: { parsed: TicketEditorContent; projectId: number; uploadTokens: IssueUploadInput[]; resolved?: any },
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
    const createDeps: any = deps?.ticketCreate
      ? { ...defaultCreateDeps, ...deps.ticketCreate, getProjectTrackers: deps.ticketCreate.getProjectTrackers }
      : { ...defaultCreateDeps };
    let resolved: any = prepared.resolved;
    if (!resolved) {
      try {
        resolved = await resolveMetadataForCreate(
          prepared.parsed.metadata,
          createDeps,
          prepared.projectId,
        );
      } catch (err) {
        return {
          ok: false,
          commitUnknown: false,
          error: err as Error,
          outcome: { kind: "failed_before_commit", error: err as Error },
        };
      }
    }

    const operationId = operation.operationId ?? (operation.key?.kind === "newTicket" ? operation.key.queueId : "newTicket");
    const revision = operation.intentRevision ?? operation.revision ?? 1;

    let createdId = operation.createdRemoteId;

    if (!createdId) {
      if (operationId) {
        await planOfflineSyncEffectAsync(
          operationId,
          {
            effectId: "ticket-create",
            kind: "ticket_create",
            operationRevision: revision,
            state: "planned",
            target: { documentUri: operation.documentUri },
          },
          context.connectionScope,
          revision,
        );

        await transitionOfflineSyncEffectAsync(
          operationId,
          "ticket-create",
          { kind: "start" },
          context.connectionScope,
          { operationRevision: revision, sourceState: "planned" },
        );
      }

      try {
        createdId = await createDeps.createIssue({
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
          throw new Error("Failed to create issue");
        }

        if (operationId) {
          await transitionOfflineSyncEffectAsync(
            operationId,
            "ticket-create",
            { kind: "commit", remoteId: createdId },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
          await updateOfflineNewTicketAsync(
            { queueId: operation.key?.kind === "newTicket" ? operation.key.queueId : operationId, documentUri: operation.documentUri },
            { createdIssueId: createdId },
            context.connectionScope,
          );
        }
      } catch (err) {
        const commitUnknown = isRemoteCommitUnknownError(err);
        if (operationId) {
          await transitionOfflineSyncEffectAsync(
            operationId,
            "ticket-create",
            commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
        }
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

    // Children creation
    const children = prepared.parsed.metadata?.children ?? [];
    const uniqueChildren = Array.from(new Set(children.map((c) => c.trim()).filter((c) => c.length > 0)));

    for (let ordinal = 0; ordinal < uniqueChildren.length; ordinal++) {
      const subject = uniqueChildren[ordinal];
      const effectId = `child-create:${ordinal}`;

      const queueTicket = getOfflineSyncQueue(context.connectionScope).newTickets.find((t) => (operationId && t.operationId === operationId) || (operationId && t.queueId === operationId));
      const queueEffects = queueTicket?.effects ?? [];
      const existingEffect = queueEffects.find((e: any) => e.effectId === effectId) ?? operation.effects?.find((e: any) => e.effectId === effectId);
      if (
        (existingEffect?.state === "committed" && existingEffect.remoteId) ||
        existingEffect?.state === "commit_unknown" ||
        existingEffect?.state === "compensation_unknown" ||
        existingEffect?.state === "compensation_started" ||
        existingEffect?.state === "failed"
      ) {
        continue;
      }

      if (operationId) {
        await planOfflineSyncEffectAsync(
          operationId,
          {
            effectId,
            kind: "child_create",
            operationRevision: revision,
            state: "planned",
            target: { parentTicketId: createdId, ordinal },
          },
          context.connectionScope,
          revision,
        );

        await transitionOfflineSyncEffectAsync(
          operationId,
          effectId,
          { kind: "start" },
          context.connectionScope,
          { operationRevision: revision, sourceState: "planned" },
        );
      }

      try {
        const createdChildId = await createDeps.createIssue({
          subject,
          description: "",
          parentId: createdId,
          projectId: prepared.projectId,
        });
        if (!createdChildId) {
          throw new Error(`Failed to create child issue: ${subject}`);
        }
        if (operationId) {
          await transitionOfflineSyncEffectAsync(
            operationId,
            effectId,
            { kind: "commit", remoteId: createdChildId },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
        }
      } catch (err) {
        const commitUnknown = isRemoteCommitUnknownError(err);
        if (operationId) {
          await transitionOfflineSyncEffectAsync(
            operationId,
            effectId,
            commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
        }
        return {
          ok: false,
          error: err as Error,
          commitUnknown,
        };
      }
    }

    return {
      ok: true,
      createdRemoteId: createdId,
      projectId: prepared.projectId,
      remoteUpdatedAt: new Date().toISOString(),
    };
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
    const createdId = operation.createdRemoteId ?? operation.ticketId;
    if (!createdId) {
      return { ok: false, message: "No createdRemoteId", pending: "local_finalize" };
    }

    let detail = reconciled;
    if (!detail) {
      const getDetail = deps?.ticketCreate?.getIssueDetail ?? getIssueDetail;
      try {
        detail = await getDetail(createdId);
      } catch {
        // read-back optional in finalizeLocal
      }
    }

    const canonical = detail?.ticket ? editorContentFromTicket(detail.ticket) : undefined;
    const subject = canonical?.subject ?? operation.intent?.subject ?? "";
    const description = canonical?.description ?? operation.intent?.description ?? "";
    const metadata = canonical?.metadata ?? operation.intent?.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] };
    const remoteUpdatedAt = detail?.ticket?.updatedAt ?? operation.remoteUpdatedAt;

    updateDraftAfterSave(
      createdId,
      subject,
      description,
      metadata,
      remoteUpdatedAt,
      context.connectionScope,
    );

    if (documentUri) {
      try {
        const replacement = (operation.nextIntent && canonical)
          ? rebaseTicketEditorContent(
              {
                subject: operation.intent?.subject ?? "",
                description: operation.intent?.description ?? "",
                metadata: operation.intent?.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
                layout: operation.intent?.layout,
                metadataBlock: operation.intent?.metadataBlock,
                controlFields: operation.intent?.controlFields,
              },
              canonical,
              {
                subject: operation.nextIntent.subject,
                description: operation.nextIntent.description,
                metadata: operation.nextIntent.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
                layout: operation.nextIntent.layout,
                metadataBlock: operation.nextIntent.metadataBlock,
                controlFields: operation.nextIntent.controlFields,
              },
            )
          : canonical ?? {
              subject,
              description,
              metadata,
            };

        if (deps?.documents?.rewriteNewTicket) {
          const openDoc = deps.documents.findOpenDocument?.(documentUri);
          const source = operation.nextIntent
            ? {
                subject: operation.nextIntent.subject,
                description: operation.nextIntent.description,
                metadata: operation.nextIntent.metadata,
                layout: operation.nextIntent.layout,
                metadataBlock: operation.nextIntent.metadataBlock,
                controlFields: operation.nextIntent.controlFields,
              }
            : operation.intent
              ? {
                  subject: operation.intent.subject,
                  description: operation.intent.description,
                  metadata: operation.intent.metadata,
                  layout: operation.intent.layout,
                  metadataBlock: operation.intent.metadataBlock,
                  controlFields: operation.intent.controlFields,
                }
              : {
                  subject: "",
                  description: "",
                  metadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
                };
          const rewriteRes = await deps.documents.rewriteNewTicket({
            documentUri,
            ticketId: createdId,
            projectId: operation.projectId ?? reconciled?.ticket?.projectId ?? 0,
            replacement,
            expected: {
              content: openDoc?.getText() ?? buildTicketEditorContent(source),
              operationRevision: (operation.nextIntent as any)?.revision ?? operation.revision,
            },
          });
          if (rewriteRes.kind !== "applied") {
            return { ok: false, message: `Editor rewrite pending: ${rewriteRes.kind}`, pending: "local_finalize" };
          }
          if (openDoc) {
            removeTicketEditorByUri(vscode.Uri.parse(documentUri));
            registerTicketDocument(
              createdId,
              openDoc,
              "ticket",
              operation.projectId ?? reconciled?.ticket?.projectId,
              context.connectionScope,
            );
          }
        } else {
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

    const saveDeps: any = deps?.ticketUpdate
      ? {
          ...defaultTicketDeps,
          ...deps.ticketUpdate,
          getProjectTrackers: deps.ticketUpdate.getProjectTrackers,
          listProjectMembers: deps.ticketUpdate.listProjectMembers,
          searchUsers: deps.ticketUpdate.searchUsers,
        }
      : { ...defaultTicketDeps };

    // 1. 変更計算
    const contentChanges = computeChanges(
      intent.baseSubject ?? "",
      intent.baseDescription ?? "",
      intent.subject ?? "",
      intent.description ?? "",
    );
    if (intent.baseSubject === undefined && intent.subject !== undefined) {
      contentChanges.subject = intent.subject;
    }
    if (intent.baseDescription === undefined && intent.description !== undefined) {
      contentChanges.description = intent.description;
    }

    const metadataChanges = intent.baseMetadata && intent.metadata
      ? computeMetadataChanges(intent.baseMetadata, intent.metadata)
      : (intent.metadata ? computeMetadataChanges({ tracker: "", priority: "", status: "", due_date: "", children: [] }, intent.metadata) : {});

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
        let projectId = operation.projectId;
        if (!projectId) {
          try {
            const remote = await ensureRemoteDetail();
            projectId = remote?.ticket?.projectId;
          } catch {
            // non-fatal for project discovery
          }
        }
        resolvedMetadataFields = await resolveMetadataUpdates(metadataChanges, saveDeps, projectId);
      } catch (err) {
        return { ok: false, outcome: { kind: "failed_before_commit", ticketId, error: err as Error } };
      }
    }

    const changes = {
      ...(contentChanges.subject !== undefined ? { subject: contentChanges.subject } : {}),
      ...(contentChanges.description !== undefined ? { description: contentChanges.description } : {}),
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
    const ticketId = prepared.ticketId;
    const saveDeps = { ...defaultTicketDeps, ...deps?.ticketUpdate };
    const uniqueChildren = prepared.uniqueChildren;
    if (!uniqueChildren || uniqueChildren.length === 0) {
      return { ok: true };
    }

    const operationId = operation.operationId ?? `ticket:${ticketId}`;
    const revision = operation.revision ?? 1;

    for (let ordinal = 0; ordinal < uniqueChildren.length; ordinal++) {
      const subject = uniqueChildren[ordinal];
      const effectId = `child-create:${ordinal}`;

      const queueEffects = getOfflineSyncQueue(context.connectionScope).tickets.get(ticketId)?.effects ?? [];
      const existingEffect = queueEffects.find((e: any) => e.effectId === effectId) ?? operation.effects?.find((e: any) => e.effectId === effectId);
      if (
        (existingEffect?.state === "committed" && existingEffect.remoteId) ||
        existingEffect?.state === "commit_unknown" ||
        existingEffect?.state === "compensation_unknown" ||
        existingEffect?.state === "compensation_started" ||
        existingEffect?.state === "failed"
      ) {
        continue;
      }

      await planOfflineSyncEffectAsync(
        operationId,
        {
          effectId,
          kind: "child_create",
          operationRevision: revision,
          state: "planned",
          target: { parentTicketId: ticketId, ordinal },
        },
        context.connectionScope,
        revision,
      );

      await transitionOfflineSyncEffectAsync(
        operationId,
        effectId,
        { kind: "start" },
        context.connectionScope,
        { operationRevision: revision, sourceState: "planned" },
      );

      try {
        const createdChildId = await saveDeps.createIssue?.({
          subject,
          description: "",
          parentId: ticketId,
          projectId: operation.projectId ?? 0,
        });
        if (!createdChildId) {
          throw new Error(`Failed to create child issue: ${subject}`);
        }
        await transitionOfflineSyncEffectAsync(
          operationId,
          effectId,
          { kind: "commit", remoteId: createdChildId },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
        );
      } catch (err) {
        const commitUnknown = isRemoteCommitUnknownError(err);
        await transitionOfflineSyncEffectAsync(
          operationId,
          effectId,
          commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
        );

        if (!commitUnknown) {
          for (let prev = 0; prev < ordinal; prev++) {
            const prevEffectId = `child-create:${prev}`;
            const queueEffects = getOfflineSyncQueue(context.connectionScope).tickets.get(ticketId)?.effects ?? [];
            const prevEffect = queueEffects.find((e: any) => e.effectId === prevEffectId) ?? operation.effects?.find((e: any) => e.effectId === prevEffectId);
            if (prevEffect && prevEffect.state === "committed" && prevEffect.remoteId) {
              try {
                const startComp = await transitionOfflineSyncEffectAsync(
                  operationId,
                  prevEffectId,
                  { kind: "start_compensation" },
                  context.connectionScope,
                  { operationRevision: revision, sourceState: "committed" },
                );
                if (startComp) {
                  try {
                    await saveDeps.deleteIssue?.(prevEffect.remoteId);
                    await transitionOfflineSyncEffectAsync(
                      operationId,
                      prevEffectId,
                      { kind: "complete_compensation" },
                      context.connectionScope,
                      { operationRevision: revision, sourceState: "compensation_started" },
                    );
                  } catch (delErr) {
                    await transitionOfflineSyncEffectAsync(
                      operationId,
                      prevEffectId,
                      { kind: "mark_compensation_unknown", detail: (delErr as Error).message },
                      context.connectionScope,
                      { operationRevision: revision, sourceState: "compensation_started" },
                    );
                  }
                }
              } catch {
                // Ignore checkpoint failure to preserve committed child
              }
            }
          }
        }

        return {
          ok: false,
          error: err as Error,
          commitUnknown,
        };
      }
    }

    const finalQueueEffects = getOfflineSyncQueue(context.connectionScope).tickets.get(ticketId)?.effects ?? [];
    const hasFailedEffects = finalQueueEffects.some((e: any) => e.state === "failed");
    const hasUnknownEffects = finalQueueEffects.some((e: any) => e.state === "commit_unknown" || e.state === "compensation_unknown" || e.state === "compensation_started");
    if (hasUnknownEffects || hasFailedEffects) {
      return {
        ok: false,
        error: new Error("Secondary effects remain unresolved or failed"),
        commitUnknown: hasUnknownEffects,
      };
    }

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
    const operationId = operation.operationId ?? `ticket:${ticketId}`;
    const revision = operation.intentRevision ?? operation.revision ?? 1;

    await planOfflineSyncEffectAsync(
      operationId,
      {
        effectId: "ticket-update",
        kind: "ticket_update",
        operationRevision: revision,
        state: "planned",
        target: { ticketId },
      },
      context.connectionScope,
      revision,
    );

    await transitionOfflineSyncEffectAsync(
      operationId,
      "ticket-update",
      { kind: "start" },
      context.connectionScope,
      { operationRevision: revision, sourceState: "planned" },
    );

    try {
      if (Object.keys(prepared.changes).length > 0) {
        await saveDeps.updateIssue({ issueId: ticketId, fields: prepared.changes });
      }

      await transitionOfflineSyncEffectAsync(
        operationId,
        "ticket-update",
        { kind: "commit", remoteId: ticketId },
        context.connectionScope,
        { operationRevision: revision, sourceState: "started" },
      );

      return {
        ok: true,
        createdRemoteId: ticketId,
        remoteUpdatedAt: new Date().toISOString(),
      };
    } catch (err) {
      const commitUnknown = isRemoteCommitUnknownError(err);
      await transitionOfflineSyncEffectAsync(
        operationId,
        "ticket-update",
        commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message },
        context.connectionScope,
        { operationRevision: revision, sourceState: "started" },
      );
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

    let detail = reconciled;
    if (!detail) {
      const getDetail = deps?.ticketUpdate?.getIssueDetail ?? getIssueDetail;
      try {
        detail = await getDetail(ticketId);
      } catch {
        // read-back optional in finalizeLocal
      }
    }

    const canonical = detail?.ticket ? editorContentFromTicket(detail.ticket) : undefined;
    const subject = canonical?.subject ?? operation.intent?.subject ?? "";
    const description = canonical?.description ?? operation.intent?.description ?? "";
    const metadata = canonical?.metadata ?? operation.intent?.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] };
    const remoteUpdatedAt = detail?.ticket?.updatedAt ?? operation.remoteUpdatedAt;

    updateDraftAfterSave(
      ticketId,
      subject,
      description,
      metadata,
      remoteUpdatedAt,
      context.connectionScope,
    );

    const documentUri = operation.documentUri ?? operation.intent?.documentUri;
    if (documentUri && canonical) {
      const replacement = (operation.nextIntent && canonical)
        ? rebaseTicketEditorContent(
            {
              subject: operation.intent?.subject ?? "",
              description: operation.intent?.description ?? "",
              metadata: operation.intent?.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
              layout: operation.intent?.layout,
              metadataBlock: operation.intent?.metadataBlock,
              controlFields: operation.intent?.controlFields,
            },
            canonical,
            {
              subject: operation.nextIntent.subject,
              description: operation.nextIntent.description,
              metadata: operation.nextIntent.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
              layout: operation.nextIntent.layout,
              metadataBlock: operation.nextIntent.metadataBlock,
              controlFields: operation.nextIntent.controlFields,
            },
          )
        : canonical;

      if (deps?.documents?.rewriteTicket) {
        const openDoc = deps.documents.findOpenDocument?.(documentUri);
        const source = operation.nextIntent
          ? {
              subject: operation.nextIntent.subject,
              description: operation.nextIntent.description,
              metadata: operation.nextIntent.metadata,
              layout: operation.nextIntent.layout,
              metadataBlock: operation.nextIntent.metadataBlock,
              controlFields: operation.nextIntent.controlFields,
            }
          : {
              subject: operation.intent?.subject ?? "",
              description: operation.intent?.description ?? "",
              metadata: operation.intent?.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
              layout: operation.intent?.layout,
              metadataBlock: operation.intent?.metadataBlock,
              controlFields: operation.intent?.controlFields,
            };
        const rewriteRes = await deps.documents.rewriteTicket({
          documentUri,
          ticketId,
          projectId: operation.projectId ?? reconciled?.ticket?.projectId,
          replacement,
          expected: {
            content: openDoc?.getText() ?? buildTicketEditorContent(source),
            operationRevision: (operation.nextIntent as any)?.revision ?? operation.revision,
          },
        });
        if (rewriteRes.kind !== "applied") {
          return { ok: false, message: `Editor rewrite pending: ${rewriteRes.kind}`, pending: "local_finalize" };
        }
      } else {
        const openDoc = vscode.workspace.textDocuments.find(
          (doc) => doc.uri.toString() === documentUri,
        );
        if (openDoc) {
          const rewriteRes = await compareAndRewriteDocumentWithRegisteredFields({
            documentUri,
            ticketId,
            projectId: operation.projectId ?? reconciled?.ticket?.projectId,
            replacement: canonical,
            expected: {
              content: openDoc.getText(),
              operationRevision: operation.revision,
            },
          });
          if (rewriteRes.kind !== "applied") {
            return { ok: false, message: `Editor rewrite pending: ${rewriteRes.kind}`, pending: "local_finalize" };
          }
        }
      }
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
    const commentId = operation.commentId ?? operation.intent?.commentId;
    if (!commentId) {
      return { ok: false, message: "Missing commentId" };
    }
    const commentDeps = { ...defaultCommentDeps, ...deps?.comment };
    try {
      const detail = await commentDeps.getIssueDetail(ticketId);
      if (detail.ticket.id !== ticketId) {
        return { ok: false, message: "Ticket ID mismatch in reconciliation response" };
      }
      const remoteComment = detail.comments.find((c) => c.id === commentId);
      if (!remoteComment) {
        return { ok: false, message: `Comment #${commentId} not found on ticket #${ticketId}` };
      }
      const expectedBody = operation.intent?.body ?? "";
      if (operation.phase === "commit_unknown" && normalizeCommentBody(remoteComment.body) !== normalizeCommentBody(expectedBody)) {
        return { ok: false, message: "Remote comment body does not match intended update" };
      }
      return {
        ok: true,
        remoteId: commentId,
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
