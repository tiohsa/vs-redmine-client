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
import type { UploadToken } from "../../redmine/types";
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
    operation: UnifiedSyncOperation;
    context: OperationHandlerContext;
    deps: OperationHandlerDeps & { repository: SyncOperationRepository };
  }): Promise<SyncOutcome>;
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

        const planRes = await repo.planEffect(
          opKey,
          {
            effectId,
            kind: "attachment_upload",
            operationRevision: revision,
            state: "planned",
            target: { filePath: att.filePath, filename: att.filename },
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
          { kind: "start" },
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
            { kind: "commit", token: res.token, target: { filePath: att.filePath, filename: att.filename ?? res.filename } },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
          if (!commitRes) {
            return { ok: false, error: new Error(`Failed to commit effect ${effectId}`), commitUnknown: true };
          }
          tokens.push({ token: res.token, filename: att.filename ?? res.filename, content_type: att.contentType ?? res.contentType });
        } catch (err) {
          const commitUnknown = isRemoteCommitUnknownError(err);
          await repo.transitionEffect(
            opKey,
            effectId,
            commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message },
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

        const planClipRes = await repo.planEffect(
          opKey,
          {
            effectId,
            kind: "attachment_upload",
            operationRevision: revision,
            state: "planned",
            target: { filename: att.filename },
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
          { kind: "start" },
          context.connectionScope,
          { operationRevision: revision, sourceState: "planned" },
        );
        if (!startClipRes) {
          return { ok: false, error: new Error(`Failed to start effect ${effectId}`) };
        }

        try {
          const uploadFn = (createDeps as any).uploadClipboardImage ?? uploadClipboardImage;
          const res = await uploadFn();
          const commitClipRes = await repo.transitionEffect(
            opKey,
            effectId,
            { kind: "commit", token: res.token, target: { filename: att.filename ?? res.filename } },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
          if (!commitClipRes) {
            return { ok: false, error: new Error(`Failed to commit effect ${effectId}`), commitUnknown: true };
          }
          tokens.push({ token: res.token, filename: att.filename ?? res.filename, content_type: att.contentType ?? res.contentType });
        } catch (err) {
          const commitUnknown = isRemoteCommitUnknownError(err);
          await repo.transitionEffect(
            opKey,
            effectId,
            commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message },
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

    let createdId = operation.createdRemoteId;

    if (!createdId) {
      const planned = await repo.planEffect(
        opKey,
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
      if (!planned) {
        return {
          ok: false,
          commitUnknown: false,
          error: new Error("Failed to persist planned checkpoint for ticket-create"),
          outcome: { kind: "failed_before_commit", error: new Error("Failed to persist planned checkpoint for ticket-create") },
        };
      }

      const started = await repo.transitionEffect(
        opKey,
        "ticket-create",
        { kind: "start" },
        context.connectionScope,
        { operationRevision: revision, sourceState: "planned" },
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

        const committed = await repo.transitionEffect(
          opKey,
          "ticket-create",
          { kind: "commit", remoteId: createdId },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
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
        await repo.transitionEffect(
          opKey,
          "ticket-create",
          commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
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

      const planChild = await repo.planEffect(
        opKey,
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
        { kind: "start" },
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
        const createdChildId = await createDeps.createIssue({
          subject,
          description: "",
          parentId: createdId,
          projectId: prepared.projectId,
        });
        if (!createdChildId) {
          throw new Error(`Failed to create child issue: ${subject}`);
        }
        const commitChild = await repo.transitionEffect(
          opKey,
          effectId,
          { kind: "commit", remoteId: createdChildId },
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
        await repo.transitionEffect(
          opKey,
          effectId,
          commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
        );
        if (!commitUnknown) {
          for (let prev = ordinal - 1; prev >= 0; prev--) {
            const prevEffectId = `child-create:${prev}`;
            const opAfterFail = repo.getOperation(opKey, context.connectionScope) ?? operation;
            const prevEffect = opAfterFail.effects?.find((e) => e.effectId === prevEffectId);
            if (prevEffect && prevEffect.state === "committed" && prevEffect.remoteId) {
              // 子チケット補償 (fail-closed: start_compensation 失敗ならDELETEしない)
              const startComp = await repo.transitionEffect(
                opKey,
                prevEffectId,
                { kind: "start_compensation" },
                context.connectionScope,
                { operationRevision: revision, sourceState: "committed" },
              );
              if (startComp) {
                try {
                  await createDeps.deleteIssue?.(prevEffect.remoteId);
                  const childCompResult = await repo.transitionEffect(
                    opKey,
                    prevEffectId,
                    { kind: "complete_compensation" },
                    context.connectionScope,
                    { operationRevision: revision, sourceState: "compensation_started" },
                  );
                  if (!childCompResult) {
                    // persistence failure: compensation_unknown として保持
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
              // start_compensation 失敗時はDELETEしない（fail-closed）
            }
          }

          // 親チケットの補償 (fail-closed: INV-N12, INV-N15)
          const opAfterChildren = repo.getOperation(opKey, context.connectionScope) ?? operation;
          const parentEffect = opAfterChildren.effects?.find((e) => e.effectId === "ticket-create");
          if (parentEffect && parentEffect.state === "committed" && parentEffect.remoteId) {
            // DELETE前: start_compensation checkpoint 失敗ならDELETEしない
            const startParentComp = await repo.transitionEffect(
              opKey,
              "ticket-create",
              { kind: "start_compensation" },
              context.connectionScope,
              { operationRevision: revision, sourceState: "committed" },
            );
            if (startParentComp) {
              try {
                await createDeps.deleteIssue?.(parentEffect.remoteId);
                // DELETE成功後: complete_compensation の persistence failure は compensation_unknown 相当
                // createdRemoteId = undefined は transitionEffect 内でatomicに処理されるため不要
                const compResult = await repo.transitionEffect(
                  opKey,
                  "ticket-create",
                  { kind: "complete_compensation" },
                  context.connectionScope,
                  { operationRevision: revision, sourceState: "compensation_started" },
                );
                if (!compResult) {
                  // persistence failure: compensation_unknown として保持 (safe-side)
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
            // start_compensation 失敗時はDELETEしない（fail-closed）
          }
        }

        return {
          ok: false,
          error: err as Error,
          commitUnknown,
        };
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
        error: new Error("Secondary effects remain unresolved or failed"),
        commitUnknown: hasUnknownEffects,
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
          if (deps?.localState?.register) {
            deps.localState.register(createdId, openDoc);
          } else if (openDoc) {
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

    if (deps?.localState?.updateDraft) {
      deps.localState.updateDraft(createdId, subject, description, metadata, remoteUpdatedAt);
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
}

export interface PreparedTicketUpdate {
  ticketId: number;
  projectId?: number;
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

    // 2. メタデータの解決 (IDマッピング) & projectId 確定
    let remoteDetail: any = undefined;
    const ensureRemoteDetail = async () => {
      if (!remoteDetail) {
        const getDetail = saveDeps.getIssueDetail ?? getIssueDetail;
        remoteDetail = await getDetail(ticketId);
      }
      return remoteDetail;
    };

    const children = intent.metadata?.children ?? [];
    const uniqueChildren = Array.from(new Set(children.map((c) => c.trim()).filter((c) => c.length > 0)));

    let projectId = operation.projectId;
    if (!projectId && (Object.keys(metadataChanges).length > 0 || uniqueChildren.length > 0)) {
      try {
        const remote = await ensureRemoteDetail();
        projectId = remote?.ticket?.projectId;
      } catch {
        // non-fatal for project discovery
      }
    }

    let resolvedMetadataFields: any = {};
    if (Object.keys(metadataChanges).length > 0) {
      try {
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

    return {
      ok: true,
      prepared: {
        ticketId,
        projectId,
        changes,
        uniqueChildren,
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

    const existingPrimaryEffect = (currentOp?.effects ?? operation.effects ?? []).find((e) => e.effectId === "ticket-update");
    if (!existingPrimaryEffect || existingPrimaryEffect.state !== "committed") {
      const planned = await repo.planEffect(
        opKey,
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
      if (!planned) {
        return {
          ok: false,
          commitUnknown: false,
          error: new Error("Failed to persist planned checkpoint for ticket-update"),
        };
      }

      const started = await repo.transitionEffect(
        opKey,
        "ticket-update",
        { kind: "start" },
        context.connectionScope,
        { operationRevision: revision, sourceState: "planned" },
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
        if (Object.keys(prepared.changes).length > 0) {
          await saveDeps.updateIssue({ issueId: ticketId, fields: prepared.changes });
        }

        const committed = await repo.transitionEffect(
          opKey,
          "ticket-update",
          { kind: "commit", remoteId: ticketId },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
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
        await repo.transitionEffect(
          opKey,
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

    // 2. Dependent Effects: Child issue creation (DR-02: After Primary Commit)
    const uniqueChildren = prepared.uniqueChildren;
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

        const planChild = await repo.planEffect(
          opKey,
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
          { kind: "start" },
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
          const createdChildId = await saveDeps.createIssue?.({
            subject,
            description: "",
            parentId: ticketId,
            projectId: childProjectId,
          });
          if (!createdChildId) {
            throw new Error(`Failed to create child issue: ${subject}`);
          }
          const committedChild = await repo.transitionEffect(
            opKey,
            effectId,
            { kind: "commit", remoteId: createdChildId },
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
          await repo.transitionEffect(
            opKey,
            effectId,
            commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message },
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
}

import * as path from "path";
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

      const planImg = await repo.planEffect(
        opKey,
        {
          effectId,
          kind: "image_upload",
          operationRevision: revision,
          state: "planned",
          target: { filePath, filename: path.basename(filePath) },
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
        { kind: "start" },
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
          { kind: "commit", token: upload.token, target: { filePath, filename: upload.filename } },
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
        await repo.transitionEffect(
          opKey,
          effectId,
          commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message },
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

    const planned = await repo.planEffect(
      opKey,
      {
        effectId: "comment-create",
        kind: "comment_create",
        operationRevision: revision,
        state: "planned",
        target: { ticketId: prepared.ticketId },
      },
      context.connectionScope,
      revision,
    );
    if (!planned) {
      return {
        ok: false,
        commitUnknown: false,
        error: new Error("Failed to persist planned checkpoint for comment-create"),
        outcome: { kind: "failed_before_commit", ticketId: prepared.ticketId, error: new Error("Failed to persist planned checkpoint for comment-create") },
      };
    }

    const started = await repo.transitionEffect(
      opKey,
      "comment-create",
      { kind: "start" },
      context.connectionScope,
      { operationRevision: revision, sourceState: "planned" },
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
        prepared.ticketId,
        prepared.body,
        prepared.uploads.length > 0 ? prepared.uploads : undefined,
      );

      const committed = await repo.transitionEffect(
        opKey,
        "comment-create",
        { kind: "commit" },
        context.connectionScope,
        { operationRevision: revision, sourceState: "started" },
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
      await repo.transitionEffect(
        opKey,
        "comment-create",
        commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message },
        context.connectionScope,
        { operationRevision: revision, sourceState: "started" },
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

      const planImg = await repo.planEffect(
        opKey,
        {
          effectId,
          kind: "image_upload",
          operationRevision: revision,
          state: "planned",
          target: { filePath, filename: path.basename(filePath) },
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
        { kind: "start" },
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
          { kind: "commit", token: upload.token, target: { filePath, filename: upload.filename } },
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
        await repo.transitionEffect(
          opKey,
          effectId,
          commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message },
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

    const planned = await repo.planEffect(
      opKey,
      {
        effectId: "comment-update",
        kind: "comment_update",
        operationRevision: revision,
        state: "planned",
        target: { ticketId: prepared.ticketId, commentId: prepared.commentId },
      },
      context.connectionScope,
      revision,
    );
    if (!planned) {
      return {
        ok: false,
        commitUnknown: false,
        error: new Error("Failed to persist planned checkpoint for comment-update"),
        outcome: { kind: "failed_before_commit", ticketId: prepared.ticketId, commentId: prepared.commentId, error: new Error("Failed to persist planned checkpoint for comment-update") },
      };
    }

    const started = await repo.transitionEffect(
      opKey,
      "comment-update",
      { kind: "start" },
      context.connectionScope,
      { operationRevision: revision, sourceState: "planned" },
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
        prepared.commentId!,
        prepared.body,
        prepared.uploads.length > 0 ? prepared.uploads : undefined,
      );

      const committed = await repo.transitionEffect(
        opKey,
        "comment-update",
        { kind: "commit", remoteId: prepared.commentId },
        context.connectionScope,
        { operationRevision: revision, sourceState: "started" },
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
      await repo.transitionEffect(
        opKey,
        "comment-update",
        commitUnknown ? { kind: "mark_commit_unknown" } : { kind: "mark_failed", detail: (err as Error).message },
        context.connectionScope,
        { operationRevision: revision, sourceState: "started" },
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
}
