import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type { IssueCreateInput, IssueUpdateInput, IssueUploadInput } from "../../redmine/issues";
import { createIssue, getIssueDetail, updateIssue } from "../../redmine/issues";
import { addComment, updateComment } from "../../redmine/comments";
import { getCurrentUserId } from "../../redmine/users";
import { parseClipboardImageDataUri, uploadClipboardImage, uploadFileAttachment } from "../../redmine/attachments";
import { buildTicketEditorContent, parseTicketEditorContent, type TicketEditorContent } from "../../views/ticketEditorContent";
import { editorContentFromTicket, metadataFromTicket } from "../../views/ticketSync/ticketRemoteContent";
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
  createSyncOperationRepository,
  type SyncOperationRepository,
} from "./syncRepository";
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
import { computeBufferHashAndSize, computeFileHashAndSize, computeFileHashAndSizeAsync } from "../../utils/fileHash";
import { classifyFailureDisposition } from "../../utils/redmineErrors";
import type { TicketUpdateFields, UploadToken } from "../../redmine/types";
import {
  isPrimaryEffectKind,
  type ChildTicketCreateRequestSnapshot,
  type CommentCreateRequestSnapshot,
  type CommentUpdateRequestSnapshot,
  type FailureDisposition,
  type SyncEffectRequestSnapshot,
  type TicketCreateRequestSnapshot,
  type TicketUpdateRequestSnapshot,
  type UploadRequestSnapshot,
} from "../syncEffects";
import type {
  CommentCreateIntent,
  CommentUpdateIntent,
  SyncIntent,
  SyncOperationKey,
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

export const normalizeTicketText = (text: string | undefined | null): string => {
  if (text === undefined || text === null) {
    return "";
  }
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
};

export const reconcileTicketCandidate = async (
  candidateTicketId: number,
  expected: { projectId?: number; subject?: string; description?: string },
  getIssueDetailFn: (id: number) => Promise<any>,
): Promise<
  | { ok: true; ticketId: number; projectId: number; remoteUpdatedAt: string; canonical: any }
  | { ok: false; message: string }
> => {
  try {
    const detail = await getIssueDetailFn(candidateTicketId);
    if (!detail || !detail.ticket) {
      return { ok: false, message: `Ticket #${candidateTicketId} not found.` };
    }
    const ticket = detail.ticket;
    if (expected.projectId !== undefined && expected.projectId > 0 && ticket.projectId !== expected.projectId) {
      return {
        ok: false,
        message: `Project mismatch: candidate ticket #${candidateTicketId} belongs to project #${ticket.projectId}, expected #${expected.projectId}.`,
      };
    }
    if (expected.subject !== undefined && expected.subject.trim().length > 0) {
      if (normalizeTicketText(ticket.subject) !== normalizeTicketText(expected.subject)) {
        return {
          ok: false,
          message: `Subject mismatch: candidate ticket #${candidateTicketId} subject does not match intended subject.`,
        };
      }
    }
    return {
      ok: true,
      ticketId: ticket.id,
      projectId: ticket.projectId,
      remoteUpdatedAt: ticket.updatedAt,
      canonical: detail,
    };
  } catch (err) {
    return {
      ok: false,
      message: (err as Error).message ?? `Failed to fetch candidate ticket #${candidateTicketId}`,
    };
  }
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
  repository?: SyncOperationRepository;
  localState?: any;
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
  /**
   * INV-N13: effectId単位でPrimary mutationから独立してSecondary Effect recoveryを実行する。
   * attachment/image/child effect の retry_effect をサポートする Handler が実装する。
   */
  resolveEffect?(input: {
    key: SyncOperationKey;
    effectId: string;
    operation: UnifiedSyncOperation<TIntent>;
    context: OperationHandlerContext;
    deps: OperationHandlerDeps & { repository: SyncOperationRepository };
    resolution: EffectResolution;
  }): Promise<SyncOutcome>;
}

export type EffectResolution =
  | { kind: "retry_effect" }
  | { kind: "assume_committed"; remoteId?: number; token?: string }
  | { kind: "link_remote_child"; remoteId: number }
  | { kind: "mark_failed"; disposition?: FailureDisposition; category?: string };

export type PreparedTicketCreate = {
  parsed: TicketEditorContent;
  projectId: number;
  uploadTokens: IssueUploadInput[];
  resolved?: any;
  request?: IssueCreateInput;
  snapshot?: TicketCreateRequestSnapshot;
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
      if (parsed.metadataBlock === "missing") {
        const kvLines = intent.content.split(/\r?\n/);
        const kvMap: Record<string, string> = {};
        let bodyStartIndex = -1;
        for (let i = 0; i < kvLines.length; i++) {
          const line = kvLines[i].trim();
          if (line.length === 0) {
            bodyStartIndex = i + 1;
            break;
          }
          const colonIdx = line.indexOf(":");
          if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim().toLowerCase().replace(/[\s_-]+/g, "");
            const val = line.slice(colonIdx + 1).trim();
            kvMap[key] = val;
          }
        }
        if (kvMap.subject && !parsed.subject) {
          parsed.subject = kvMap.subject;
        }
        if (kvMap.parent && !parsed.metadata.parent) {
          parsed.metadata.parent = Number(kvMap.parent);
        }
        if (kvMap.tracker && !parsed.metadata.tracker) {
          parsed.metadata.tracker = kvMap.tracker;
        }
        if (kvMap.priority && !parsed.metadata.priority) {
          parsed.metadata.priority = kvMap.priority;
        }
        if (kvMap.status && !parsed.metadata.status) {
          parsed.metadata.status = kvMap.status;
        }
        if (kvMap.duedate && !parsed.metadata.due_date) {
          parsed.metadata.due_date = kvMap.duedate;
        }
        if (kvMap.startdate && !parsed.metadata.start_date) {
          parsed.metadata.start_date = kvMap.startdate;
        }
        if (kvMap.doneratio && parsed.metadata.done_ratio === undefined) {
          parsed.metadata.done_ratio = Number(kvMap.doneratio);
        }
        if (kvMap.estimatedhours && parsed.metadata.estimated_hours === undefined) {
          parsed.metadata.estimated_hours = Number(kvMap.estimatedhours);
        }
        if (bodyStartIndex !== -1 && bodyStartIndex < kvLines.length) {
          parsed.description = kvLines.slice(bodyStartIndex).join("\n").trim();
        }
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

    const primaryEffect = (operation.effects ?? []).find(
      (e) => e.effectId === "ticket-create" || isPrimaryEffectKind(e.kind),
    );
    const isRetry = primaryEffect?.state === "failed" || primaryEffect?.state === "commit_unknown";

    let resolved: any = {};
    let request: IssueCreateInput;

    if (isRetry && primaryEffect?.requestSnapshot && (primaryEffect.requestSnapshot as TicketCreateRequestSnapshot).request) {
      request = (primaryEffect.requestSnapshot as TicketCreateRequestSnapshot).request;
      if (deps?.ticketCreate?.listIssueStatuses && typeof deps.ticketCreate.listIssueStatuses === "function") {
        try {
          await deps.ticketCreate.listIssueStatuses();
        } catch (err) {
          return { ok: false, outcome: { kind: "failed_before_commit", error: err as Error } };
        }
      }
    } else {
      const resolveFn = createDeps.resolveMetadataForCreate ?? resolveMetadataForCreate;
      try {
        resolved = await resolveFn(
          parsed.metadata,
          createDeps,
          projectId,
        );
      } catch (err) {
        if (!deps?.ticketCreate) {
          resolved = {};
        } else {
          return {
            ok: false,
            outcome: { kind: "failed_before_commit", error: err as Error },
          };
        }
      }

      const parentId = parsed.metadata?.parent ? Number(parsed.metadata.parent) : undefined;
      request = {
        projectId,
        subject: parsed.subject,
        description: parsed.description,
        uploads: uploadTokens.length > 0 ? uploadTokens : undefined,
        statusId: resolved.statusId,
        trackerId: resolved.trackerId,
        priorityId: resolved.priorityId,
        dueDate: parsed.metadata?.due_date || undefined,
        parentId: (parentId !== undefined && !isNaN(parentId) && parentId > 0) ? parentId : undefined,
        startDate: parsed.metadata?.start_date || undefined,
        doneRatio: resolved.doneRatio,
        estimatedHours: resolved.estimatedHours,
        assigneeId: resolved.assigneeId,
      };
    }

    const snapshot: TicketCreateRequestSnapshot = {
      kind: "ticket_create",
      request,
    };

    const opKey: SyncOperationKey = operation.key ?? { kind: "newTicket", queueId: operation.operationId, documentUri: operation.documentUri };
    const revision = operation.intentRevision ?? operation.revision ?? 1;
    const repo = deps?.repository ?? createSyncOperationRepository();

    const existingOp = repo.getOperation(opKey, context.connectionScope);
    if (!existingOp) {
      await repo.saveOperation(operation, context.connectionScope);
    }

    const planResult = await repo.planEffect(
      opKey,
      {
        effectId: "ticket-create",
        kind: "ticket_create",
        operationRevision: revision,
        state: "planned",
        target: { documentUri: operation.documentUri },
        requestSnapshot: snapshot,
      },
      context.connectionScope,
      revision,
    );
    if (!planResult) {
      return {
        ok: false,
        outcome: {
          kind: "failed_before_commit",
          error: new Error("Failed to persist planned checkpoint for ticket-create"),
        },
      };
    }

    return {
      ok: true,
      prepared: {
        parsed,
        projectId,
        uploadTokens,
        resolved,
        request,
        snapshot,
      },
    };
  }

  public async executeSecondaryEffects(
    operation: UnifiedSyncOperation<TicketCreateIntent>,
    prepared: PreparedTicketCreate,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; uploadTokens?: IssueUploadInput[] } | { ok: false; error: Error; commitUnknown?: boolean }> {
    const attachments = operation.intent?.attachments ?? [];
    const tokens: IssueUploadInput[] = [...prepared.uploadTokens];
    const createDeps = { ...defaultCreateDeps, ...deps?.ticketCreate };
    const repo = deps?.repository ?? createSyncOperationRepository();
    const opKey: SyncOperationKey = operation.key ?? { kind: "newTicket", documentUri: operation.documentUri };
    const revision = operation.intentRevision ?? operation.revision ?? 1;

    const currentOp = repo.getOperation(opKey, context.connectionScope);
    if (!currentOp) {
      await repo.saveOperation(operation, context.connectionScope);
    }

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      if (att.kind === "token") {
        if (!tokens.some((t) => t.token === att.token)) {
          tokens.push({ token: att.token, filename: att.filename ?? "attachment", content_type: att.contentType ?? "application/octet-stream" });
        }
      } else if (att.kind === "file") {
        const effectId = `attachment:file:${i}:${att.filePath}`;
        const currentOp = repo.getOperation(opKey, context.connectionScope) ?? operation;
        const existingEffect = currentOp.effects?.find((e) => e.effectId === effectId);

        if (existingEffect?.state === "committed" && existingEffect.token) {
          if (!tokens.some((t) => t.token === existingEffect.token)) {
            tokens.push({ token: existingEffect.token, filename: att.filename ?? existingEffect.target?.filename ?? "attachment", content_type: att.contentType ?? "application/octet-stream" });
          }
          continue;
        }

        const fileId = await computeFileHashAndSizeAsync(att.filePath);
        if (!fileId) {
          return { ok: false, error: new Error(`Failed to compute hash for file attachment: ${att.filePath}`) };
        }

        if (existingEffect?.requestSnapshot) {
          const existingSnap = existingEffect.requestSnapshot as UploadRequestSnapshot;
          if (existingSnap.contentHash && existingSnap.contentHash !== fileId.contentHash) {
            return { ok: false, error: new Error(`File content has changed since original snapshot: ${att.filePath}`) };
          }
        }

        const uploadSnapshot: UploadRequestSnapshot = {
          kind: "upload",
          filePath: att.filePath,
          filename: att.filename ?? path.basename(att.filePath),
          contentType: att.contentType ?? "application/octet-stream",
          contentHash: fileId.contentHash,
          contentSize: fileId.contentSize,
        };

        const planRes = await repo.planEffect(
          opKey,
          {
            effectId,
            kind: "attachment_upload",
            operationRevision: revision,
            state: "planned",
            target: { filePath: att.filePath, filename: att.filename },
            requestSnapshot: uploadSnapshot,
          },
          context.connectionScope,
          revision,
        );
        if (!planRes) {
          return { ok: false, error: new Error(`Failed to plan effect ${effectId}`) };
        }

        const startRes = await repo.transitionEffect(
          opKey,
          effectId,
          { kind: "start", requestSnapshot: uploadSnapshot },
          context.connectionScope,
          { operationRevision: revision, sourceState: "planned" },
        );
        if (!startRes) {
          return { ok: false, error: new Error(`Failed to start effect ${effectId}`) };
        }

        try {
          const uploadFn = (createDeps as any).uploadFile ?? uploadFileAttachment;
          const res = await uploadFn(att.filePath);
          const commitRes = await repo.transitionEffect(
            opKey,
            effectId,
            { kind: "commit", token: res.token, target: { filePath: att.filePath, filename: att.filename ?? res.filename }, requestSnapshot: uploadSnapshot },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
          if (!commitRes) {
            return { ok: false, error: new Error(`Failed to commit effect ${effectId}`), commitUnknown: true };
          }
          tokens.push({ token: res.token, filename: att.filename ?? res.filename, content_type: att.contentType ?? res.contentType });
        } catch (err) {
          const commitUnknown = isRemoteCommitUnknownError(err);
          const disposition = classifyFailureDisposition(err);
          await repo.transitionEffect(
            opKey,
            effectId,
            commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
          return { ok: false, error: err as Error, commitUnknown };
        }
      } else if (att.kind === "clipboard") {
        const effectId = `attachment:clipboard:${i}`;
        const currentOp = repo.getOperation(opKey, context.connectionScope) ?? operation;
        const existingEffect = currentOp.effects?.find((e) => e.effectId === effectId);

        if (existingEffect?.state === "committed" && existingEffect.token) {
          if (!tokens.some((t) => t.token === existingEffect.token)) {
            tokens.push({ token: existingEffect.token, filename: att.filename ?? "clipboard.png", content_type: att.contentType ?? "image/png" });
          }
          continue;
        }

        const spoolDir = path.join(os.tmpdir(), "vs-redmine-spool");
        if (!fs.existsSync(spoolDir)) {
          fs.mkdirSync(spoolDir, { recursive: true });
        }

        let uploadSnapshot: UploadRequestSnapshot;
        let spoolFilePath: string | undefined;

        if (existingEffect?.requestSnapshot) {
          uploadSnapshot = existingEffect.requestSnapshot as UploadRequestSnapshot;
          spoolFilePath = uploadSnapshot.spoolFilePath;
        } else {
          let buffer: Uint8Array;
          let filename: string;
          let contentType: string;
          try {
            const clipboardText = await vscode.env.clipboard.readText();
            const parsed = parseClipboardImageDataUri(clipboardText);
            buffer = parsed.buffer;
            filename = att.filename ?? parsed.filename;
            contentType = att.contentType ?? parsed.contentType;
          } catch {
            buffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
            filename = att.filename ?? "clipboard.png";
            contentType = att.contentType ?? "image/png";
          }
          const bufferId = computeBufferHashAndSize(buffer);
          spoolFilePath = path.join(spoolDir, `${bufferId.contentHash}.${contentType.split("/")[1] || "png"}`);
          fs.writeFileSync(spoolFilePath, buffer);
          uploadSnapshot = {
            kind: "upload",
            filePath: spoolFilePath,
            filename,
            contentType,
            contentHash: bufferId.contentHash,
            contentSize: bufferId.contentSize,
            spoolFilePath,
          };
        }

        const planClipRes = await repo.planEffect(
          opKey,
          {
            effectId,
            kind: "attachment_upload",
            operationRevision: revision,
            state: "planned",
            target: { filename: att.filename },
            requestSnapshot: uploadSnapshot,
          },
          context.connectionScope,
          revision,
        );
        if (!planClipRes) {
          return { ok: false, error: new Error(`Failed to plan effect ${effectId}`) };
        }

        const startClipRes = await repo.transitionEffect(
          opKey,
          effectId,
          { kind: "start", requestSnapshot: uploadSnapshot },
          context.connectionScope,
          { operationRevision: revision, sourceState: "planned" },
        );
        if (!startClipRes) {
          return { ok: false, error: new Error(`Failed to start effect ${effectId}`) };
        }

        try {
          const uploadFn = (createDeps as any).uploadClipboardImage;
          const res = uploadFn
            ? await uploadFn()
            : await uploadFileAttachment(spoolFilePath!);
          const commitClipRes = await repo.transitionEffect(
            opKey,
            effectId,
            { kind: "commit", token: res.token, target: { filename: att.filename ?? res.filename }, requestSnapshot: uploadSnapshot },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
          if (!commitClipRes) {
            return { ok: false, error: new Error(`Failed to commit effect ${effectId}`), commitUnknown: true };
          }
          tokens.push({ token: res.token, filename: att.filename ?? res.filename, content_type: att.contentType ?? res.contentType });
        } catch (err) {
          const commitUnknown = isRemoteCommitUnknownError(err);
          const disposition = classifyFailureDisposition(err);
          await repo.transitionEffect(
            opKey,
            effectId,
            commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
          return { ok: false, error: err as Error, commitUnknown };
        }
      }
    }

    prepared.uploadTokens = tokens;
    return { ok: true, uploadTokens: tokens };
  }

  public async executeRemoteWrite(
    operation: UnifiedSyncOperation<TicketCreateIntent>,
    prepared: PreparedTicketCreate,
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
    const repo = deps?.repository ?? createSyncOperationRepository();
    const opKey: SyncOperationKey = operation.key ?? {
      kind: "newTicket",
      queueId: operation.operationId,
      documentUri: operation.documentUri,
    };
    const currentOp = repo.getOperation(opKey, context.connectionScope);
    if (!currentOp) {
      await repo.saveOperation(operation, context.connectionScope);
    }
    const revision = operation.intentRevision ?? operation.revision ?? 1;

    let createdId = operation.createdRemoteId ?? currentOp?.createdRemoteId;
    const existingPrimaryEffect = (currentOp?.effects ?? operation.effects ?? []).find(
      (e) => e.effectId === "ticket-create" || isPrimaryEffectKind(e.kind),
    );
    if (existingPrimaryEffect?.state === "committed" && existingPrimaryEffect.remoteId) {
      createdId = existingPrimaryEffect.remoteId;
    }

    if (!createdId) {
      const isRetry = existingPrimaryEffect?.state === "failed" || existingPrimaryEffect?.state === "commit_unknown";
      const requestToUse: IssueCreateInput = (existingPrimaryEffect?.requestSnapshot as TicketCreateRequestSnapshot | undefined)?.request
        ?? prepared.request
        ?? {
          projectId: prepared.projectId,
          subject: prepared.parsed.subject,
          description: prepared.parsed.description,
          uploads: prepared.uploadTokens.length > 0 ? prepared.uploadTokens : undefined,
          statusId: prepared.resolved?.statusId,
          trackerId: prepared.resolved?.trackerId,
          priorityId: prepared.resolved?.priorityId,
          dueDate: prepared.parsed.metadata?.due_date || undefined,
          parentId: prepared.parsed.metadata?.parent ? Number(prepared.parsed.metadata.parent) : undefined,
          startDate: prepared.parsed.metadata?.start_date || undefined,
          doneRatio: prepared.resolved?.doneRatio,
          estimatedHours: prepared.resolved?.estimatedHours,
          assigneeId: prepared.resolved?.assigneeId,
        };

      if (prepared.uploadTokens.length > 0 && (!requestToUse.uploads || requestToUse.uploads.length === 0)) {
        requestToUse.uploads = prepared.uploadTokens;
      }

      const ticketSnapshot: TicketCreateRequestSnapshot = {
        kind: "ticket_create",
        request: requestToUse,
      };

      const started = await repo.transitionPrimaryRemoteWrite(
        opKey,
        {
          kind: isRetry ? "start_explicit_retry" : "start",
          requestSnapshot: ticketSnapshot,
        },
        context.connectionScope,
        { operationId: operation.operationId, revision, sourcePhase: operation.phase },
      );
      if (!started) {
        return {
          ok: false,
          commitUnknown: false,
          error: new Error("Failed to persist started checkpoint for ticket-create"),
          outcome: { kind: "failed_before_commit", error: new Error("Failed to persist started checkpoint for ticket-create") },
        };
      }

      try {
        createdId = await createDeps.createIssue(requestToUse);

        if (!createdId) {
          throw new Error("Failed to create issue");
        }

        const committed = await repo.transitionPrimaryRemoteWrite(
          opKey,
          {
            kind: "commit",
            remoteId: createdId,
            projectId: requestToUse.projectId,
            requestSnapshot: ticketSnapshot,
          },
          context.connectionScope,
          { operationId: operation.operationId, revision, sourcePhase: "remote_write_started" },
        );
        if (!committed) {
          return {
            ok: false,
            commitUnknown: true,
            error: new Error("Remote issue created but failed to persist commit checkpoint"),
            outcome: { kind: "commit_unknown", operationId: operation.operationId, message: "Remote issue created but failed to persist commit checkpoint" },
          };
        }
      } catch (err) {
        const commitUnknown = isRemoteCommitUnknownError(err);
        const disposition = classifyFailureDisposition(err);
        await repo.transitionPrimaryRemoteWrite(
          opKey,
          commitUnknown
            ? { kind: "commit_unknown", detail: (err as Error).message }
            : { kind: "failed", failure: { disposition, detail: (err as Error).message } },
          context.connectionScope,
          { operationId: operation.operationId, revision, sourcePhase: "remote_write_started" },
        );
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

      const currentOp = repo.getOperation(opKey, context.connectionScope) ?? operation;
      const existingEffect = currentOp.effects?.find((e) => e.effectId === effectId);

      if (existingEffect?.state === "committed" && existingEffect.remoteId) {
        continue;
      }
      if (
        existingEffect?.state === "commit_unknown" ||
        existingEffect?.state === "compensation_unknown" ||
        existingEffect?.state === "compensation_started"
      ) {
        return {
          ok: false,
          commitUnknown: true,
          error: new Error(`Child effect ${effectId} is in uncertain state`),
        };
      }

      const childRequest: IssueCreateInput = {
        subject,
        description: "",
        parentId: createdId,
        projectId: prepared.projectId,
      };
      const childSnapshot: ChildTicketCreateRequestSnapshot = {
        kind: "child_create",
        parentTicketId: createdId,
        projectId: prepared.projectId,
        subject,
        description: "",
        ordinal,
        request: childRequest,
      };

      const planChild = await repo.planEffect(
        opKey,
        {
          effectId,
          kind: "child_create",
          operationRevision: revision,
          state: "planned",
          target: { parentTicketId: createdId, ordinal },
          requestSnapshot: childSnapshot,
        },
        context.connectionScope,
        revision,
      );
      if (!planChild) {
        return {
          ok: false,
          commitUnknown: false,
          error: new Error(`Failed to plan child effect ${effectId}`),
        };
      }

      const startChild = await repo.transitionEffect(
        opKey,
        effectId,
        { kind: "start", requestSnapshot: childSnapshot },
        context.connectionScope,
        { operationRevision: revision, sourceState: "planned" },
      );
      if (!startChild) {
        return {
          ok: false,
          commitUnknown: false,
          error: new Error(`Failed to start child effect ${effectId}`),
        };
      }

      try {
        const createdChildId = await createDeps.createIssue(childSnapshot.request ?? childRequest);
        if (!createdChildId) {
          throw new Error(`Failed to create child issue: ${subject}`);
        }
        const commitChild = await repo.transitionEffect(
          opKey,
          effectId,
          { kind: "commit", remoteId: createdChildId, requestSnapshot: childSnapshot },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
        );
        if (!commitChild) {
          await repo.transitionEffect(
            opKey,
            effectId,
            { kind: "mark_commit_unknown" },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
          return {
            ok: false,
            commitUnknown: true,
            error: new Error(`Child issue created but failed to persist commit checkpoint for ${effectId}`),
          };
        }
      } catch (err) {
        const commitUnknown = isRemoteCommitUnknownError(err);
        const disposition = classifyFailureDisposition(err);
        await repo.transitionEffect(
          opKey,
          effectId,
          commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
        );
        if (!commitUnknown && createDeps.deleteIssue) {
          for (let prev = ordinal - 1; prev >= 0; prev--) {
            const prevEffectId = `child-create:${prev}`;
            const opAfterFail = repo.getOperation(opKey, context.connectionScope) ?? operation;
            const prevEffect = opAfterFail.effects?.find((e) => e.effectId === prevEffectId);
            if (prevEffect && prevEffect.state === "committed" && prevEffect.remoteId) {
              const startComp = await repo.transitionEffect(
                opKey,
                prevEffectId,
                { kind: "start_compensation" },
                context.connectionScope,
                { operationRevision: revision, sourceState: "committed" },
              );
              if (startComp) {
                try {
                  await createDeps.deleteIssue(prevEffect.remoteId);
                  const childCompResult = await repo.transitionEffect(
                    opKey,
                    prevEffectId,
                    { kind: "complete_compensation" },
                    context.connectionScope,
                    { operationRevision: revision, sourceState: "compensation_started" },
                  );
                  if (!childCompResult) {
                    await repo.transitionEffect(
                      opKey,
                      prevEffectId,
                      { kind: "mark_compensation_unknown", detail: "complete_compensation persistence failed after child DELETE" },
                      context.connectionScope,
                      { operationRevision: revision, sourceState: "compensation_started" },
                    );
                  }
                } catch (delErr) {
                  await repo.transitionEffect(
                    opKey,
                    prevEffectId,
                    { kind: "mark_compensation_unknown", detail: (delErr as Error).message },
                    context.connectionScope,
                    { operationRevision: revision, sourceState: "compensation_started" },
                  );
                }
              }
            }
          }

          // 親チケットの補償 (fail-closed: INV-N12, INV-N15)
          const opAfterChildren = repo.getOperation(opKey, context.connectionScope) ?? operation;
          const parentEffect = opAfterChildren.effects?.find((e) => e.effectId === "ticket-create");
          if (parentEffect && parentEffect.state === "committed" && parentEffect.remoteId) {
            const startParentComp = await repo.transitionEffect(
              opKey,
              "ticket-create",
              { kind: "start_compensation" },
              context.connectionScope,
              { operationRevision: revision, sourceState: "committed" },
            );
            if (startParentComp) {
              try {
                await createDeps.deleteIssue(parentEffect.remoteId);
                const compResult = await repo.transitionEffect(
                  opKey,
                  "ticket-create",
                  { kind: "complete_compensation" },
                  context.connectionScope,
                  { operationRevision: revision, sourceState: "compensation_started" },
                );
                if (!compResult) {
                  await repo.transitionEffect(
                    opKey,
                    "ticket-create",
                    { kind: "mark_compensation_unknown", detail: "complete_compensation persistence failed after DELETE" },
                    context.connectionScope,
                    { operationRevision: revision, sourceState: "compensation_started" },
                  );
                }
              } catch (parentDelErr) {
                await repo.transitionEffect(
                  opKey,
                  "ticket-create",
                  { kind: "mark_compensation_unknown", detail: (parentDelErr as Error).message },
                  context.connectionScope,
                  { operationRevision: revision, sourceState: "compensation_started" },
                );
              }
            }
          }
          const finalCheck = repo.getOperation(opKey, context.connectionScope);
          const hasCompUnknown = (finalCheck?.effects ?? []).some(
            (e) => e.state === "compensation_unknown" || e.state === "compensation_started",
          );
          if (hasCompUnknown) {
            return {
              ok: false,
              error: err as Error,
              commitUnknown: false,
              outcome: {
                kind: "remote_committed",
                ticketId: finalCheck?.createdRemoteId ?? 0,
                pending: "remote_reconcile",
                message: "Compensation failed or persistence failed",
              },
            };
          }
          return {
            ok: false,
            error: err as Error,
            commitUnknown: false,
          };
        }
      }
    }

    const finalOp = repo.getOperation(opKey, context.connectionScope) ?? operation;
    const finalEffects = finalOp.effects ?? [];
    const hasFailedEffects = finalEffects.some((e) => e.state === "failed");
    const hasUnknownEffects = finalEffects.some(
      (e) =>
        e.state === "commit_unknown" ||
        e.state === "compensation_unknown" ||
        e.state === "compensation_started",
    );
    if (hasUnknownEffects || hasFailedEffects) {
      return {
        ok: false,
        error: new Error("One or more child ticket effects require explicit recovery"),
        commitUnknown: false,
        outcome: {
          kind: "remote_committed",
          ticketId: createdId ?? 0,
          pending: "remote_reconcile",
          message: "One or more child ticket effects require explicit recovery",
        },
      };
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
        projectId: detail.ticket?.projectId ?? operation.projectId,
        remoteUpdatedAt: detail.ticket?.updatedAt ?? operation.remoteUpdatedAt,
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
    const createdId = operation.createdRemoteId ?? reconciled?.ticket?.id;
    if (!createdId) {
      return { ok: false, message: "Missing createdRemoteId for ticket_create local finalize", pending: "local_finalize" };
    }

    const subject = reconciled?.ticket?.subject ?? operation.intent?.subject ?? "";
    const description = reconciled?.ticket?.description ?? operation.intent?.description ?? "";
    const remoteUpdatedAt = reconciled?.ticket?.updatedAt ?? operation.remoteUpdatedAt ?? new Date().toISOString();

    const effectiveIntent = operation.nextIntent ?? operation.intent;
    const effectiveContent = (effectiveIntent as any)?.content;
    const baseParsed = effectiveContent
      ? parseTicketEditorContent(effectiveContent, { allowMissingMetadata: true, allowMissingSubject: true })
      : undefined;
    const parsed: TicketEditorContent = baseParsed
      ? {
          ...baseParsed,
          subject: (effectiveIntent as any).subject || baseParsed.subject || subject,
          description: (effectiveIntent as any).description || baseParsed.description || description,
          metadata: (effectiveIntent as any).metadata ?? baseParsed.metadata,
        }
      : (effectiveIntent
        ? {
            subject: (effectiveIntent as any).subject ?? subject,
            description: (effectiveIntent as any).description ?? description,
            metadata: (effectiveIntent as any).metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
            layout: (effectiveIntent as any).layout,
            metadataBlock: (effectiveIntent as any).metadataBlock,
            controlFields: (effectiveIntent as any).controlFields,
          }
        : { subject, description, metadata: { tracker: "", priority: "", status: "", due_date: "", children: [] } });
    const canonicalParsed = operation.nextIntent
      ? parsed
      : (reconciled?.ticket ? editorContentFromTicket(reconciled.ticket, parsed) : parsed);
    const metadata = canonicalParsed?.metadata ?? (reconciled?.ticket ? metadataFromTicket(reconciled.ticket) : { tracker: "", priority: "", status: "", due_date: "", children: [] });

    if (operation.documentUri) {
      try {
        if (deps?.documents?.rewriteNewTicket) {
          const res = await deps.documents.rewriteNewTicket({
            documentUri: operation.documentUri,
            ticketId: createdId,
            projectId: operation.projectId ?? reconciled?.ticket?.projectId ?? 0,
            replacement: canonicalParsed,
            expected: {
              content: operation.intent?.content ?? "",
              operationRevision: operation.intentRevision ?? operation.revision ?? 1,
            },
          });
          if (res.kind !== "applied") {
            return { ok: false, message: `Document rewrite failed: ${res.kind}`, pending: "local_finalize" };
          }
        } else {
          const doc = (vscode.workspace.textDocuments ?? []).find((d) => d.uri.toString() === operation.documentUri);
          if (doc) {
            const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === operation.documentUri);
            if (editor) {
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
        }
      } catch (err) {
        return { ok: false, message: (err as Error).message, pending: "local_finalize" };
      }
    }

    if (deps?.localState?.register) {
      deps.localState.register({
        ticketId: createdId,
        documentUri: operation.documentUri,
        projectId: operation.projectId ?? reconciled?.ticket?.projectId,
        connectionScope: context.connectionScope,
      });
    } else {
      if (operation.documentUri) {
        removeTicketEditorByUri(vscode.Uri.parse(operation.documentUri));
        const doc = (vscode.workspace.textDocuments ?? []).find((d) => d.uri.toString() === operation.documentUri);
        if (doc) {
          registerTicketDocument(
            createdId,
            doc,
            "ticket",
            operation.projectId ?? reconciled?.ticket?.projectId,
            context.connectionScope,
          );
        }
      }
    }

    if (deps?.localState?.updateDraft) {
      deps.localState.updateDraft(createdId, subject, description, metadata, remoteUpdatedAt, context.connectionScope);
    } else {
      updateDraftAfterSave(
        createdId,
        subject,
        description,
        metadata,
        remoteUpdatedAt,
        context.connectionScope,
      );
    }

    const draftId = operation.key?.kind === "newTicket" ? operation.key.queueId : undefined;
    if (draftId) {
      markNewTicketDraftSynced(draftId, createdId);
    }
    return { ok: true };
  }

  public async resolveEffect(input: {
    key: SyncOperationKey;
    effectId: string;
    operation: UnifiedSyncOperation<TicketCreateIntent>;
    context: OperationHandlerContext;
    deps: OperationHandlerDeps & { repository: SyncOperationRepository };
    resolution: EffectResolution;
  }): Promise<SyncOutcome> {
    const { key, effectId, operation, context, deps, resolution } = input;
    const repo = deps.repository;
    const revision = operation.intentRevision ?? operation.revision ?? 1;
    const scope = context.connectionScope;
    const effect = (operation.effects ?? []).find((e) => e.effectId === effectId);
    if (!effect) {
      return { kind: "failed_before_commit", error: new Error(`Effect not found: ${effectId}`) };
    }

    const createDeps = { ...defaultCreateDeps, ...deps.ticketCreate };

    // mark_failed
    if (resolution.kind === "mark_failed") {
      const marked = await repo.transitionEffect(
        key,
        effectId,
        { kind: "mark_failed", detail: "Manually marked as failed", disposition: resolution.disposition ?? "retryable", category: resolution.category },
        scope,
        { operationRevision: revision, sourceState: effect.state },
      );
      if (!marked) {
        return { kind: "failed_before_commit", error: new Error(`Failed to mark effect as failed: ${effectId}`) };
      }
      return {
        kind: "remote_committed",
        ticketId: operation.createdRemoteId ?? 0,
        pending: "remote_reconcile",
        message: `Effect ${effectId} marked as failed`,
      };
    }

    // 1. ticket-create compensation recovery
    if (effectId === "ticket-create" && (effect.state === "compensation_unknown" || effect.state === "compensation_started")) {
      const remoteTicketId = effect.remoteId ?? operation.createdRemoteId;
      if (!remoteTicketId) {
        return { kind: "failed_before_commit", error: new Error("Missing remoteId for ticket compensation recovery") };
      }
      try {
        const getDetail = deps?.ticketCreate?.getIssueDetail ?? createDeps.getIssueDetail ?? getIssueDetail;
        const detail = await getDetail(remoteTicketId);
        if (detail && detail.ticket) {
          // Remote present: DELETE を再実行
          const startDel = await repo.transitionEffect(key, effectId, { kind: "start_compensation" }, scope, { operationRevision: revision, sourceState: effect.state });
          if (!startDel) {
            return { kind: "failed_before_commit", error: new Error("Failed to transition to start_compensation") };
          }
          await createDeps.deleteIssue?.(remoteTicketId);
          const compDone = await repo.transitionEffect(key, effectId, { kind: "complete_compensation" }, scope, { operationRevision: revision, sourceState: "compensation_started" });
          if (!compDone) {
            await repo.transitionEffect(key, effectId, { kind: "mark_compensation_unknown", detail: "complete_compensation failed to persist" }, scope, { operationRevision: revision, sourceState: "compensation_started" });
            return { kind: "commit_unknown", operationId: operation.operationId, message: "Compensation completed on remote but checkpoint failed" };
          }
          return { kind: "no_change", ticketId: remoteTicketId };
        }
      } catch (err: any) {
        if (err?.status === 404 || err?.message?.includes("404") || err?.message?.toLowerCase().includes("not found")) {
          // Remote absent: 既に削除済み → complete_compensation
          const compDone = await repo.transitionEffect(key, effectId, { kind: "complete_compensation" }, scope, { operationRevision: revision, sourceState: effect.state });
          if (compDone) {
            return { kind: "no_change", ticketId: remoteTicketId };
          }
        }
        return { kind: "commit_unknown", operationId: operation.operationId, message: (err as Error).message };
      }
    }

    // 2. attachment / image recovery
    if (effect.kind === "attachment_upload" || effect.kind === "image_upload") {
      if (resolution.kind === "assume_committed") {
        const token = resolution.token ?? effect.token;
        const assumed = await repo.transitionEffect(
          key,
          effectId,
          { kind: "assume_committed", token, remoteId: resolution.remoteId },
          scope,
          { operationRevision: revision, sourceState: effect.state },
        );
        if (!assumed) {
          return { kind: "failed_before_commit", error: new Error(`Failed to assume committed for effect ${effectId}`) };
        }
        return {
          kind: "remote_committed",
          ticketId: operation.createdRemoteId ?? 0,
          pending: "remote_reconcile",
          message: `Attachment effect ${effectId} assumed committed`,
        };
      }

      if (resolution.kind === "retry_effect") {
        if (effect.state === "failed" && effect.failure?.disposition === "non_retriable") {
          return { kind: "failed_before_commit", error: new Error("Cannot retry non-retriable failure") };
        }
        const filePath = effect.target.filePath ?? (effect.requestSnapshot as UploadRequestSnapshot | undefined)?.filePath;
        if (!filePath) {
          return { kind: "failed_before_commit", error: new Error(`Cannot retry attachment without filePath for effect ${effectId}`) };
        }

        // Upload retry 前検証: hash / size
        const currentFile = computeFileHashAndSize(filePath);
        const snapshot = effect.requestSnapshot as UploadRequestSnapshot | undefined;
        if (snapshot?.contentHash && currentFile?.contentHash && snapshot.contentHash !== currentFile.contentHash) {
          return {
            kind: "failed_before_commit",
            error: new Error(`File content has changed since snapshot (expected hash ${snapshot.contentHash}, found ${currentFile.contentHash}). Retry rejected.`),
          };
        }
        const contentHash = currentFile?.contentHash ?? snapshot?.contentHash;
        const contentSize = currentFile?.contentSize ?? snapshot?.contentSize;
        if (!contentHash || contentSize === undefined) {
          return { kind: "failed_before_commit", error: new Error(`Cannot compute hash for file: ${filePath}`) };
        }

        const uploadSnapshot: UploadRequestSnapshot = {
          kind: "upload",
          filePath,
          filename: effect.target.filename ?? snapshot?.filename ?? "attachment",
          contentType: snapshot?.contentType ?? "application/octet-stream",
          contentHash,
          contentSize,
        };

        const started = await repo.transitionEffect(
          key,
          effectId,
          { kind: "start_explicit_retry", requestSnapshot: uploadSnapshot },
          scope,
          { operationRevision: revision, sourceState: effect.state },
        );
        if (!started) {
          return { kind: "failed_before_commit", error: new Error(`Failed to start retry for effect ${effectId}`) };
        }
        try {
          const uploadFn = (createDeps as any).uploadFile ?? uploadFileAttachment;
          const res = await uploadFn(filePath);
          const committed = await repo.transitionEffect(
            key,
            effectId,
            { kind: "commit", token: res.token, target: { filePath, filename: effect.target.filename ?? res.filename }, requestSnapshot: uploadSnapshot },
            scope,
            { operationRevision: revision, sourceState: "started" },
          );
          if (!committed) {
            return { kind: "commit_unknown", operationId: operation.operationId, message: `Attachment uploaded but commit checkpoint failed for ${effectId}` };
          }
          return { kind: "remote_committed", ticketId: operation.createdRemoteId ?? 0, pending: "remote_reconcile", message: `Attachment ${effectId} uploaded successfully` };
        } catch (err) {
          const isUnknown = isRemoteCommitUnknownError(err);
          const disposition = classifyFailureDisposition(err);
          await repo.transitionEffect(
            key,
            effectId,
            isUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
            scope,
            { operationRevision: revision, sourceState: "started" },
          );
          return isUnknown
            ? { kind: "commit_unknown", operationId: operation.operationId, message: (err as Error).message }
            : { kind: "failed_before_commit", error: err as Error };
        }
      }
    }

    // 3. child_create recovery
    if (effect.kind === "child_create") {
      const childSnapshot = effect.requestSnapshot as ChildTicketCreateRequestSnapshot | undefined;
      const parentEffect = (operation.effects ?? []).find(
        (e) => e.effectId === "ticket-create" || e.kind === "ticket_create",
      );
      const parentTicketId =
        childSnapshot?.parentTicketId ??
        effect.target.parentTicketId ??
        parentEffect?.remoteId ??
        operation.createdRemoteId;

      if (resolution.kind === "link_remote_child" || (resolution.kind === "assume_committed" && resolution.remoteId)) {
        const remoteChildId = resolution.kind === "link_remote_child" ? resolution.remoteId : resolution.remoteId!;
        const getDetail = deps?.ticketCreate?.getIssueDetail ?? createDeps.getIssueDetail ?? getIssueDetail;
        try {
          const detail = await getDetail(remoteChildId);
          if (!detail || !detail.ticket) {
            return { kind: "failed_before_commit", error: new Error(`Remote ticket #${remoteChildId} not found.`) };
          }

          // 検証: parentId, projectId, subject
          if (parentTicketId && detail.ticket.parentId !== parentTicketId) {
            return {
              kind: "failed_before_commit",
              error: new Error(`Parent ticket ID mismatch: child #${remoteChildId} has parent ${detail.ticket.parentId}, expected ${parentTicketId}`),
            };
          }
          const expectedProj = childSnapshot?.projectId ?? operation.projectId ?? operation.intent?.projectId;
          if (expectedProj && detail.ticket.projectId !== expectedProj) {
            return {
              kind: "failed_before_commit",
              error: new Error(`Project mismatch: child #${remoteChildId} belongs to project ${detail.ticket.projectId}, expected ${expectedProj}`),
            };
          }
          const parsedContent = operation.intent?.content ? parseTicketEditorContent(operation.intent.content, { allowMissingMetadata: true, allowMissingSubject: true }) : undefined;
          const expectedSubj =
            childSnapshot?.subject ??
            (effect.target as any).subject ??
            (operation.intent?.childTickets?.[effect.target.ordinal ?? 0]?.subject) ??
            (operation.intent?.metadata?.children?.[effect.target.ordinal ?? 0]) ??
            (parsedContent?.metadata?.children?.[effect.target.ordinal ?? 0]);
          if (expectedSubj && normalizeTicketText(detail.ticket.subject) !== normalizeTicketText(expectedSubj)) {
            return {
              kind: "failed_before_commit",
              error: new Error(`Subject mismatch: child #${remoteChildId} has subject "${detail.ticket.subject}", expected "${expectedSubj}"`),
            };
          }

          const assumed = await repo.transitionEffect(
            key,
            effectId,
            { kind: "assume_committed", remoteId: remoteChildId },
            scope,
            { operationRevision: revision, sourceState: effect.state },
          );
          if (!assumed) {
            return { kind: "failed_before_commit", error: new Error(`Failed to assume committed for child effect ${effectId}`) };
          }

          // 親チケットが committed の場合、すべての Effect が committed なら completed へ進める
          return this.finalizeOperationIfReady(assumed as UnifiedSyncOperation<TicketCreateIntent>, context, deps);
        } catch (err) {
          return { kind: "failed_before_commit", error: err as Error };
        }
      }

      if (resolution.kind === "retry_effect") {
        if (effect.state === "commit_unknown") {
          // blind retry 禁止
          return {
            kind: "failed_before_commit",
            error: new Error("Blind retry for child_create in commit_unknown is forbidden without verified absence. Please link the remote issue ID or verify absence first."),
          };
        }

        if (effect.state === "failed" && effect.failure?.disposition === "non_retriable") {
          return { kind: "failed_before_commit", error: new Error("Cannot retry non-retriable failure.") };
        }

        const parsedContent = operation.intent?.content ? parseTicketEditorContent(operation.intent.content, { allowMissingMetadata: true, allowMissingSubject: true }) : undefined;
        const subject =
          childSnapshot?.subject ??
          (effect.target as any).subject ??
          (operation.intent?.childTickets?.[effect.target.ordinal ?? 0]?.subject) ??
          (operation.intent?.metadata?.children?.[effect.target.ordinal ?? 0]) ??
          (parsedContent?.metadata?.children?.[effect.target.ordinal ?? 0]);
        const projectId = childSnapshot?.projectId ?? operation.projectId ?? operation.intent?.projectId ?? 0;

        if (!parentTicketId || !subject) {
          return { kind: "failed_before_commit", error: new Error(`Cannot retry child create for effect ${effectId}: missing parent or subject (parentTicketId=${parentTicketId}, subject=${subject})`) };
        }

        const childRequest: IssueCreateInput = childSnapshot?.request ?? {
          subject: subject ?? "",
          description: childSnapshot?.description ?? "",
          parentId: parentTicketId,
          projectId,
        };

        const updatedSnapshot: ChildTicketCreateRequestSnapshot = {
          kind: "child_create",
          parentTicketId,
          projectId,
          subject: childRequest.subject,
          description: childRequest.description,
          ordinal: effect.target.ordinal,
          request: childRequest,
        };

        const started = await repo.transitionEffect(
          key,
          effectId,
          { kind: "start_explicit_retry", requestSnapshot: updatedSnapshot },
          scope,
          { operationRevision: revision, sourceState: effect.state },
        );
        if (!started) {
          return { kind: "failed_before_commit", error: new Error(`Failed to start retry for effect ${effectId}`) };
        }

        try {
          const createdChildId = await createDeps.createIssue(childRequest);
          const committed = await repo.transitionEffect(
            key,
            effectId,
            { kind: "commit", remoteId: createdChildId, requestSnapshot: updatedSnapshot },
            scope,
            { operationRevision: revision, sourceState: "started" },
          );
          if (!committed) {
            return { kind: "commit_unknown", operationId: operation.operationId, message: `Child issue created but failed to persist commit checkpoint for ${effectId}` };
          }

          // 親チケットが committed の場合、すべての Effect が committed なら completed へ進める
          return this.finalizeOperationIfReady(committed as UnifiedSyncOperation<TicketCreateIntent>, context, deps);
        } catch (err) {
          const isUnknown = isRemoteCommitUnknownError(err);
          const disposition = classifyFailureDisposition(err);
          await repo.transitionEffect(
            key,
            effectId,
            isUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
            scope,
            { operationRevision: revision, sourceState: "started" },
          );
          return isUnknown
            ? { kind: "commit_unknown", operationId: operation.operationId, message: (err as Error).message }
            : { kind: "failed_before_commit", error: err as Error };
        }
      }
    }

    return {
      kind: "failed_before_commit",
      error: new Error(`Unsupported effect resolution for kind ${effect.kind} or resolution ${JSON.stringify(resolution)}`),
    };
  }

  private async finalizeOperationIfReady(
    op: UnifiedSyncOperation<TicketCreateIntent>,
    context: OperationHandlerContext,
    deps: OperationHandlerDeps & { repository: SyncOperationRepository },
  ): Promise<SyncOutcome> {
    const parentCommitted = (op.effects ?? []).some(
      (e) => (e.effectId === "ticket-create" || e.kind === "ticket_create") && e.state === "committed"
    ) || (op.createdRemoteId !== undefined && op.createdRemoteId > 0);

    const hasUnresolved = (op.effects ?? []).some(
      (e) => e.state === "commit_unknown" || e.state === "failed" || e.state === "started" || e.state === "compensation_started" || e.state === "compensation_unknown"
    );

    if (!parentCommitted || hasUnresolved) {
      return {
        kind: "remote_committed",
        ticketId: op.createdRemoteId ?? 0,
        pending: "remote_reconcile",
        message: "Secondary effects resolved partially",
      };
    }

    // すべて committed なので reconcile -> finalize -> complete
    const reconciled = await this.reconcileRemote(op, context, deps);
    if (!reconciled.ok) {
      return {
        kind: "remote_committed",
        ticketId: op.createdRemoteId ?? 0,
        pending: "remote_reconcile",
        message: reconciled.message,
      };
    }

    const fin = await this.finalizeLocal(op, reconciled.canonical, context, deps);
    if (!fin.ok) {
      return {
        kind: "remote_committed",
        ticketId: op.createdRemoteId ?? 0,
        pending: "local_finalize",
        message: fin.message,
      };
    }

    const key = op.key ?? { kind: "newTicket", documentUri: op.documentUri };
    const compOp = await deps.repository.completeOperation(key, context.connectionScope, undefined, {
      canonical: reconciled.canonical,
      remoteUpdatedAt: op.remoteUpdatedAt,
    });
    if (compOp) {
      return {
        kind: "completed",
        ticketId: op.createdRemoteId ?? 0,
      };
    }
    return {
      kind: "remote_committed",
      ticketId: op.createdRemoteId ?? 0,
      pending: "local_finalize",
      message: "Failed to persist complete state",
    };
  }
}

export interface PreparedTicketUpdate {
  ticketId: number;
  projectId?: number;
  changes: TicketUpdateFields;
  uniqueChildren: string[];
  request?: IssueUpdateInput;
  snapshot?: TicketUpdateRequestSnapshot;
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

    const primaryEffect = (operation.effects ?? []).find(
      (e) => e.effectId === "ticket-update" || isPrimaryEffectKind(e.kind),
    );
    const isRetry = primaryEffect?.state === "failed" || primaryEffect?.state === "commit_unknown";

    let request: IssueUpdateInput;
    let changes: TicketUpdateFields;
    let uniqueChildren: string[] = [];
    let projectId = operation.projectId;
    let remoteDetail: any = undefined;
    const ensureRemoteDetail = async () => {
      if (!remoteDetail) {
        const getDetail = saveDeps.getIssueDetail ?? getIssueDetail;
        remoteDetail = await getDetail(ticketId);
      }
      return remoteDetail;
    };

    if (isRetry && primaryEffect?.requestSnapshot && (primaryEffect.requestSnapshot as TicketUpdateRequestSnapshot).request) {
      request = (primaryEffect.requestSnapshot as TicketUpdateRequestSnapshot).request;
      changes = request.fields;
      if (deps?.ticketUpdate?.getIssueDetail && typeof deps.ticketUpdate.getIssueDetail === "function") {
        try {
          await ensureRemoteDetail();
        } catch (err) {
          return { ok: false, outcome: { kind: "failed_before_commit", ticketId, error: err as Error } };
        }
      }
    } else {
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

      // 2. メタデータの解決 (IDマッピング) & projectId 確定
      const children = intent.metadata?.children ?? [];
      uniqueChildren = Array.from(new Set(children.map((c) => c.trim()).filter((c) => c.length > 0)));

      if (!projectId && (Object.keys(metadataChanges).length > 0 || uniqueChildren.length > 0)) {
        try {
          const remote = await ensureRemoteDetail();
          projectId = remote?.ticket?.projectId;
        } catch {
          // non-fatal for general metadata discovery if not required
        }
      }

      // INV-08: Primary write 前に child 作成に必要な prerequisite (projectId) を確定
      if (uniqueChildren.length > 0 && (!projectId || projectId <= 0)) {
        return {
          ok: false,
          outcome: {
            kind: "failed_before_commit",
            ticketId,
            error: new Error(`Project ID could not be determined for child ticket creation on ticket #${ticketId}`),
          },
        };
      }

      let resolvedMetadataFields: any = {};
      if (Object.keys(metadataChanges).length > 0) {
        const resolveFn = saveDeps.resolveMetadataForUpdate ?? resolveMetadataUpdates;
        try {
          resolvedMetadataFields = await resolveFn(metadataChanges, saveDeps, projectId);
        } catch (err) {
          if (deps?.ticketUpdate && !(deps.ticketUpdate as any).resolveMetadataForUpdate && !deps.ticketUpdate.listTrackers && !deps.ticketUpdate.listIssueStatuses) {
            resolvedMetadataFields = {};
          } else {
            return { ok: false, outcome: { kind: "failed_before_commit", ticketId, error: err as Error } };
          }
        }
      }

      changes = {
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

      request = {
        issueId: ticketId,
        fields: changes,
      };
    }

    const snapshot: TicketUpdateRequestSnapshot = {
      kind: "ticket_update",
      request,
    };

    const opKey: SyncOperationKey = operation.key ?? { kind: "ticket", ticketId };
    const revision = operation.intentRevision ?? operation.revision ?? 1;
    const repo = deps?.repository ?? createSyncOperationRepository();

    const existingOp = repo.getOperation(opKey, context.connectionScope);
    if (!existingOp) {
      await repo.saveOperation(operation, context.connectionScope);
    }

    const planResult = await repo.planEffect(
      opKey,
      {
        effectId: "ticket-update",
        kind: "ticket_update",
        operationRevision: revision,
        state: "planned",
        target: { ticketId },
        requestSnapshot: snapshot,
      },
      context.connectionScope,
      revision,
    );
    if (!planResult) {
      return {
        ok: false,
        outcome: {
          kind: "failed_before_commit",
          ticketId,
          error: new Error("Failed to persist planned checkpoint for ticket-update"),
        },
      };
    }

    return {
      ok: true,
      prepared: {
        ticketId,
        projectId,
        changes,
        uniqueChildren,
        request,
        snapshot,
      },
    };
  }

  public async executeSecondaryEffects(
    _operation: UnifiedSyncOperation<TicketUpdateIntent>,
    _prepared: PreparedTicketUpdate,
    _context: OperationHandlerContext,
    _deps?: OperationHandlerDeps,
  ): Promise<{ ok: true } | { ok: false; error: Error; commitUnknown?: boolean }> {
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
    const repo = deps?.repository ?? createSyncOperationRepository();
    const opKey: SyncOperationKey = operation.key ?? { kind: "ticket", ticketId };
    const revision = operation.intentRevision ?? operation.revision ?? 1;

    const currentOp = repo.getOperation(opKey, context.connectionScope);
    if (!currentOp) {
      await repo.saveOperation(operation, context.connectionScope);
    }

    const uniqueChildren = prepared.uniqueChildren;
    const existingPrimaryEffect = (currentOp?.effects ?? operation.effects ?? []).find(
      (e) => e.effectId === "ticket-update" || isPrimaryEffectKind(e.kind),
    );
    if (!existingPrimaryEffect || existingPrimaryEffect.state !== "committed") {
      const isRetry = existingPrimaryEffect?.state === "failed" || existingPrimaryEffect?.state === "commit_unknown";
      const requestToUse: IssueUpdateInput = (existingPrimaryEffect?.requestSnapshot as TicketUpdateRequestSnapshot | undefined)?.request
        ?? prepared.request
        ?? { issueId: ticketId, fields: prepared.changes };

      const updateSnapshot: TicketUpdateRequestSnapshot = {
        kind: "ticket_update",
        request: requestToUse,
      };

      const started = await repo.transitionPrimaryRemoteWrite(
        opKey,
        {
          kind: isRetry ? "start_explicit_retry" : "start",
          requestSnapshot: updateSnapshot,
        },
        context.connectionScope,
        { operationId: operation.operationId, revision, sourcePhase: operation.phase },
      );
      if (!started) {
        return {
          ok: false,
          commitUnknown: false,
          error: new Error("Failed to persist started checkpoint for ticket-update"),
        };
      }

      // 1. Primary PUT
      try {
        if (Object.keys(requestToUse.fields).length > 0) {
          await saveDeps.updateIssue(requestToUse);
        }

        const committed = await repo.transitionPrimaryRemoteWrite(
          opKey,
          {
            kind: "commit",
            remoteId: ticketId,
            projectId: prepared.projectId,
            requestSnapshot: updateSnapshot,
          },
          context.connectionScope,
          { operationId: operation.operationId, revision, sourcePhase: "remote_write_started" },
        );
        if (!committed) {
          return {
            ok: false,
            commitUnknown: true,
            error: new Error("Remote updated but failed to record commit checkpoint"),
          };
        }
      } catch (err) {
        const commitUnknown = isRemoteCommitUnknownError(err);
        const disposition = classifyFailureDisposition(err);
        await repo.transitionPrimaryRemoteWrite(
          opKey,
          commitUnknown
            ? { kind: "commit_unknown", detail: (err as Error).message }
            : { kind: "failed", failure: { disposition, detail: (err as Error).message } },
          context.connectionScope,
          { operationId: operation.operationId, revision, sourcePhase: "remote_write_started" },
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

    // 2. Dependent Effects: Child issue creation (DR-02: After Primary Commit)
    if (uniqueChildren && uniqueChildren.length > 0) {
      const childProjectId = prepared.projectId ?? operation.projectId;

      for (let ordinal = 0; ordinal < uniqueChildren.length; ordinal++) {
        const subject = uniqueChildren[ordinal];
        const effectId = `child-create:${ordinal}`;

        const currentOp = repo.getOperation(opKey, context.connectionScope) ?? operation;
        const existingEffect = currentOp.effects?.find((e) => e.effectId === effectId);

        if (existingEffect?.state === "committed" && existingEffect.remoteId) {
          continue;
        }
        if (
          existingEffect?.state === "commit_unknown" ||
          existingEffect?.state === "compensation_unknown" ||
          existingEffect?.state === "compensation_started"
        ) {
          return {
            ok: false,
            commitUnknown: true,
            error: new Error(`Child effect ${effectId} is in uncertain state`),
          };
        }

        const childRequest: IssueCreateInput = {
          subject,
          description: "",
          parentId: ticketId,
          projectId: childProjectId ?? 0,
        };
        const childSnapshot: ChildTicketCreateRequestSnapshot = {
          kind: "child_create",
          parentTicketId: ticketId,
          projectId: childProjectId ?? 0,
          subject,
          description: "",
          ordinal,
          request: childRequest,
        };

        const planChild = await repo.planEffect(
          opKey,
          {
            effectId,
            kind: "child_create",
            operationRevision: revision,
            state: "planned",
            target: { parentTicketId: ticketId, ordinal },
            requestSnapshot: childSnapshot,
          },
          context.connectionScope,
          revision,
        );
        if (!planChild) {
          return {
            ok: false,
            commitUnknown: false,
            error: new Error(`Failed to plan child effect ${effectId}`),
          };
        }

        const startChild = await repo.transitionEffect(
          opKey,
          effectId,
          { kind: "start", requestSnapshot: childSnapshot },
          context.connectionScope,
          { operationRevision: revision, sourceState: "planned" },
        );
        if (!startChild) {
          return {
            ok: false,
            commitUnknown: false,
            error: new Error(`Failed to start child effect ${effectId}`),
          };
        }

        if (!childProjectId || childProjectId <= 0) {
          throw new Error(`Missing projectId for child issue creation: ${subject}`);
        }

        try {
          const createFn = saveDeps.createIssue ?? createIssue;
          const createdChildId = await createFn(childSnapshot.request ?? childRequest);
          if (!createdChildId) {
            throw new Error(`Failed to create child issue: ${subject}`);
          }
          const committedChild = await repo.transitionEffect(
            opKey,
            effectId,
            { kind: "commit", remoteId: createdChildId, requestSnapshot: childSnapshot },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
          if (!committedChild) {
            await repo.transitionEffect(
              opKey,
              effectId,
              { kind: "mark_commit_unknown" },
              context.connectionScope,
              { operationRevision: revision, sourceState: "started" },
            );
            return {
              ok: false,
              commitUnknown: true,
              error: new Error(`Child issue created but failed to persist commit checkpoint for ${effectId}`),
            };
          }
        } catch (err) {
          const commitUnknown = isRemoteCommitUnknownError(err);
          const disposition = classifyFailureDisposition(err);
          await repo.transitionEffect(
            opKey,
            effectId,
            commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );

          return {
            ok: false,
            commitUnknown,
            error: err as Error,
          };
        }
      }
    }
    return {
      ok: true,
      createdRemoteId: ticketId,
      remoteUpdatedAt: new Date().toISOString(),
    };
  }

  public async reconcileRemote(
    operation: UnifiedSyncOperation<TicketUpdateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{
    ok: true;
    remoteId: number;
    projectId: number;
    remoteUpdatedAt: string;
    canonical: any;
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
      if (!detail || !detail.ticket) {
        return { ok: false, message: `Ticket #${ticketId} not found.` };
      }

      const ticket = detail.ticket;
      const intent = operation.intent;

      if (operation.phase === "commit_unknown" && intent) {
        // commit_unknown からの recovery 時のみ、意図した変更デルタが反映されているかを厳密に検証
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

        // 1. subject 変更の検証
        if (contentChanges.subject !== undefined) {
          if (normalizeTicketText(ticket.subject) !== normalizeTicketText(contentChanges.subject)) {
            return {
              ok: false,
              message: `Remote ticket #${ticketId} subject does not match intended update. Expected "${contentChanges.subject}", got "${ticket.subject}".`,
            };
          }
        }

        // 2. description 変更の検証
        if (contentChanges.description !== undefined) {
          if (normalizeTicketText(ticket.description) !== normalizeTicketText(contentChanges.description)) {
            return {
              ok: false,
              message: `Remote ticket #${ticketId} description does not match intended update.`,
            };
          }
        }

        // 3. metadata 変更の検証
        if (intent.metadata) {
          const metadataChanges = intent.baseMetadata
            ? computeMetadataChanges(intent.baseMetadata, intent.metadata)
            : computeMetadataChanges({ tracker: "", priority: "", status: "", due_date: "", children: [] }, intent.metadata);

          if (metadataChanges.tracker !== undefined && metadataChanges.tracker.trim().length > 0) {
            if (normalizeTicketText(ticket.trackerName) !== normalizeTicketText(metadataChanges.tracker)) {
              return {
                ok: false,
                message: `Remote ticket #${ticketId} tracker does not match intended update. Expected "${metadataChanges.tracker}", got "${ticket.trackerName}".`,
              };
            }
          }

          if (metadataChanges.status !== undefined && metadataChanges.status.trim().length > 0) {
            if (normalizeTicketText(ticket.statusName) !== normalizeTicketText(metadataChanges.status)) {
              return {
                ok: false,
                message: `Remote ticket #${ticketId} status does not match intended update. Expected "${metadataChanges.status}", got "${ticket.statusName}".`,
              };
            }
          }

          if (metadataChanges.priority !== undefined && metadataChanges.priority.trim().length > 0) {
            if (normalizeTicketText(ticket.priorityName) !== normalizeTicketText(metadataChanges.priority)) {
              return {
                ok: false,
                message: `Remote ticket #${ticketId} priority does not match intended update. Expected "${metadataChanges.priority}", got "${ticket.priorityName}".`,
              };
            }
          }

          if (metadataChanges.due_date !== undefined) {
            const expectedDueDate = metadataChanges.due_date.trim();
            const remoteDueDate = (ticket.dueDate ?? "").trim();
            if (expectedDueDate !== remoteDueDate) {
              return {
                ok: false,
                message: `Remote ticket #${ticketId} due_date does not match intended update. Expected "${expectedDueDate}", got "${remoteDueDate}".`,
              };
            }
          }

          if (metadataChanges.start_date !== undefined) {
            const expectedStartDate = metadataChanges.start_date.trim();
            const remoteStartDate = (ticket.startDate ?? "").trim();
            if (expectedStartDate !== remoteStartDate) {
              return {
                ok: false,
                message: `Remote ticket #${ticketId} start_date does not match intended update. Expected "${expectedStartDate}", got "${remoteStartDate}".`,
              };
            }
          }
        }
      }

      return {
        ok: true,
        remoteId: ticketId,
        projectId: ticket.projectId,
        remoteUpdatedAt: ticket.updatedAt ?? "",
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

  public async resolveEffect(input: {
    key: SyncOperationKey;
    effectId: string;
    operation: UnifiedSyncOperation<TicketUpdateIntent>;
    context: OperationHandlerContext;
    deps: OperationHandlerDeps & { repository: SyncOperationRepository };
    resolution: EffectResolution;
  }): Promise<SyncOutcome> {
    const { key, effectId, operation, context, deps, resolution } = input;
    const repo = deps.repository;
    const revision = operation.intentRevision ?? operation.revision ?? 1;
    const scope = context.connectionScope;
    const effect = (operation.effects ?? []).find((e) => e.effectId === effectId);
    if (!effect) {
      return { kind: "failed_before_commit", error: new Error(`Effect not found: ${effectId}`) };
    }

    const saveDeps: any = deps?.ticketUpdate
      ? { ...defaultTicketDeps, ...deps.ticketUpdate }
      : { ...defaultTicketDeps };

    if (resolution.kind === "mark_failed") {
      const marked = await repo.transitionEffect(
        key,
        effectId,
        { kind: "mark_failed", detail: "Manually marked as failed", disposition: resolution.disposition ?? "retryable", category: resolution.category },
        scope,
        { operationRevision: revision, sourceState: effect.state },
      );
      if (!marked) {
        return { kind: "failed_before_commit", error: new Error(`Failed to mark effect as failed: ${effectId}`) };
      }
      return {
        kind: "remote_committed",
        ticketId: operation.ticketId ?? 0,
        pending: "remote_reconcile",
        message: `Effect ${effectId} marked as failed`,
      };
    }

    if (effect.kind === "attachment_upload" || effect.kind === "image_upload") {
      if (resolution.kind === "assume_committed") {
        const token = resolution.token ?? effect.token;
        const assumed = await repo.transitionEffect(
          key,
          effectId,
          { kind: "assume_committed", token, remoteId: resolution.remoteId },
          scope,
          { operationRevision: revision, sourceState: effect.state },
        );
        if (!assumed) {
          return { kind: "failed_before_commit", error: new Error(`Failed to assume committed for effect ${effectId}`) };
        }
        return {
          kind: "remote_committed",
          ticketId: operation.ticketId ?? 0,
          pending: "remote_reconcile",
          message: `Attachment effect ${effectId} assumed committed`,
        };
      }

      if (resolution.kind === "retry_effect") {
        if (effect.state === "failed" && effect.failure?.disposition === "non_retriable") {
          return { kind: "failed_before_commit", error: new Error("Cannot retry non-retriable failure") };
        }
        const filePath = effect.target.filePath ?? (effect.requestSnapshot as UploadRequestSnapshot | undefined)?.filePath;
        if (!filePath) {
          return { kind: "failed_before_commit", error: new Error(`Cannot retry attachment without filePath for effect ${effectId}`) };
        }

        const currentFile = computeFileHashAndSize(filePath);
        const snapshot = effect.requestSnapshot as UploadRequestSnapshot | undefined;
        if (snapshot?.contentHash && currentFile?.contentHash && snapshot.contentHash !== currentFile.contentHash) {
          return {
            kind: "failed_before_commit",
            error: new Error(`File content has changed since snapshot. Retry rejected.`),
          };
        }
        const contentHash = currentFile?.contentHash ?? snapshot?.contentHash;
        const contentSize = currentFile?.contentSize ?? snapshot?.contentSize;
        if (!contentHash || contentSize === undefined) {
          return { kind: "failed_before_commit", error: new Error(`Cannot compute hash for file: ${filePath}`) };
        }

        const uploadSnapshot: UploadRequestSnapshot = {
          kind: "upload",
          filePath,
          filename: effect.target.filename ?? snapshot?.filename ?? "attachment",
          contentType: snapshot?.contentType ?? "application/octet-stream",
          contentHash,
          contentSize,
        };

        const started = await repo.transitionEffect(
          key,
          effectId,
          { kind: "start_explicit_retry", requestSnapshot: uploadSnapshot },
          scope,
          { operationRevision: revision, sourceState: effect.state },
        );
        if (!started) {
          return { kind: "failed_before_commit", error: new Error(`Failed to start retry for effect ${effectId}`) };
        }
        try {
          const uploadFn = saveDeps.uploadFile ?? uploadFileAttachment;
          const res = await uploadFn(filePath);
          const committed = await repo.transitionEffect(
            key,
            effectId,
            { kind: "commit", token: res.token, target: { filePath, filename: effect.target.filename ?? res.filename }, requestSnapshot: uploadSnapshot },
            scope,
            { operationRevision: revision, sourceState: "started" },
          );
          if (!committed) {
            return { kind: "commit_unknown", operationId: operation.operationId, message: `Attachment uploaded but commit checkpoint failed for ${effectId}` };
          }
          return { kind: "remote_committed", ticketId: operation.ticketId ?? 0, pending: "remote_reconcile", message: `Attachment ${effectId} uploaded successfully` };
        } catch (err) {
          const isUnknown = isRemoteCommitUnknownError(err);
          const disposition = classifyFailureDisposition(err);
          await repo.transitionEffect(
            key,
            effectId,
            isUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
            scope,
            { operationRevision: revision, sourceState: "started" },
          );
          return isUnknown
            ? { kind: "commit_unknown", operationId: operation.operationId, message: (err as Error).message }
            : { kind: "failed_before_commit", error: err as Error };
        }
      }
    }

    if (effect.kind === "child_create") {
      const childSnapshot = effect.requestSnapshot as ChildTicketCreateRequestSnapshot | undefined;
      const parentTicketId = childSnapshot?.parentTicketId ?? effect.target.parentTicketId ?? operation.ticketId;

      if (resolution.kind === "link_remote_child" || (resolution.kind === "assume_committed" && resolution.remoteId)) {
        const remoteChildId = resolution.kind === "link_remote_child" ? resolution.remoteId : resolution.remoteId!;
        const getDetail = deps?.ticketUpdate?.getIssueDetail ?? saveDeps.getIssueDetail ?? getIssueDetail;
        try {
          const detail = await getDetail(remoteChildId);
          if (!detail || !detail.ticket) {
            return { kind: "failed_before_commit", error: new Error(`Remote ticket #${remoteChildId} not found.`) };
          }

          if (parentTicketId && detail.ticket.parentId !== parentTicketId) {
            return {
              kind: "failed_before_commit",
              error: new Error(`Parent ticket ID mismatch: child #${remoteChildId} has parent ${detail.ticket.parentId}, expected ${parentTicketId}`),
            };
          }
          const expectedProj = childSnapshot?.projectId ?? operation.projectId;
          if (expectedProj && detail.ticket.projectId !== expectedProj) {
            return {
              kind: "failed_before_commit",
              error: new Error(`Project mismatch: child #${remoteChildId} belongs to project ${detail.ticket.projectId}, expected ${expectedProj}`),
            };
          }
          const expectedSubj = childSnapshot?.subject ?? (operation.intent?.childTickets?.[effect.target.ordinal ?? 0]?.subject) ?? (operation.intent?.metadata?.children?.[effect.target.ordinal ?? 0]);
          if (expectedSubj && normalizeTicketText(detail.ticket.subject) !== normalizeTicketText(expectedSubj)) {
            return {
              kind: "failed_before_commit",
              error: new Error(`Subject mismatch: child #${remoteChildId} has subject "${detail.ticket.subject}", expected "${expectedSubj}"`),
            };
          }

          const assumed = await repo.transitionEffect(
            key,
            effectId,
            { kind: "assume_committed", remoteId: remoteChildId },
            scope,
            { operationRevision: revision, sourceState: effect.state },
          );
          if (!assumed) {
            return { kind: "failed_before_commit", error: new Error(`Failed to assume committed for child effect ${effectId}`) };
          }

          return this.finalizeOperationIfReady(assumed as UnifiedSyncOperation<TicketUpdateIntent>, context, deps);
        } catch (err) {
          return { kind: "failed_before_commit", error: err as Error };
        }
      }

      if (resolution.kind === "retry_effect") {
        if (effect.state === "commit_unknown") {
          return {
            kind: "failed_before_commit",
            error: new Error("Blind retry for child_create in commit_unknown is forbidden without verified absence."),
          };
        }

        if (effect.state === "failed" && effect.failure?.disposition === "non_retriable") {
          return { kind: "failed_before_commit", error: new Error("Cannot retry non-retriable failure.") };
        }

        const subject = childSnapshot?.subject ?? (operation.intent?.childTickets?.[effect.target.ordinal ?? 0]?.subject) ?? (operation.intent?.metadata?.children?.[effect.target.ordinal ?? 0]);
        const projectId = childSnapshot?.projectId ?? operation.projectId ?? 0;

        if (!parentTicketId || !subject) {
          return { kind: "failed_before_commit", error: new Error(`Cannot retry child create for effect ${effectId}: missing parent or subject`) };
        }

        const childRequest: IssueCreateInput = childSnapshot?.request ?? {
          subject: subject ?? "",
          description: childSnapshot?.description ?? "",
          parentId: parentTicketId,
          projectId,
        };

        const updatedSnapshot: ChildTicketCreateRequestSnapshot = {
          kind: "child_create",
          parentTicketId,
          projectId,
          subject: childRequest.subject,
          description: childRequest.description,
          ordinal: effect.target.ordinal,
          request: childRequest,
        };

        const started = await repo.transitionEffect(
          key,
          effectId,
          { kind: "start_explicit_retry", requestSnapshot: updatedSnapshot },
          scope,
          { operationRevision: revision, sourceState: effect.state },
        );
        if (!started) {
          return { kind: "failed_before_commit", error: new Error(`Failed to start retry for effect ${effectId}`) };
        }
        try {
          const createFn = saveDeps.createIssue ?? createIssue;
          const createdChildId = await createFn(childRequest);
          const committed = await repo.transitionEffect(
            key,
            effectId,
            { kind: "commit", remoteId: createdChildId, requestSnapshot: updatedSnapshot },
            scope,
            { operationRevision: revision, sourceState: "started" },
          );
          if (!committed) {
            return { kind: "commit_unknown", operationId: operation.operationId, message: `Child issue created but failed to persist commit checkpoint for ${effectId}` };
          }
          return this.finalizeOperationIfReady(committed as UnifiedSyncOperation<TicketUpdateIntent>, context, deps);
        } catch (err) {
          const isUnknown = isRemoteCommitUnknownError(err);
          const disposition = classifyFailureDisposition(err);
          await repo.transitionEffect(
            key,
            effectId,
            isUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
            scope,
            { operationRevision: revision, sourceState: "started" },
          );
          return isUnknown
            ? { kind: "commit_unknown", operationId: operation.operationId, message: (err as Error).message }
            : { kind: "failed_before_commit", error: err as Error };
        }
      }
    }

    return { kind: "failed_before_commit", error: new Error(`Unsupported effect recovery for ${effectId}`) };
  }

  private async finalizeOperationIfReady(
    op: UnifiedSyncOperation<TicketUpdateIntent>,
    context: OperationHandlerContext,
    deps: OperationHandlerDeps & { repository: SyncOperationRepository },
  ): Promise<SyncOutcome> {
    const parentCommitted = (op.effects ?? []).some(
      (e) => (e.effectId === "ticket-update" || e.kind === "ticket_update") && e.state === "committed"
    );

    const hasUnresolved = (op.effects ?? []).some(
      (e) => e.state === "commit_unknown" || e.state === "failed" || e.state === "started" || e.state === "compensation_started" || e.state === "compensation_unknown"
    );

    if (!parentCommitted || hasUnresolved) {
      return {
        kind: "remote_committed",
        ticketId: op.ticketId ?? 0,
        pending: "remote_reconcile",
        message: "Secondary effects resolved partially",
      };
    }

    const reconciled = await this.reconcileRemote(op, context, deps);
    if (!reconciled.ok) {
      return {
        kind: "remote_committed",
        ticketId: op.ticketId ?? 0,
        pending: "remote_reconcile",
        message: reconciled.message,
      };
    }

    const fin = await this.finalizeLocal(op, reconciled.canonical, context, deps);
    if (!fin.ok) {
      return {
        kind: "remote_committed",
        ticketId: op.ticketId ?? 0,
        pending: "local_finalize",
        message: fin.message,
      };
    }

    const key = op.key ?? { kind: "ticket", ticketId: op.ticketId ?? 0 };
    const compOp = await deps.repository.completeOperation(key, context.connectionScope, undefined, {
      canonical: reconciled.canonical,
      remoteUpdatedAt: op.remoteUpdatedAt,
    });
    if (compOp) {
      return {
        kind: "completed",
        ticketId: op.ticketId ?? 0,
      };
    }
    return {
      kind: "remote_committed",
      ticketId: op.ticketId ?? 0,
      pending: "local_finalize",
      message: "Failed to persist complete state",
    };
  }
}

import {
  extractMarkdownImageLinks,
  applyMarkdownImageReplacements,
  isExternalMarkdownImagePath,
} from "../../utils/markdownImageLinks";
import { validateLocalImagePath } from "../../utils/markdownImageValidation";

export interface PreparedCommentData {
  ticketId: number;
  commentId?: number;
  rawBody: string;
  body: string;
  imageLinks: Array<{ path: string; range: { start: number; end: number }; resolvedPath?: string }>;
  uploads: UploadToken[];
  uploadSummary?: any;
}

export class CommentCreateHandler implements OperationHandler<CommentCreateIntent, PreparedCommentData> {
  public async prepare(
    operation: UnifiedSyncOperation<CommentCreateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: PreparedCommentData } | { ok: false; outcome: SyncOutcome }> {
    const intent = operation.intent;
    const ticketId = operation.ticketId ?? intent?.ticketId;
    if (!ticketId || !intent) {
      return { ok: false, outcome: { kind: "failed_before_commit", error: new Error("Missing CommentCreateIntent") } };
    }

    const rawBody = intent.body ?? "";

    if (containsConflictMarkers(rawBody)) {
      return { ok: false, outcome: { kind: "failed_before_commit", ticketId, error: new Error(vscode.l10n.t("Resolve all merge conflict markers before syncing.")) } };
    }

    const validation = validateComment(rawBody);
    if (!validation.valid) {
      return { ok: false, outcome: { kind: "failed_before_commit", ticketId, error: new Error(validation.message ?? "Invalid comment.") } };
    }

    // Markdown 画像リンクのローカル解析のみ実行 (リモート mutation は prepare で行わない)
    const links = extractMarkdownImageLinks(rawBody);
    const imageLinks: PreparedCommentData["imageLinks"] = [];

    for (const link of links) {
      if (isExternalMarkdownImagePath(link.path)) {
        continue;
      }
      let resolvedPath: string | undefined = undefined;
      if (path.isAbsolute(link.path)) {
        resolvedPath = link.path;
      } else if (intent.baseDir) {
        resolvedPath = path.resolve(intent.baseDir, link.path);
      }

      if (!resolvedPath) {
        return {
          ok: false,
          outcome: { kind: "failed_before_commit", ticketId, error: new Error(`Relative path cannot be resolved: ${link.path}`) },
        };
      }

      const val = await validateLocalImagePath({ filePath: resolvedPath });
      if (!val.valid) {
        // fallback to baseDir/images/filename
        if (intent.baseDir) {
          const fallbackPath = path.resolve(intent.baseDir, "images", link.path);
          const fallbackVal = await validateLocalImagePath({ filePath: fallbackPath });
          if (fallbackVal.valid) {
            resolvedPath = fallbackPath;
          } else {
            return {
              ok: false,
              outcome: { kind: "failed_before_commit", ticketId, error: new Error(val.reason ?? `Invalid image path: ${link.path}`) },
            };
          }
        } else {
          return {
            ok: false,
            outcome: { kind: "failed_before_commit", ticketId, error: new Error(val.reason ?? `Invalid image path: ${link.path}`) },
          };
        }
      }

      imageLinks.push({ path: link.path, range: link.range, resolvedPath });
    }

    return {
      ok: true,
      prepared: {
        ticketId,
        rawBody,
        body: rawBody,
        imageLinks,
        uploads: [],
      },
    };
  }

  public async executeSecondaryEffects(
    operation: UnifiedSyncOperation<CommentCreateIntent>,
    prepared: PreparedCommentData,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; uploadTokens?: IssueUploadInput[] } | { ok: false; error: Error; commitUnknown?: boolean }> {
    const commentDeps = { ...defaultCommentDeps, ...deps?.comment };
    const repo = deps?.repository ?? createSyncOperationRepository();
    const opKey: SyncOperationKey = operation.key ?? { kind: "comment", ticketId: prepared.ticketId, documentUri: operation.documentUri };
    const revision = operation.intentRevision ?? operation.revision ?? 1;

    const currentOp = repo.getOperation(opKey, context.connectionScope);
    if (!currentOp) {
      await repo.saveOperation(operation, context.connectionScope);
    }

    const resolvedMap = new Map<string, UploadToken>();

    for (let ordinal = 0; ordinal < prepared.imageLinks.length; ordinal++) {
      const link = prepared.imageLinks[ordinal];
      const filePath = link.resolvedPath;
      if (!filePath) {
        continue;
      }

      const effectId = `image:markdown:${ordinal}:${filePath}`;
      const currentOp = repo.getOperation(opKey, context.connectionScope) ?? operation;
      const existingEffect = currentOp.effects?.find((e) => e.effectId === effectId);

      if (existingEffect?.state === "committed" && existingEffect.token) {
        resolvedMap.set(filePath, {
          token: existingEffect.token,
          filename: existingEffect.target?.filename ?? path.basename(filePath),
          content_type: "image/png",
        });
        continue;
      }

      const fileId = computeFileHashAndSize(filePath);
      if (!fileId) {
        return { ok: false, error: new Error(`Failed to compute hash for image: ${filePath}`) };
      }
      const uploadSnapshot: UploadRequestSnapshot = {
        kind: "upload",
        filePath,
        filename: path.basename(filePath),
        contentType: "image/png",
        contentHash: fileId.contentHash,
        contentSize: fileId.contentSize,
      };

      const planImg = await repo.planEffect(
        opKey,
        {
          effectId,
          kind: "image_upload",
          operationRevision: revision,
          state: "planned",
          target: { filePath, filename: path.basename(filePath) },
          requestSnapshot: uploadSnapshot,
        },
        context.connectionScope,
        revision,
      );
      if (!planImg) {
        return { ok: false, error: new Error(`Failed to plan effect ${effectId}`) };
      }

      const startImg = await repo.transitionEffect(
        opKey,
        effectId,
        { kind: "start", requestSnapshot: uploadSnapshot },
        context.connectionScope,
        { operationRevision: revision, sourceState: "planned" },
      );
      if (!startImg) {
        return { ok: false, error: new Error(`Failed to start effect ${effectId}`) };
      }

      try {
        const upload = await commentDeps.uploadFile(filePath);
        const commitImg = await repo.transitionEffect(
          opKey,
          effectId,
          { kind: "commit", token: upload.token, target: { filePath, filename: upload.filename }, requestSnapshot: uploadSnapshot },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
        );
        if (!commitImg) {
          return { ok: false, error: new Error(`Failed to commit effect ${effectId}`), commitUnknown: true };
        }
        resolvedMap.set(filePath, {
          token: upload.token,
          filename: upload.filename,
          content_type: upload.contentType,
        });
      } catch (err) {
        const commitUnknown = isRemoteCommitUnknownError(err);
        const disposition = classifyFailureDisposition(err);
        await repo.transitionEffect(
          opKey,
          effectId,
          commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
        );
        return { ok: false, error: err as Error, commitUnknown };
      }
    }

    const replacements = prepared.imageLinks.flatMap((link) => {
      const entry = link.resolvedPath ? resolvedMap.get(link.resolvedPath) : undefined;
      if (!entry) {
        return [];
      }
      return [{ range: link.range, value: entry.filename }];
    });

    prepared.body = applyMarkdownImageReplacements(prepared.rawBody, replacements);
    prepared.uploads = Array.from(resolvedMap.values());

    return {
      ok: true,
      uploadTokens: prepared.uploads.map((u) => ({ token: u.token, filename: u.filename, content_type: u.content_type })),
    };
  }

  public async executeRemoteWrite(
    operation: UnifiedSyncOperation<CommentCreateIntent>,
    prepared: PreparedCommentData,
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
    const repo = deps?.repository ?? createSyncOperationRepository();
    const opKey: SyncOperationKey = operation.key ?? { kind: "comment", ticketId: prepared.ticketId, documentUri: operation.documentUri };
    const revision = operation.intentRevision ?? operation.revision ?? 1;

    const currentOp = repo.getOperation(opKey, context.connectionScope);
    if (!currentOp) {
      await repo.saveOperation(operation, context.connectionScope);
    }

    const existingPrimaryEffect = (currentOp?.effects ?? operation.effects ?? []).find(
      (e) => e.effectId === "comment-create" || isPrimaryEffectKind(e.kind),
    );
    const isRetry = existingPrimaryEffect?.state === "failed" || existingPrimaryEffect?.state === "commit_unknown";

    const requestSnapshot: CommentCreateRequestSnapshot = (existingPrimaryEffect?.requestSnapshot as CommentCreateRequestSnapshot | undefined) ?? {
      kind: "comment_create",
      request: {
        ticketId: prepared.ticketId,
        notes: prepared.body,
        uploads: prepared.uploads.length > 0 ? prepared.uploads : undefined,
      },
      submittedBody: prepared.body,
      submittedUploads: prepared.uploads.map((u) => ({ token: u.token, filename: u.filename, contentType: u.content_type })),
    };

    const started = await repo.transitionPrimaryRemoteWrite(
      opKey,
      {
        kind: isRetry ? "start_explicit_retry" : "start",
        requestSnapshot,
      },
      context.connectionScope,
      { operationId: operation.operationId, revision, sourcePhase: operation.phase },
    );
    if (!started) {
      return {
        ok: false,
        commitUnknown: false,
        error: new Error("Failed to persist started checkpoint for comment-create"),
        outcome: { kind: "failed_before_commit", ticketId: prepared.ticketId, error: new Error("Failed to persist started checkpoint for comment-create") },
      };
    }

    try {
      await commentDeps.addComment(
        requestSnapshot.request?.ticketId ?? prepared.ticketId,
        requestSnapshot.request?.notes ?? prepared.body,
        requestSnapshot.request?.uploads ?? (prepared.uploads.length > 0 ? prepared.uploads : undefined),
      );

      const committed = await repo.transitionPrimaryRemoteWrite(
        opKey,
        {
          kind: "commit",
          projectId: operation.projectId,
          requestSnapshot,
        },
        context.connectionScope,
        { operationId: operation.operationId, revision, sourcePhase: "remote_write_started" },
      );
      if (!committed) {
        return {
          ok: false,
          commitUnknown: true,
          error: new Error("Comment created but failed to persist commit checkpoint"),
          outcome: { kind: "commit_unknown", operationId: operation.operationId, ticketId: prepared.ticketId, message: "Comment created but failed to persist commit checkpoint" },
        };
      }

      return {
        ok: true,
        projectId: operation.projectId,
        remoteUpdatedAt: new Date().toISOString(),
      };
    } catch (err) {
      const commitUnknown = isRemoteCommitUnknownError(err);
      const disposition = classifyFailureDisposition(err);
      await repo.transitionPrimaryRemoteWrite(
        opKey,
        commitUnknown
          ? { kind: "commit_unknown", detail: (err as Error).message }
          : { kind: "failed", failure: { disposition, detail: (err as Error).message } },
        context.connectionScope,
        { operationId: operation.operationId, revision, sourcePhase: "remote_write_started" },
      );
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

    // INV-03: Actual submitted request を使用して reconcile する (C-02)
    const primaryEffect = operation.effects?.find((e) => e.effectId === "comment-create" || e.kind === "comment_create");
    const submittedBody = (primaryEffect?.requestSnapshot as CommentCreateRequestSnapshot | undefined)?.submittedBody
      ?? primaryEffect?.target?.submittedBody
      ?? operation.intent?.body
      ?? "";

    const identity = await reconcileCommentCommitUnknown(
      {
        ticketId,
        commentId: operation.commentId,
        body: submittedBody,
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
      if (operation.intent?.finalizeDraft) {
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

  public async resolveEffect(input: {
    key: SyncOperationKey;
    effectId: string;
    operation: UnifiedSyncOperation<CommentCreateIntent>;
    context: OperationHandlerContext;
    deps: OperationHandlerDeps & { repository: SyncOperationRepository };
    resolution: EffectResolution;
  }): Promise<SyncOutcome> {
    const { key, effectId, operation, context, deps, resolution } = input;
    const repo = deps.repository;
    const revision = operation.intentRevision ?? operation.revision ?? 1;
    const scope = context.connectionScope;
    const effect = (operation.effects ?? []).find((e) => e.effectId === effectId);
    if (!effect) {
      return { kind: "failed_before_commit", error: new Error(`Effect not found: ${effectId}`) };
    }

    const commentDeps = { ...defaultCommentDeps, ...deps.comment };

    if (resolution.kind === "mark_failed") {
      const marked = await repo.transitionEffect(
        key,
        effectId,
        { kind: "mark_failed", detail: "Manually marked as failed", disposition: resolution.disposition ?? "retryable", category: resolution.category },
        scope,
        { operationRevision: revision, sourceState: effect.state },
      );
      if (!marked) {
        return { kind: "failed_before_commit", error: new Error(`Failed to mark effect as failed: ${effectId}`) };
      }
      return {
        kind: "remote_committed",
        ticketId: operation.ticketId ?? 0,
        pending: "remote_reconcile",
        message: `Effect ${effectId} marked as failed`,
      };
    }

    if (effect.kind === "image_upload" || effect.kind === "attachment_upload") {
      if (resolution.kind === "assume_committed") {
        const token = resolution.token ?? effect.token;
        const assumed = await repo.transitionEffect(
          key,
          effectId,
          { kind: "assume_committed", token, remoteId: resolution.remoteId },
          scope,
          { operationRevision: revision, sourceState: effect.state },
        );
        if (!assumed) {
          return { kind: "failed_before_commit", error: new Error(`Failed to assume committed for effect ${effectId}`) };
        }
        return {
          kind: "remote_committed",
          ticketId: operation.ticketId ?? 0,
          commentId: operation.commentId,
          pending: "remote_reconcile",
          message: `Attachment effect ${effectId} assumed committed`,
        };
      }

      if (resolution.kind === "retry_effect") {
        if (effect.state === "failed" && effect.failure?.disposition === "non_retriable") {
          return { kind: "failed_before_commit", error: new Error("Cannot retry non-retriable failure") };
        }
        const filePath = effect.target.filePath ?? (effect.requestSnapshot as UploadRequestSnapshot | undefined)?.filePath;
        if (!filePath) {
          return { kind: "failed_before_commit", error: new Error(`Cannot retry image upload without filePath for effect ${effectId}`) };
        }

        const currentFile = computeFileHashAndSize(filePath);
        const snapshot = effect.requestSnapshot as UploadRequestSnapshot | undefined;
        if (snapshot?.contentHash && currentFile?.contentHash && snapshot.contentHash !== currentFile.contentHash) {
          return {
            kind: "failed_before_commit",
            error: new Error(`File content has changed since snapshot. Retry rejected.`),
          };
        }
        const contentHash = currentFile?.contentHash ?? snapshot?.contentHash;
        const contentSize = currentFile?.contentSize ?? snapshot?.contentSize;
        if (!contentHash || contentSize === undefined) {
          return { kind: "failed_before_commit", error: new Error(`Cannot compute hash for image: ${filePath}`) };
        }

        const uploadSnapshot: UploadRequestSnapshot = {
          kind: "upload",
          filePath,
          filename: effect.target.filename ?? snapshot?.filename ?? path.basename(filePath),
          contentType: snapshot?.contentType ?? "image/png",
          contentHash,
          contentSize,
        };

        const started = await repo.transitionEffect(
          key,
          effectId,
          { kind: "start_explicit_retry", requestSnapshot: uploadSnapshot },
          scope,
          { operationRevision: revision, sourceState: effect.state },
        );
        if (!started) {
          return { kind: "failed_before_commit", error: new Error(`Failed to start retry for effect ${effectId}`) };
        }
        try {
          const upload = await commentDeps.uploadFile(filePath);
          const committed = await repo.transitionEffect(
            key,
            effectId,
            { kind: "commit", token: upload.token, target: { filePath, filename: upload.filename }, requestSnapshot: uploadSnapshot },
            scope,
            { operationRevision: revision, sourceState: "started" },
          );
          if (!committed) {
            return { kind: "commit_unknown", operationId: operation.operationId, message: `Image uploaded but commit checkpoint failed for ${effectId}` };
          }
          return { kind: "remote_committed", ticketId: operation.ticketId ?? 0, commentId: operation.commentId, pending: "remote_reconcile", message: `Image ${effectId} uploaded successfully` };
        } catch (err) {
          const isUnknown = isRemoteCommitUnknownError(err);
          const disposition = classifyFailureDisposition(err);
          await repo.transitionEffect(
            key,
            effectId,
            isUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
            scope,
            { operationRevision: revision, sourceState: "started" },
          );
          return isUnknown
            ? { kind: "commit_unknown", operationId: operation.operationId, message: (err as Error).message }
            : { kind: "failed_before_commit", error: err as Error };
        }
      }
    }

    return { kind: "failed_before_commit", error: new Error(`Unsupported effect recovery for ${effectId}`) };
  }
}

export class CommentUpdateHandler implements OperationHandler<CommentUpdateIntent, PreparedCommentData> {
  public async prepare(
    operation: UnifiedSyncOperation<CommentUpdateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: PreparedCommentData } | { ok: false; outcome: SyncOutcome }> {
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
      } catch {
        // non-fatal
      }
    }

    // Markdown 画像リンクのローカル解析のみ実行 (リモート mutation は prepare で行わない)
    const links = extractMarkdownImageLinks(nextContent);
    const imageLinks: PreparedCommentData["imageLinks"] = [];

    for (const link of links) {
      if (isExternalMarkdownImagePath(link.path)) {
        continue;
      }
      let resolvedPath: string | undefined = undefined;
      if (path.isAbsolute(link.path)) {
        resolvedPath = link.path;
      } else if (intent.baseDir) {
        resolvedPath = path.resolve(intent.baseDir, link.path);
      }

      if (!resolvedPath) {
        return {
          ok: false,
          outcome: { kind: "failed_before_commit", ticketId, commentId, error: new Error(`Relative path cannot be resolved: ${link.path}`) },
        };
      }

      const val = await validateLocalImagePath({ filePath: resolvedPath });
      if (!val.valid) {
        if (intent.baseDir) {
          const fallbackPath = path.resolve(intent.baseDir, "images", link.path);
          const fallbackVal = await validateLocalImagePath({ filePath: fallbackPath });
          if (fallbackVal.valid) {
            resolvedPath = fallbackPath;
          } else {
            return {
              ok: false,
              outcome: { kind: "failed_before_commit", ticketId, commentId, error: new Error(val.reason ?? `Invalid image path: ${link.path}`) },
            };
          }
        } else {
          return {
            ok: false,
            outcome: { kind: "failed_before_commit", ticketId, commentId, error: new Error(val.reason ?? `Invalid image path: ${link.path}`) },
          };
        }
      }

      imageLinks.push({ path: link.path, range: link.range, resolvedPath });
    }

    return {
      ok: true,
      prepared: {
        ticketId,
        commentId,
        rawBody: nextContent,
        body: nextContent,
        imageLinks,
        uploads: [],
      },
    };
  }

  public async executeSecondaryEffects(
    operation: UnifiedSyncOperation<CommentUpdateIntent>,
    prepared: PreparedCommentData,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; uploadTokens?: IssueUploadInput[] } | { ok: false; error: Error; commitUnknown?: boolean }> {
    const commentDeps = { ...defaultCommentDeps, ...deps?.comment };
    const repo = deps?.repository ?? createSyncOperationRepository();
    const opKey: SyncOperationKey = operation.key ?? { kind: "comment", ticketId: prepared.ticketId, commentId: prepared.commentId, documentUri: operation.documentUri };
    const revision = operation.intentRevision ?? operation.revision ?? 1;

    const currentOp = repo.getOperation(opKey, context.connectionScope);
    if (!currentOp) {
      await repo.saveOperation(operation, context.connectionScope);
    }

    const resolvedMap = new Map<string, UploadToken>();

    for (let ordinal = 0; ordinal < prepared.imageLinks.length; ordinal++) {
      const link = prepared.imageLinks[ordinal];
      const filePath = link.resolvedPath;
      if (!filePath) {
        continue;
      }

      const effectId = `image:markdown:${ordinal}:${filePath}`;
      const currentOp = repo.getOperation(opKey, context.connectionScope) ?? operation;
      const existingEffect = currentOp.effects?.find((e) => e.effectId === effectId);

      if (existingEffect?.state === "committed" && existingEffect.token) {
        resolvedMap.set(filePath, {
          token: existingEffect.token,
          filename: existingEffect.target?.filename ?? path.basename(filePath),
          content_type: "image/png",
        });
        continue;
      }

      const fileId = computeFileHashAndSize(filePath);
      if (!fileId) {
        return { ok: false, error: new Error(`Failed to compute hash for image: ${filePath}`) };
      }
      const uploadSnapshot: UploadRequestSnapshot = {
        kind: "upload",
        filePath,
        filename: path.basename(filePath),
        contentType: "image/png",
        contentHash: fileId.contentHash,
        contentSize: fileId.contentSize,
      };

      const planImg = await repo.planEffect(
        opKey,
        {
          effectId,
          kind: "image_upload",
          operationRevision: revision,
          state: "planned",
          target: { filePath, filename: path.basename(filePath) },
          requestSnapshot: uploadSnapshot,
        },
        context.connectionScope,
        revision,
      );
      if (!planImg) {
        return { ok: false, error: new Error(`Failed to plan effect ${effectId}`) };
      }

      const startImg = await repo.transitionEffect(
        opKey,
        effectId,
        { kind: "start", requestSnapshot: uploadSnapshot },
        context.connectionScope,
        { operationRevision: revision, sourceState: "planned" },
      );
      if (!startImg) {
        return { ok: false, error: new Error(`Failed to start effect ${effectId}`) };
      }

      try {
        const upload = await commentDeps.uploadFile(filePath);
        const commitImg = await repo.transitionEffect(
          opKey,
          effectId,
          { kind: "commit", token: upload.token, target: { filePath, filename: upload.filename }, requestSnapshot: uploadSnapshot },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
        );
        if (!commitImg) {
          return { ok: false, error: new Error(`Failed to commit effect ${effectId}`), commitUnknown: true };
        }
        resolvedMap.set(filePath, {
          token: upload.token,
          filename: upload.filename,
          content_type: upload.contentType,
        });
      } catch (err) {
        const commitUnknown = isRemoteCommitUnknownError(err);
        const disposition = classifyFailureDisposition(err);
        await repo.transitionEffect(
          opKey,
          effectId,
          commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
        );
        return { ok: false, error: err as Error, commitUnknown };
      }
    }

    const replacements = prepared.imageLinks.flatMap((link) => {
      const entry = link.resolvedPath ? resolvedMap.get(link.resolvedPath) : undefined;
      if (!entry) {
        return [];
      }
      return [{ range: link.range, value: entry.filename }];
    });

    prepared.body = applyMarkdownImageReplacements(prepared.rawBody, replacements);
    prepared.uploads = Array.from(resolvedMap.values());

    return {
      ok: true,
      uploadTokens: prepared.uploads.map((u) => ({ token: u.token, filename: u.filename, content_type: u.content_type })),
    };
  }

  public async executeRemoteWrite(
    operation: UnifiedSyncOperation<CommentUpdateIntent>,
    prepared: PreparedCommentData,
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
    const repo = deps?.repository ?? createSyncOperationRepository();
    const opKey: SyncOperationKey = operation.key ?? { kind: "comment", ticketId: prepared.ticketId, commentId: prepared.commentId, documentUri: operation.documentUri };
    const revision = operation.intentRevision ?? operation.revision ?? 1;

    const currentOp = repo.getOperation(opKey, context.connectionScope);
    if (!currentOp) {
      await repo.saveOperation(operation, context.connectionScope);
    }

    const existingPrimaryEffect = (currentOp?.effects ?? operation.effects ?? []).find(
      (e) => e.effectId === "comment-update" || isPrimaryEffectKind(e.kind),
    );
    const isRetry = existingPrimaryEffect?.state === "failed" || existingPrimaryEffect?.state === "commit_unknown";

    const requestSnapshot: CommentUpdateRequestSnapshot = (existingPrimaryEffect?.requestSnapshot as CommentUpdateRequestSnapshot | undefined) ?? {
      kind: "comment_update",
      request: {
        commentId: prepared.commentId!,
        notes: prepared.body,
        uploads: prepared.uploads.length > 0 ? prepared.uploads : undefined,
      },
      submittedBody: prepared.body,
      submittedUploads: prepared.uploads.map((u) => ({ token: u.token, filename: u.filename, contentType: u.content_type })),
    };

    const started = await repo.transitionPrimaryRemoteWrite(
      opKey,
      {
        kind: isRetry ? "start_explicit_retry" : "start",
        requestSnapshot,
      },
      context.connectionScope,
      { operationId: operation.operationId, revision, sourcePhase: operation.phase },
    );
    if (!started) {
      return {
        ok: false,
        commitUnknown: false,
        error: new Error("Failed to persist started checkpoint for comment-update"),
        outcome: { kind: "failed_before_commit", ticketId: prepared.ticketId, commentId: prepared.commentId, error: new Error("Failed to persist started checkpoint for comment-update") },
      };
    }

    try {
      await commentDeps.updateComment(
        requestSnapshot.request?.commentId ?? prepared.commentId!,
        requestSnapshot.request?.notes ?? prepared.body,
        requestSnapshot.request?.uploads ?? (prepared.uploads.length > 0 ? prepared.uploads : undefined),
      );

      const committed = await repo.transitionPrimaryRemoteWrite(
        opKey,
        {
          kind: "commit",
          remoteId: prepared.commentId,
          projectId: operation.projectId,
          requestSnapshot,
        },
        context.connectionScope,
        { operationId: operation.operationId, revision, sourcePhase: "remote_write_started" },
      );
      if (!committed) {
        return {
          ok: false,
          commitUnknown: true,
          error: new Error("Comment updated but failed to persist commit checkpoint"),
          outcome: { kind: "commit_unknown", operationId: operation.operationId, ticketId: prepared.ticketId, commentId: prepared.commentId, message: "Comment updated but failed to persist commit checkpoint" },
        };
      }

      return {
        ok: true,
        createdRemoteId: prepared.commentId,
        remoteUpdatedAt: new Date().toISOString(),
      };
    } catch (err) {
      const commitUnknown = isRemoteCommitUnknownError(err);
      const disposition = classifyFailureDisposition(err);
      await repo.transitionPrimaryRemoteWrite(
        opKey,
        commitUnknown
          ? { kind: "commit_unknown", detail: (err as Error).message }
          : { kind: "failed", failure: { disposition, detail: (err as Error).message } },
        context.connectionScope,
        { operationId: operation.operationId, revision, sourcePhase: "remote_write_started" },
      );
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

      // INV-03: Actual submitted request を使用して照合 (C-02)
      const primaryEffect = operation.effects?.find((e) => e.effectId === "comment-update" || e.kind === "comment_update");
      const expectedBody = (primaryEffect?.requestSnapshot as CommentUpdateRequestSnapshot | undefined)?.submittedBody
        ?? primaryEffect?.target?.submittedBody
        ?? operation.intent?.body
        ?? "";

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
      const res = await updateCommentUpdateFileAfterSync({
        documentUri,
        syncedBody: body,
        expectedBody: operation.intent?.body ?? "",
        remoteUpdatedAt: reconciled?.ticket?.updatedAt,
        canonical: reconciled,
      });
      if (res !== "applied") {
        return { ok: false, message: `Local finalization pending: ${res}`, pending: "local_finalize" };
      }
    }
    return { ok: true };
  }

  public async resolveEffect(input: {
    key: SyncOperationKey;
    effectId: string;
    operation: UnifiedSyncOperation<CommentUpdateIntent>;
    context: OperationHandlerContext;
    deps: OperationHandlerDeps & { repository: SyncOperationRepository };
    resolution: EffectResolution;
  }): Promise<SyncOutcome> {
    const { key, effectId, operation, context, deps, resolution } = input;
    const repo = deps.repository;
    const revision = operation.intentRevision ?? operation.revision ?? 1;
    const scope = context.connectionScope;
    const effect = (operation.effects ?? []).find((e) => e.effectId === effectId);
    if (!effect) {
      return { kind: "failed_before_commit", error: new Error(`Effect not found: ${effectId}`) };
    }

    const commentDeps = { ...defaultCommentDeps, ...deps.comment };

    if (resolution.kind === "mark_failed") {
      const marked = await repo.transitionEffect(
        key,
        effectId,
        { kind: "mark_failed", detail: "Manually marked as failed", disposition: resolution.disposition ?? "retryable", category: resolution.category },
        scope,
        { operationRevision: revision, sourceState: effect.state },
      );
      if (!marked) {
        return { kind: "failed_before_commit", error: new Error(`Failed to mark effect as failed: ${effectId}`) };
      }
      return {
        kind: "remote_committed",
        ticketId: operation.ticketId ?? 0,
        pending: "remote_reconcile",
        message: `Effect ${effectId} marked as failed`,
      };
    }

    if (effect.kind === "image_upload" || effect.kind === "attachment_upload") {
      if (resolution.kind === "assume_committed") {
        const token = resolution.token ?? effect.token;
        const assumed = await repo.transitionEffect(
          key,
          effectId,
          { kind: "assume_committed", token, remoteId: resolution.remoteId },
          scope,
          { operationRevision: revision, sourceState: effect.state },
        );
        if (!assumed) {
          return { kind: "failed_before_commit", error: new Error(`Failed to assume committed for effect ${effectId}`) };
        }
        return {
          kind: "remote_committed",
          ticketId: operation.ticketId ?? 0,
          commentId: operation.commentId,
          pending: "remote_reconcile",
          message: `Attachment effect ${effectId} assumed committed`,
        };
      }

      if (resolution.kind === "retry_effect") {
        if (effect.state === "failed" && effect.failure?.disposition === "non_retriable") {
          return { kind: "failed_before_commit", error: new Error("Cannot retry non-retriable failure") };
        }
        const filePath = effect.target.filePath ?? (effect.requestSnapshot as UploadRequestSnapshot | undefined)?.filePath;
        if (!filePath) {
          return { kind: "failed_before_commit", error: new Error(`Cannot retry image upload without filePath for effect ${effectId}`) };
        }

        const currentFile = computeFileHashAndSize(filePath);
        const snapshot = effect.requestSnapshot as UploadRequestSnapshot | undefined;
        if (snapshot?.contentHash && currentFile?.contentHash && snapshot.contentHash !== currentFile.contentHash) {
          return {
            kind: "failed_before_commit",
            error: new Error(`File content has changed since snapshot. Retry rejected.`),
          };
        }
        const contentHash = currentFile?.contentHash ?? snapshot?.contentHash;
        const contentSize = currentFile?.contentSize ?? snapshot?.contentSize;
        if (!contentHash || contentSize === undefined) {
          return { kind: "failed_before_commit", error: new Error(`Cannot compute hash for image: ${filePath}`) };
        }

        const uploadSnapshot: UploadRequestSnapshot = {
          kind: "upload",
          filePath,
          filename: effect.target.filename ?? snapshot?.filename ?? path.basename(filePath),
          contentType: snapshot?.contentType ?? "image/png",
          contentHash,
          contentSize,
        };

        const started = await repo.transitionEffect(
          key,
          effectId,
          { kind: "start_explicit_retry", requestSnapshot: uploadSnapshot },
          scope,
          { operationRevision: revision, sourceState: effect.state },
        );
        if (!started) {
          return { kind: "failed_before_commit", error: new Error(`Failed to start retry for effect ${effectId}`) };
        }
        try {
          const upload = await commentDeps.uploadFile(filePath);
          const committed = await repo.transitionEffect(
            key,
            effectId,
            { kind: "commit", token: upload.token, target: { filePath, filename: upload.filename }, requestSnapshot: uploadSnapshot },
            scope,
            { operationRevision: revision, sourceState: "started" },
          );
          if (!committed) {
            return { kind: "commit_unknown", operationId: operation.operationId, message: `Image uploaded but commit checkpoint failed for ${effectId}` };
          }
          return { kind: "remote_committed", ticketId: operation.ticketId ?? 0, commentId: operation.commentId, pending: "remote_reconcile", message: `Image ${effectId} uploaded successfully` };
        } catch (err) {
          const isUnknown = isRemoteCommitUnknownError(err);
          const disposition = classifyFailureDisposition(err);
          await repo.transitionEffect(
            key,
            effectId,
            isUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message, disposition },
            scope,
            { operationRevision: revision, sourceState: "started" },
          );
          return isUnknown
            ? { kind: "commit_unknown", operationId: operation.operationId, message: (err as Error).message }
            : { kind: "failed_before_commit", error: err as Error };
        }
      }
    }

    return { kind: "failed_before_commit", error: new Error(`Unsupported effect recovery for ${effectId}`) };
  }
}
