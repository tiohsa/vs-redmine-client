import * as vscode from "vscode";
import type { IssueUpdateInput, IssueUploadInput } from "../../redmine/issues";
import { createIssue, getIssueDetail } from "../../redmine/issues";
import { uploadFileAttachment } from "../../redmine/attachments";
import { buildTicketEditorContent } from "../../views/ticketEditorContent";
import { editorContentFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import {
  computeChanges,
  computeMetadataChanges,
  resolveMetadataUpdates,
} from "../../views/ticketSync/ticketMetadataResolver";
import { compareAndRewriteDocumentWithRegisteredFields } from "../../views/editorDocumentRewrite";
import { updateDraftAfterSave } from "../../views/ticketDraftStore";
import { rebaseTicketEditorContent } from "./ticketIntentRebase";
import { createSyncOperationRepository, type SyncOperationRepository } from "./syncRepository";
import { defaultDeps as defaultTicketDeps } from "../../views/ticketSync/ticketSyncDeps";
import { resolveFallbackImagePath, resolveLocalPath } from "../../utils/markdownImageUpload";
import { containsConflictMarkers } from "../../utils/threeWayMerge";
import { classifyFailureDisposition } from "../../utils/redmineErrors";
import type { TicketUpdateFields } from "../../redmine/types";
import {
  getAttemptGeneration,
  getEffectsForRevision,
  getPrimaryEffectForRevision,
  type TicketUpdateRequestSnapshot,
  type UploadRequestSnapshot,
} from "../syncEffects";
import type { SyncOperationKey, SyncOutcome, TicketUpdateIntent, UnifiedSyncOperation } from "./syncOperationTypes";
import { isRemoteCommitUnknownError } from "../../views/ticketSync/ticketSyncResult";
import { getDefaultUploadSpoolStore } from "./uploadSpoolStore";
import { extractMarkdownImageLinks, isExternalMarkdownImagePath } from "../../utils/markdownImageLinks";
import { validateLocalImagePath } from "../../utils/markdownImageValidation";
import type {
  OperationHandler,
  OperationHandlerContext,
  OperationHandlerDeps,
  EffectResolution,
} from "./operationHandlerTypes";
import { resolveIntentBaseDir } from "./resolveIntentBaseDir";
import { resolvePersistedMarkdownImagePath, prepareMarkdownImageUpload } from "./markdownImageEffects";
import { persistUploadSnapshot } from "./uploadSnapshotLease";
import type { PreparedTicketCreate, PreparedTicketUpdate } from "./ticketHandlerTypes";
import { executeTicketSecondaryEffects } from "./ticketSecondaryEffects";
import { normalizeTicketText } from "./ticketRemoteIdentity";

import { createTicketChildren } from "./ticketChildCreation";
import { resolveTicketChildEffect, type LegacyTicketRecoveryDependencies } from "./ticketChildEffectRecovery";

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
    if (containsConflictMarkers(intent.content ?? "") || containsConflictMarkers(intent.subject) ||
        containsConflictMarkers(intent.description)) {
      return { ok: false, outcome: { kind: "failed_before_commit", ticketId,
        error: new Error(vscode.l10n.t("Resolve all merge conflict markers before syncing.")) } };
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

    const primaryEffect = getPrimaryEffectForRevision(operation);
    const isRetry = primaryEffect?.state === "failed" || primaryEffect?.state === "commit_unknown";

    let request: IssueUpdateInput;
    let changes: TicketUpdateFields;
    const uniqueChildren = Array.from(new Set(
      (intent.metadata?.children ?? []).map((child) => child.trim()).filter((child) => child.length > 0),
    ));
    let imageLinks: PreparedTicketUpdate["imageLinks"] = [];
    const baseDir = resolveIntentBaseDir(intent);
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
      if (deps?.ticketUpdate?.getIssueDetail || (uniqueChildren.length > 0 && !projectId)) {
        try {
          const remote = await ensureRemoteDetail();
          projectId ??= remote?.ticket?.projectId;
        } catch (err) {
          return { ok: false, outcome: { kind: "failed_before_commit", ticketId, error: err as Error } };
        }
      }
    } else {
      const syncedImageNames = new Set(
        extractMarkdownImageLinks(intent.baseDescription ?? "")
          .map((link) => link.path)
          .filter((imagePath) => !/[/\\:]/.test(imagePath)),
      );
      const links = extractMarkdownImageLinks(intent.description);
      for (const link of links) {
        if (isExternalMarkdownImagePath(link.path) || syncedImageNames.has(link.path)) {
          continue;
        }

        const persistedPath = await resolvePersistedMarkdownImagePath(operation, link.path, baseDir);
        if (persistedPath) {
          imageLinks.push({ path: link.path, range: link.range, resolvedPath: persistedPath });
          continue;
        }

        let resolvedPath = await resolveLocalPath(link.path, baseDir);
        if (!resolvedPath) {
          return {
            ok: false,
            outcome: {
              kind: "failed_before_commit",
              ticketId,
              error: new Error(`Relative path cannot be resolved: ${link.path}`),
            },
          };
        }

        const validation = await validateLocalImagePath({ filePath: resolvedPath });
        if (!validation.valid) {
          const fallbackPath = await resolveFallbackImagePath(link.path, baseDir);
          if (fallbackPath) {
            const fallbackValidation = await validateLocalImagePath({ filePath: fallbackPath });
            if (fallbackValidation.valid) {
              resolvedPath = fallbackPath;
            } else {
              return {
                ok: false,
                outcome: {
                  kind: "failed_before_commit",
                  ticketId,
                  error: new Error(validation.reason ?? `Invalid image path: ${link.path}`),
                },
              };
            }
          } else {
            return {
              ok: false,
              outcome: {
                kind: "failed_before_commit",
                ticketId,
                error: new Error(validation.reason ?? `Invalid image path: ${link.path}`),
              },
            };
          }
        }

        imageLinks.push({ path: link.path, range: link.range, resolvedPath });
      }

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

      if (!projectId && (Object.keys(metadataChanges).length > 0 || uniqueChildren.length > 0)) {
        try {
          const remote = await ensureRemoteDetail();
          projectId = remote?.ticket?.projectId;
        } catch {
          // non-fatal for general metadata discovery if not required
        }
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
                  ...(context.connectionScope ? { connectionScope: context.connectionScope } : {}),
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
        imageLinks,
        request,
        snapshot,
      },
    };
  }

  public async executeSecondaryEffects(
    operation: UnifiedSyncOperation<TicketUpdateIntent>,
    prepared: PreparedTicketUpdate,
    context: OperationHandlerContext,
    deps?: OperationHandlerDeps,
  ): Promise<{ ok: true; uploadTokens?: IssueUploadInput[] } | { ok: false; error: Error; commitUnknown?: boolean }> {
    if (prepared.imageLinks.length === 0 && !(operation.intent?.attachments?.length) && !(operation.intent?.uploadTokens?.length)) {
      return { ok: true };
    }

    const saveDeps = { ...defaultTicketDeps, ...deps?.ticketUpdate };
    const attachmentPrepared: PreparedTicketCreate = {
      projectId: prepared.projectId ?? 0,
      parsed: {
        subject: operation.intent?.subject ?? "",
        description: operation.intent?.description ?? "",
        metadata: operation.intent?.metadata ?? { tracker: "", priority: "", status: "", due_date: "" },
      },
      imageLinks: prepared.imageLinks,
      uploadTokens: [...(operation.intent?.uploadTokens ?? [])],
    };
    const uploaded = await executeTicketSecondaryEffects(
      operation, attachmentPrepared, context,
      { ...deps, ticketCreate: { ...deps?.ticketCreate, uploadFile: saveDeps.uploadFile } },
    );
    if (!uploaded.ok) {
      return uploaded;
    }
    const uploads = attachmentPrepared.uploadTokens;

    prepared.changes = {
      ...prepared.changes,
      ...(prepared.imageLinks.length > 0 ? { description: attachmentPrepared.parsed.description } : {}),
      ...(uploads.length > 0 ? { uploads } : {}),
    };
    prepared.request = {
      issueId: prepared.ticketId,
      fields: prepared.changes,
    };
    prepared.snapshot = {
      kind: "ticket_update",
      request: prepared.request,
    };

    return { ok: true, uploadTokens: uploads };
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
    const existingPrimaryEffect = getPrimaryEffectForRevision(currentOp ?? operation);
    if (!existingPrimaryEffect || existingPrimaryEffect.state !== "committed") {
      const isRetry = existingPrimaryEffect?.state === "failed" || existingPrimaryEffect?.state === "commit_unknown";
      const requestToUse: IssueUpdateInput = existingPrimaryEffect?.state === "planned"
        ? (prepared.request ?? { issueId: ticketId, fields: prepared.changes })
        : (existingPrimaryEffect?.requestSnapshot as TicketUpdateRequestSnapshot | undefined)?.request
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

    if (uniqueChildren && uniqueChildren.length > 0) {
      const childProjectId = prepared.projectId ?? operation.projectId;

      const childFailure = await createTicketChildren({
        operation, opKey, scope: context.connectionScope, repo, revision, uniqueChildren,
        parentTicketId: ticketId,
        projectId: childProjectId ?? 0,
        requireProjectId: true,
        createChild: saveDeps.createIssue ?? createIssue,
      });
      if (childFailure) {
        return childFailure;
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
        const snapshot = getPrimaryEffectForRevision(operation)?.requestSnapshot;
        const frozenFields = snapshot?.kind === "ticket_update" ? snapshot.request?.fields : undefined;
        const contentChanges = frozenFields ?? computeChanges(
          intent.baseSubject ?? "",
          intent.baseDescription ?? "",
          intent.subject ?? "",
          intent.description ?? "",
        );
        if (!frozenFields && intent.baseSubject === undefined && intent.subject !== undefined) {
          contentChanges.subject = intent.subject;
        }
        if (!frozenFields && intent.baseDescription === undefined && intent.description !== undefined) {
          contentChanges.description = intent.description;
        }

        if (contentChanges.subject !== undefined) {
          if (normalizeTicketText(ticket.subject) !== normalizeTicketText(contentChanges.subject)) {
            return {
              ok: false,
              message: `Remote ticket #${ticketId} subject does not match intended update. Expected "${contentChanges.subject}", got "${ticket.subject}".`,
            };
          }
        }

        if (contentChanges.description !== undefined) {
          if (normalizeTicketText(ticket.description) !== normalizeTicketText(contentChanges.description)) {
            return {
              ok: false,
              message: `Remote ticket #${ticketId} description does not match intended update.`,
            };
          }
        }

        if (frozenFields) {
          const values: Array<[number | string | null | undefined, number | string | undefined]> = [
            [frozenFields.trackerId, ticket.trackerId],
            [frozenFields.statusId, ticket.statusId],
            [frozenFields.priorityId, ticket.priorityId],
            [frozenFields.assigneeId, ticket.assigneeId],
            [frozenFields.assignedToId, ticket.assigneeId ?? ""],
            [frozenFields.dueDate === null ? "" : frozenFields.dueDate, ticket.dueDate ?? ""],
            [frozenFields.startDate === null ? "" : frozenFields.startDate, ticket.startDate ?? ""],
            [frozenFields.doneRatio, ticket.doneRatio],
            [frozenFields.estimatedHours, ticket.estimatedHours],
          ];
          if (values.some(([expected, actual]) => expected !== undefined && expected !== actual)) {
            return { ok: false, message: vscode.l10n.t("Remote ticket #{0} does not match the saved update.", ticketId) };
          }
        }

        if (!frozenFields && intent.metadata) {
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
      } catch (error) {
        return {
          ok: false,
          message: vscode.l10n.t("Remote ticket details are unavailable: {0}", error instanceof Error ? error.message : String(error)),
          pending: "local_finalize",
        };
      }
    }

    if (!detail?.ticket || detail.ticket.id !== ticketId ||
        typeof detail.ticket.subject !== "string" ||
        (detail.ticket.description !== undefined && typeof detail.ticket.description !== "string")) {
      return {
        ok: false,
        message: vscode.l10n.t("Remote ticket details are invalid. Retry local finalization."),
        pending: "local_finalize",
      };
    }

    const canonical = editorContentFromTicket(detail.ticket);
    const subject = canonical.subject;
    const description = canonical.description;
    const metadata = canonical.metadata;
    const remoteUpdatedAt = detail.ticket.updatedAt ?? operation.remoteUpdatedAt;

    updateDraftAfterSave(
      ticketId,
      subject,
      description,
      metadata,
      remoteUpdatedAt,
      context.connectionScope,
      detail.ticket,
    );

    const documentUri = operation.documentUri ?? operation.intent?.documentUri;
    if (documentUri && !deps?.skipDocumentRewrite) {
      const replacement = operation.nextIntent
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
      const expectedContent = operation.nextIntent
        ? ((operation.nextIntent as any).content ?? buildTicketEditorContent(source))
        : (operation.intent?.content ?? buildTicketEditorContent(source));
      const expectedRevision = (operation.nextIntent as any)?.revision ?? (operation.intentRevision ?? operation.revision ?? 1);

      if (deps?.documents?.rewriteTicket) {
        const rewriteRes = await deps.documents.rewriteTicket({
          documentUri,
          ticketId,
          projectId: operation.projectId ?? reconciled?.ticket?.projectId,
          replacement,
          expected: {
            content: expectedContent,
            operationRevision: expectedRevision,
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
            replacement,
            expected: {
              content: expectedContent,
              operationRevision: expectedRevision,
            },
          });
          if (rewriteRes.kind !== "applied") {
            return { ok: false, message: `Editor rewrite pending: ${rewriteRes.kind}`, pending: "local_finalize" };
          }
        } else {
          return { ok: false, message: "Document is closed or not available", pending: "local_finalize" };
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
    const effect = getEffectsForRevision(operation, revision).find((e) => e.effectId === effectId);
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
        const snapshot = effect.requestSnapshot as UploadRequestSnapshot | undefined;
        if (effect.state === "commit_unknown" && (!snapshot?.contentHash || snapshot.contentSize === undefined)) {
          return {
            kind: "failed_before_commit",
            error: new Error(`Cannot retry uncertain upload without snapshot content hash/size for effect ${effectId}`),
          };
        }
        const filePath = effect.target.filePath ?? snapshot?.filePath;
        if (!filePath) {
          return { kind: "failed_before_commit", error: new Error(`Cannot retry attachment without filePath for effect ${effectId}`) };
        }

        let uploadFilePath: string;
        let uploadSnapshot: UploadRequestSnapshot;
        try {
          ({ uploadFilePath, snapshot: uploadSnapshot } = await prepareMarkdownImageUpload(filePath, effect, context.connectionScope, deps.uploadSpoolStore ?? getDefaultUploadSpoolStore()));
        } catch (error) {
          return { kind: "failed_before_commit", error: error as Error };
        }

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
          const uploadFn = saveDeps.uploadFile ?? uploadFileAttachment;
          const res = await uploadFn(uploadFilePath);
          const committed = await repo.transitionEffect(
            key,
            effectId,
            { kind: "commit", token: res.token, target: { filePath: uploadSnapshot.filePath ?? filePath, filename: uploadSnapshot.filename }, requestSnapshot: uploadSnapshot },
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
      const legacyDeps: LegacyTicketRecoveryDependencies & OperationHandlerDeps = deps;
      const getDetail = deps.ticketUpdate?.getIssueDetail ?? saveDeps.getIssueDetail ?? getIssueDetail;
      const outcome = await resolveTicketChildEffect({
        key, effect, operation, resolution, repo, scope, revision,
        isTicketCreation: false,
        fallbackParentTicketId: operation.ticketId,
        forwardProjectId: operation.projectId,
        getSubject: (snapshot) => {
          const ordinal = effect.target.ordinal ?? 0;
          return snapshot?.subject ?? operation.intent?.childTickets?.[ordinal]?.subject ??
            operation.intent?.metadata?.children?.[ordinal];
        },
        getDetail,
        getCompensationDetail: deps.ticketUpdate?.getIssueDetail ?? legacyDeps.getIssueDetail ?? getDetail,
        createChild: saveDeps.createIssue ?? createIssue,
        deleteChild: deps.ticketUpdate?.deleteIssue ?? legacyDeps.deleteIssue ?? saveDeps.deleteIssue,
        finalize: (nextOp) => this.finalizeOperationIfReady(nextOp as UnifiedSyncOperation<TicketUpdateIntent>, context, deps),
      });
      if (outcome) {
        return outcome;
      }
    }

    return { kind: "failed_before_commit", error: new Error(`Unsupported effect recovery for ${effectId}`) };
  }

  private async finalizeOperationIfReady(
    op: UnifiedSyncOperation<TicketUpdateIntent>,
    context: OperationHandlerContext,
    deps: OperationHandlerDeps & { repository: SyncOperationRepository },
  ): Promise<SyncOutcome> {
    if (op.phase === "queued" && getEffectsForRevision(op).length === 0) {
      return { kind: "queued" };
    }
    const activeEffects = getEffectsForRevision(op);
    const primary = getPrimaryEffectForRevision(op);
    const parentCommitted = primary?.state === "committed";

    const hasUnresolved = activeEffects.some(
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
    const compOp = await deps.repository.completeOperation(key, context.connectionScope, op.intentRevision ?? op.revision ?? 1, {
      canonical: reconciled.canonical,
      remoteUpdatedAt: op.remoteUpdatedAt,
    }, getAttemptGeneration(op));
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
