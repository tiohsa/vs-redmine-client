import * as vscode from "vscode";
import type { IssueCreateInput, IssueUploadInput } from "../../redmine/issues";
import { getIssueDetail } from "../../redmine/issues";
import { uploadFileAttachment } from "../../redmine/attachments";
import {
  buildTicketEditorContent,
  parseTicketEditorContent,
  type TicketEditorContent,
} from "../../views/ticketEditorContent";
import { editorContentFromTicket, metadataFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import { resolveMetadataForCreate } from "../../views/ticketSync/ticketMetadataResolver";
import { rewriteNewTicketEditorToTicketMode } from "../../views/ticketSync/ticketEditorRewrite";
import { updateDraftAfterSave } from "../../views/ticketDraftStore";
import { markNewTicketDraftSynced } from "../../views/newTicketDraftStore";
import { createSyncOperationRepository, type SyncOperationRepository } from "./syncRepository";
import { registerTicketDocument, removeTicketEditorByUri } from "../../views/ticketEditorRegistry";
import { defaultCreateDeps } from "../../views/ticketSync/ticketSyncDeps";
import { isMissingPathReason, resolveFallbackImagePath, resolveLocalPath } from "../../utils/markdownImageUpload";
import { computeFileHashAndSizeAsync } from "../../utils/fileHash";
import { CreateOperationHttpError, createOperationHttpError } from "../../redmine/httpError";
import { classifyFailureDisposition } from "../../utils/redmineErrors";
import {
  getAttemptGeneration,
  getEffectsForRevision,
  getOperationRecoveryMode,
  getPrimaryEffectForRevision,
  isEffectBlockingNormalSync,
  type TicketCreateRequestSnapshot,
  type UploadRequestSnapshot,
} from "../syncEffects";
import type {
  SyncOperationKey,
  SyncOutcome,
  TicketCreateIntent,
  TicketUpdateIntent,
  UnifiedSyncOperation,
} from "./syncOperationTypes";
import { isRemoteCommitUnknownError } from "../../views/ticketSync/ticketSyncResult";
import { getDefaultUploadSpoolStore } from "./uploadSpoolStore";
import {
  extractMarkdownImageLinks,
  isExternalMarkdownImagePath,
} from "../../utils/markdownImageLinks";
import { validateLocalImagePath } from "../../utils/markdownImageValidation";
import type { PreparedTicketCreate, PreparedTicketUpdate } from "./ticketHandlerTypes";
import { executeTicketSecondaryEffects } from "./ticketSecondaryEffects";
import type {
  OperationHandler,
  OperationHandlerContext,
  OperationHandlerDeps,
  EffectResolution,
} from "./operationHandlerTypes";
import { resolveIntentBaseDir } from "./resolveIntentBaseDir";
import { resolvePersistedMarkdownImagePath } from "./markdownImageEffects";
import { persistUploadSnapshot } from "./uploadSnapshotLease";
import { verifyCompensationIdentity } from "./ticketRemoteIdentity";

import { createTicketChildren } from "./ticketChildCreation";
import { resolveTicketChildEffect, type LegacyTicketRecoveryDependencies } from "./ticketChildEffectRecovery";
import { compensateFailedTicketCreation } from "./ticketCreateCompensation";

export class TicketCreateHandler implements OperationHandler<TicketCreateIntent, PreparedTicketCreate> {
  public async prepare(
    operation: UnifiedSyncOperation<TicketCreateIntent>,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; prepared: PreparedTicketCreate } | { ok: false; outcome: SyncOutcome }> {
    if (getOperationRecoveryMode(operation) === "compensation_blocked") {
      return {
        ok: false,
        outcome: {
          kind: "remote_committed",
          ticketId: 0,
          pending: "remote_reconcile",
          message: vscode.l10n.t("Primary compensation has unresolved rollback obligations; forward ticket creation is blocked."),
        },
      };
    }

    const intent = operation.intent;
    if (!intent) {
      return { ok: false, outcome: { kind: "failed_before_commit", error: new Error("Missing TicketCreateIntent") } };
    }

    let parsed: TicketEditorContent;
    if (typeof intent.content === "string" && intent.content.trim().length > 0) {
      try {
        parsed = parseTicketEditorContent(intent.content, {
          allowEmptyStatus: true,
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
          allowEmptyStatus: true,
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

    const primaryEffect = getPrimaryEffectForRevision(operation);
    const isRetry = primaryEffect?.state === "failed" || primaryEffect?.state === "commit_unknown";

    const imageLinks: PreparedTicketUpdate["imageLinks"] = [];
    if (!isRetry && primaryEffect?.state !== "committed") {
      const baseDir = resolveIntentBaseDir(intent);
      for (const link of extractMarkdownImageLinks(parsed.description)) {
        if (isExternalMarkdownImagePath(link.path)) {
          continue;
        }
        const persistedPath = await resolvePersistedMarkdownImagePath(operation, link.path, baseDir);
        if (persistedPath) {
          imageLinks.push({ path: link.path, range: link.range, resolvedPath: persistedPath });
          continue;
        }
        let resolvedPath = await resolveLocalPath(link.path, baseDir);
        if (!resolvedPath) {
          return { ok: false, outcome: { kind: "failed_before_commit", error: new Error(vscode.l10n.t("Relative image path cannot be resolved: {0}", link.path)) } };
        }
        const existing = getEffectsForRevision(operation).find(
          (effect) => effect.kind === "image_upload" && effect.target.filePath === resolvedPath,
        );
        if (!(existing?.state === "committed" && existing.token) &&
            !(existing?.requestSnapshot?.kind === "upload" && existing.requestSnapshot.spoolFilePath)) {
          let validation = await validateLocalImagePath({ filePath: resolvedPath });
          if (!validation.valid && isMissingPathReason(validation.reason)) {
            const fallbackPath = await resolveFallbackImagePath(link.path, baseDir);
            if (fallbackPath) {
              const fallbackValidation = await validateLocalImagePath({ filePath: fallbackPath });
              if (fallbackValidation.valid) {
                resolvedPath = fallbackPath;
                validation = fallbackValidation;
              }
            }
          }
          if (!validation.valid) {
            return { ok: false, outcome: { kind: "failed_before_commit", error: new Error(vscode.l10n.t("Invalid image path: {0}. {1}", link.path, validation.reason ?? "")) } };
          }
        }
        imageLinks.push({ path: link.path, range: link.range, resolvedPath });
      }
    }

    let resolved: any = {};
    let request: IssueCreateInput;

    if (isRetry && primaryEffect?.requestSnapshot && (primaryEffect.requestSnapshot as TicketCreateRequestSnapshot).request) {
      request = (primaryEffect.requestSnapshot as TicketCreateRequestSnapshot).request;
    } else {
      const resolveFn = createDeps.resolveMetadataForCreate ?? resolveMetadataForCreate;
      try {
        resolved = await resolveFn(
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
        imageLinks,
        resolved,
        request,
        snapshot,
      },
    };
  }

  public async executeSecondaryEffects(
    operation: UnifiedSyncOperation<TicketCreateIntent | TicketUpdateIntent>,
    prepared: PreparedTicketCreate,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; uploadTokens?: IssueUploadInput[] } | { ok: false; error: Error; commitUnknown?: boolean }> {
    return executeTicketSecondaryEffects(operation, prepared, context, deps);
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
    if (getOperationRecoveryMode(operation) === "compensation_blocked") {
      return {
        ok: false,
        commitUnknown: false,
        error: new Error("Forward ticket mutations are blocked while primary compensation has unresolved rollback obligations."),
        outcome: {
          kind: "remote_committed",
          ticketId: 0,
          pending: "remote_reconcile",
          message: vscode.l10n.t("Primary compensation has unresolved rollback obligations; reconcile compensation before forwarding the ticket mutation."),
        },
      };
    }

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
    const existingPrimaryEffect = getPrimaryEffectForRevision(currentOp ?? operation);
    if (existingPrimaryEffect?.state === "committed" && existingPrimaryEffect.remoteId) {
      createdId = existingPrimaryEffect.remoteId;
    }

    if (!createdId) {
      const isRetry = existingPrimaryEffect?.state === "failed" || existingPrimaryEffect?.state === "commit_unknown";
      let requestToUse: IssueCreateInput;
      const existingSnapshotRequest = (existingPrimaryEffect?.requestSnapshot as TicketCreateRequestSnapshot | undefined)?.request;
      if (isRetry && existingSnapshotRequest) {
        requestToUse = existingSnapshotRequest;
      } else {
        requestToUse = prepared.request
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
        if (prepared.uploadTokens.length > 0) {
          requestToUse = {
            ...requestToUse,
            uploads: prepared.uploadTokens,
          };
        }
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
        const rawCreated = await createDeps.createIssue(requestToUse);
        const resolvedId = typeof rawCreated === "number" ? rawCreated : (rawCreated?.id ?? Number(rawCreated));

        if (!resolvedId || isNaN(resolvedId)) {
          throw new Error("Failed to create issue");
        }
        createdId = resolvedId;

        const committed = await repo.transitionPrimaryRemoteWrite(
          opKey,
          {
            kind: "commit",
            remoteId: resolvedId,
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
      } catch (caught) {
        const err = createOperationHttpError(caught, "create");
        const commitUnknown = isRemoteCommitUnknownError(err);
        const disposition = classifyFailureDisposition(err);
        await repo.transitionPrimaryRemoteWrite(
          opKey,
          commitUnknown
            ? { kind: "commit_unknown", detail: (err as Error).message }
            : { kind: "failed", failure: { disposition, detail: (err as Error).message,
                ...(err instanceof CreateOperationHttpError && err.statusCode === 403 ? { category: "http_403" } : {}),
              } },
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

    const children = prepared.parsed.metadata?.children ?? [];
    const uniqueChildren = Array.from(new Set(children.map((c) => c.trim()).filter((c) => c.length > 0)));

    if (uniqueChildren.length > 0 && !createdId) {
      return {
        ok: false,
        commitUnknown: false,
        error: new Error("Missing parent ticket ID for child creation"),
      };
    }
    const parentTicketId = createdId ?? 0;

    if (uniqueChildren.length > 0) {
      const childFailure = await createTicketChildren({
        operation, opKey, scope: context.connectionScope, repo, revision, uniqueChildren, parentTicketId,
        projectId: prepared.projectId,
        createChild: (request) => createDeps.createIssue(request),
        onChildWriteFailure: (ordinal, error, commitUnknown) => {
          if (commitUnknown || !createDeps.deleteIssue) {
            return undefined;
          }
          return compensateFailedTicketCreation({
            operation, opKey, scope: context.connectionScope, repo, revision, ordinal, error,
            deleteChildOrParent: (ticketId) => createDeps.deleteIssue(ticketId),
          });
        },
      });
      if (childFailure) {
        return childFailure;
      }
    }

    const finalOp = repo.getOperation(opKey, context.connectionScope) ?? operation;
    const finalEffects = getEffectsForRevision(finalOp, revision);
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
    let baseParsed: TicketEditorContent | undefined;
    if (effectiveContent) {
      try {
        baseParsed = parseTicketEditorContent(effectiveContent, {
          allowEmptyStatus: true,
          allowMissingMetadata: true,
          allowMissingSubject: true,
          fallbackMetadata: (effectiveIntent as any)?.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
        });
      } catch {
        baseParsed = undefined;
      }
    }
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
        const expectedContent = operation.nextIntent
          ? (operation.nextIntent as any).content ?? buildTicketEditorContent(parsed)
          : (operation.intent?.content ?? "");
        const expectedRevision = operation.nextIntent
          ? (operation.nextIntent as any).revision ?? (operation.intentRevision ?? operation.revision ?? 1)
          : (operation.intentRevision ?? operation.revision ?? 1);

        if (deps?.documents?.rewriteNewTicket) {
          const res = await deps.documents.rewriteNewTicket({
            documentUri: operation.documentUri,
            ticketId: createdId,
            projectId: operation.projectId ?? reconciled?.ticket?.projectId ?? 0,
            replacement: canonicalParsed,
            expected: {
              content: expectedContent,
              operationRevision: expectedRevision,
            },
          });
          if (res.kind !== "applied") {
            return { ok: false, message: `Document rewrite pending: ${res.kind}`, pending: "local_finalize" };
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
            } else {
              return { ok: false, message: "Document editor is not currently visible", pending: "local_finalize" };
            }
          } else {
            return { ok: false, message: "Document is closed or not available", pending: "local_finalize" };
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
    const effect = getEffectsForRevision(operation, revision).find((e) => e.effectId === effectId);
    if (!effect) {
      return { kind: "failed_before_commit", error: new Error(`Effect not found: ${effectId}`) };
    }

    const recoveryMode = getOperationRecoveryMode(operation);
    if (recoveryMode === "compensation_blocked" && resolution.kind !== "reconcile_compensation") {
      return {
        kind: "failed_before_commit",
        error: new Error(vscode.l10n.t("Only reconcile_compensation is allowed while primary compensation has unresolved rollback obligations.")),
      };
    }

    const createDeps = { ...defaultCreateDeps, ...deps.ticketCreate };

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

    if (effectId === "ticket-create" && (effect.state === "compensation_unknown" || effect.state === "compensation_started" || resolution.kind === "reconcile_compensation")) {
      const remoteTicketId = effect.remoteId ?? (resolution as any).remoteId ?? operation.createdRemoteId;
      if (!remoteTicketId) {
        return { kind: "failed_before_commit", error: new Error("Missing remoteId for ticket compensation recovery") };
      }
      const getDetail = deps?.ticketCreate?.getIssueDetail ?? (deps as any)?.getIssueDetail ?? createDeps.getIssueDetail ?? getIssueDetail;
      const deleteIssue = deps?.ticketCreate?.deleteIssue ?? (deps as any)?.deleteIssue ?? createDeps.deleteIssue;

      try {
        const detail = await getDetail(remoteTicketId);
        if (detail && detail.ticket) {
          const snapshot = effect.requestSnapshot as TicketCreateRequestSnapshot | undefined;
          const expectedProject = snapshot?.request?.projectId ?? operation.projectId;
          const expectedSubject = snapshot?.request?.subject ?? (operation.intent as any)?.subject;
          const idCheck = verifyCompensationIdentity(detail.ticket, {
            projectId: expectedProject,
            subject: expectedSubject,
          });
          if (!idCheck.ok) {
            return { kind: "failed_before_commit", error: new Error(`Compensation rejected due to identity mismatch: ${idCheck.reason}`) };
          }

          const startDel = await repo.transitionEffect(key, effectId, { kind: "start_compensation" }, scope, { operationRevision: revision, sourceState: effect.state });
          if (!startDel) {
            return { kind: "failed_before_commit", error: new Error("Failed to transition to start_compensation") };
          }
          if (deleteIssue) {
            await deleteIssue(remoteTicketId);
          }
          const compDone = await repo.transitionEffect(key, effectId, { kind: "complete_compensation" }, scope, { operationRevision: revision, sourceState: "compensation_started" });
          if (!compDone) {
            await repo.transitionEffect(key, effectId, { kind: "mark_compensation_unknown", detail: "complete_compensation failed to persist" }, scope, { operationRevision: revision, sourceState: "compensation_started" });
            return { kind: "commit_unknown", operationId: operation.operationId, message: "Compensation completed on remote but checkpoint failed" };
          }
          if (getAttemptGeneration(compDone) > getAttemptGeneration(operation)) {
            return { kind: "queued" };
          }
          return { kind: "no_change", ticketId: remoteTicketId };
        }
      } catch (err: any) {
        if (err?.status === 404 || err?.message?.includes("404") || err?.message?.toLowerCase().includes("not found")) {
          const compDone = await repo.transitionEffect(key, effectId, { kind: "complete_compensation" }, scope, { operationRevision: revision, sourceState: effect.state });
          if (compDone) {
            if (getAttemptGeneration(compDone) > getAttemptGeneration(operation)) {
              return { kind: "queued" };
            }
            return { kind: "no_change", ticketId: remoteTicketId };
          }
        }
        await repo.transitionEffect(key, effectId, { kind: "mark_compensation_unknown", detail: (err as Error).message }, scope, { operationRevision: revision, sourceState: effect.state === "started" || effect.state === "compensation_started" ? effect.state : "compensation_started" });
        return { kind: "commit_unknown", operationId: operation.operationId, message: (err as Error).message };
      }
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
          ticketId: operation.createdRemoteId ?? 0,
          pending: "remote_reconcile",
          message: `Attachment effect ${effectId} assumed committed`,
        };
      }

      if (resolution.kind === "retry_effect") {
        if (effect.state === "failed" && effect.failure?.disposition === "non_retriable") {
          return { kind: "failed_before_commit", error: new Error("Cannot retry non-retriable failure") };
        }
        const snapshot = effect.requestSnapshot as UploadRequestSnapshot | undefined;
        if (effect.state === "commit_unknown" && (!snapshot?.contentHash || snapshot.contentSize === undefined)) {
          return {
            kind: "failed_before_commit",
            error: new Error(`Cannot retry uncertain upload without snapshot content hash/size for effect ${effectId}`),
          };
        }
        const hasFrozenSpool = snapshot?.spoolFilePath !== undefined;
        const uploadFilePath = hasFrozenSpool ? snapshot?.spoolFilePath : effect.target.filePath ?? snapshot?.filePath;
        if (!uploadFilePath) {
          return { kind: "failed_before_commit", error: new Error(`Cannot retry attachment without filePath for effect ${effectId}`) };
        }

        let contentHash = snapshot?.contentHash;
        let contentSize = snapshot?.contentSize;
        if (hasFrozenSpool) {
          if (!snapshot || !await (deps.uploadSpoolStore ?? getDefaultUploadSpoolStore()).verify(snapshot)) {
            return { kind: "failed_before_commit", error: new Error(`Spool file identity mismatch for attachment effect ${effectId}`) };
          }
        } else {
          const currentFile = await computeFileHashAndSizeAsync(uploadFilePath);
          if (!currentFile) {
            return {
              kind: "failed_before_commit",
              error: new Error(`Cannot compute hash for file: ${uploadFilePath}`),
            };
          }
          if (
            snapshot?.contentHash &&
            (snapshot.contentHash !== currentFile.contentHash || snapshot.contentSize !== currentFile.contentSize)
          ) {
            return {
              kind: "failed_before_commit",
              error: new Error(`File content has changed since snapshot (expected hash ${snapshot.contentHash}, found ${currentFile.contentHash}). Retry rejected.`),
            };
          }
          contentHash = currentFile.contentHash;
          contentSize = currentFile.contentSize;
        }

        if (!contentHash || contentSize === undefined) {
          return {
            kind: "failed_before_commit",
            error: new Error(`Cannot retry attachment without frozen content identity for effect ${effectId}`),
          };
        }

        const uploadSnapshot: UploadRequestSnapshot = snapshot ?? {
          kind: "upload",
          filePath: effect.target.filePath ?? uploadFilePath,
          filename: effect.target.filename ?? "attachment",
          contentType: "application/octet-stream",
          contentHash,
          contentSize,
          spoolFilePath: undefined,
        };

        const started = await persistUploadSnapshot(uploadSnapshot, () => repo.transitionEffect(
          key,
          effectId,
          { kind: "start_explicit_retry", requestSnapshot: uploadSnapshot },
          scope,
          { operationRevision: revision, sourceState: effect.state },
        ));
        if (!started) {
          return { kind: "failed_before_commit", error: new Error(`Failed to start retry for effect ${effectId}`) };
        }
        try {
          const uploadFn = (createDeps as any).uploadFile ?? uploadFileAttachment;
          const res = await uploadFn(uploadFilePath);
          const committed = await repo.transitionEffect(
            key,
            effectId,
            { kind: "commit", token: res.token, target: { filePath: uploadSnapshot.filePath, filename: uploadSnapshot.filename }, requestSnapshot: uploadSnapshot },
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

    if (effect.kind === "child_create") {
      const legacyDeps: LegacyTicketRecoveryDependencies & OperationHandlerDeps = deps;
      const getDetail = deps.ticketCreate?.getIssueDetail ?? createDeps.getIssueDetail ?? getIssueDetail;
      const outcome = await resolveTicketChildEffect({
        key, effect, operation, resolution, repo, scope, revision,
        isTicketCreation: true,
        fallbackParentTicketId: getPrimaryEffectForRevision(operation, revision)?.remoteId ?? operation.createdRemoteId,
        forwardProjectId: operation.projectId ?? operation.intent?.projectId,
        getSubject: (snapshot) => {
          const parsedContent = operation.intent?.content
            ? parseTicketEditorContent(operation.intent.content, { allowMissingMetadata: true, allowMissingSubject: true })
            : undefined;
          const ordinal = effect.target.ordinal ?? 0;
          const target: typeof effect.target & { subject?: string } = effect.target;
          return snapshot?.subject ?? target.subject ?? operation.intent?.childTickets?.[ordinal]?.subject ??
            operation.intent?.metadata?.children?.[ordinal] ?? parsedContent?.metadata?.children?.[ordinal];
        },
        getDetail,
        getCompensationDetail: deps.ticketCreate?.getIssueDetail ?? legacyDeps.getIssueDetail ?? getDetail,
        createChild: (request) => createDeps.createIssue(request),
        deleteChild: deps.ticketCreate?.deleteIssue ?? legacyDeps.deleteIssue ?? createDeps.deleteIssue,
        finalize: (nextOp) => this.finalizeOperationIfReady(nextOp as UnifiedSyncOperation<TicketCreateIntent>, context, deps),
      });
      if (outcome) {
        return outcome;
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
    if (op.phase === "queued" && getEffectsForRevision(op).length === 0) {
      return { kind: "queued" };
    }
    const activeEffects = getEffectsForRevision(op);
    const primary = getPrimaryEffectForRevision(op);
    const recoveryMode = getOperationRecoveryMode(op);
    if (recoveryMode === "compensation_blocked") {
      return {
        kind: "remote_committed",
        ticketId: 0,
        pending: "remote_reconcile",
        message: vscode.l10n.t("Primary compensation has unresolved rollback obligations; forward finalization is blocked."),
      };
    }

    const parentCommitted =
      primary?.state === "committed" &&
      getAttemptGeneration(primary) === getAttemptGeneration(op);

    const hasUnresolved = activeEffects.some(isEffectBlockingNormalSync);

    if (!parentCommitted || hasUnresolved) {
      return {
        kind: "remote_committed",
        ticketId: op.createdRemoteId ?? 0,
        pending: "remote_reconcile",
        message: "Secondary effects resolved partially",
      };
    }

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
    const compOp = await deps.repository.completeOperation(key, context.connectionScope, op.intentRevision ?? op.revision ?? 1, {
      canonical: reconciled.canonical,
      remoteUpdatedAt: op.remoteUpdatedAt,
    }, getAttemptGeneration(op));
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
