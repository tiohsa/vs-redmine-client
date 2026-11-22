import * as vscode from "vscode";
import type { IssueUploadInput } from "../../redmine/issues";
import { createSyncOperationRepository, type SyncOperationRepository } from "./syncRepository";
import { normalizeCommentBody } from "../../views/commentSaveSync";
import { isMissingPathReason, resolveFallbackImagePath, resolveLocalPath } from "../../utils/markdownImageUpload";
import { containsConflictMarkers } from "../../utils/threeWayMerge";
import { computeNotesHash } from "../../utils/notesHash";
import { classifyFailureDisposition } from "../../utils/redmineErrors";
import type { UploadToken } from "../../redmine/types";
import {
  getEffectsForRevision,
  getPrimaryEffectForRevision,
  canRetryFailedCommentEffect,
  type AttachmentLinkRequestSnapshot,
  type CommentUpdateRequestSnapshot,
  type UploadRequestSnapshot,
} from "../syncEffects";
import type { CommentUpdateIntent, SyncOperationKey, SyncOutcome, UnifiedSyncOperation } from "./syncOperationTypes";
import { isRemoteCommitUnknownError } from "../../views/ticketSync/ticketSyncResult";
import { getDefaultUploadSpoolStore } from "./uploadSpoolStore";
import {
  extractMarkdownImageLinks,
  applyMarkdownImageReplacements,
  isExternalMarkdownImagePath,
} from "../../utils/markdownImageLinks";
import { validateLocalImagePath } from "../../utils/markdownImageValidation";
import type { OperationHandler, OperationHandlerContext, OperationHandlerDeps, EffectResolution } from "./operationHandlerTypes";
import type { PreparedCommentData } from "./commentHandlerTypes";
import { defaultCommentDeps } from "./commentHandlerDependencies";
import { resolveIntentBaseDir } from "./resolveIntentBaseDir";
import { resolvePersistedMarkdownImagePath, resolveMarkdownImageFilenames, findMarkdownImageEffect, getCommittedMarkdownImageUpload, prepareMarkdownImageUpload } from "./markdownImageEffects";
import { persistUploadSnapshot } from "./uploadSnapshotLease";
import { resolveCommentUpdateEffect } from "./commentUpdateEffectRecovery";
import { finalizeCommentUpdateLocal } from "./commentUpdateLocalFinalization";

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

    if (intent.baseBody !== undefined && nextContent === intent.baseBody && (operation.effects?.length ?? 0) === 0) {
      return { ok: false, outcome: { kind: "no_change", ticketId, commentId } };
    }

    const retrySnapshot = getPrimaryEffectForRevision(operation)?.requestSnapshot;
    const retrying = retrySnapshot?.kind === "comment_update";
    let alreadyApplied = false;
    if (retrying || intent.sourceNotesHash !== undefined || intent.lastKnownRemoteUpdatedAt !== undefined) {
      try {
        const detail = await commentDeps.getIssueDetail(ticketId);
        const remoteComment = detail.comments.find((c) => c.id === commentId);
        if (detail.ticket.id !== ticketId || !remoteComment) {
          throw new Error(vscode.l10n.t("Comment not found in Redmine."));
        }
        alreadyApplied = retrying && normalizeCommentBody(remoteComment.body) === normalizeCommentBody(retrySnapshot.request.notes);
        if (!alreadyApplied) {
          const remoteHash = computeNotesHash(remoteComment.body);
          const hashChanged = intent.sourceNotesHash !== undefined &&
            remoteHash !== intent.sourceNotesHash;
          const timestampChanged = intent.lastKnownRemoteUpdatedAt !== undefined &&
            remoteComment.updatedAt !== intent.lastKnownRemoteUpdatedAt;
          const baselineMissing = retrying && intent.sourceNotesHash === undefined &&
            intent.lastKnownRemoteUpdatedAt === undefined && intent.baseBody === undefined;
          const bodyChanged = intent.baseBody !== undefined &&
            normalizeCommentBody(remoteComment.body) !== normalizeCommentBody(intent.baseBody);
          const remoteChanged = hashChanged || timestampChanged || bodyChanged || baselineMissing;
          if (remoteChanged) {
            return {
              ok: false,
              outcome: {
                kind: "conflict",
                ticketId,
                commentId,
                message: vscode.l10n.t("Comment was updated in Redmine. Review the diff before syncing."),
                commentConflictContext: {
                  ...(context.connectionScope ? { connectionScope: context.connectionScope } : {}),
                  ticketId,
                  commentId,
                  baseBody: intent.baseBody ?? "",
                  baseBodyKnown: intent.baseBody !== undefined,
                  localBody: nextContent,
                  remoteBody: remoteComment.body,
                  remoteUpdatedAt: remoteComment.updatedAt,
                },
              },
            };
          }
        }
      } catch (error) {
        return { ok: false, outcome: { kind: "failed_before_commit", ticketId, commentId,
          error: error instanceof Error ? error : new Error(String(error)) } };
      }
    }

    const primary = getPrimaryEffectForRevision(operation);
    const snapshot = primary?.requestSnapshot;
    if (primary && canRetryFailedCommentEffect(primary) && snapshot?.kind === "comment_update") {
      return {
        ok: true,
        prepared: {
          ticketId,
          commentId: snapshot.request.commentId,
          rawBody: intent.body,
          body: snapshot.request.notes,
          uploads: snapshot.request.uploads ?? [],
          imageLinks: [],
          alreadyApplied,
        },
      };
    }

    const links = extractMarkdownImageLinks(nextContent);
    const imageLinks: PreparedCommentData["imageLinks"] = [];
    const baseDir = resolveIntentBaseDir(intent);

    for (const link of links) {
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
        return {
          ok: false,
          outcome: { kind: "failed_before_commit", ticketId, commentId, error: new Error(`Relative path cannot be resolved: ${link.path}`) },
        };
      }

      const val = await validateLocalImagePath({ filePath: resolvedPath });
      if (!val.valid && isMissingPathReason(val.reason)) {
        if (baseDir) {
          const fallbackPath = await resolveFallbackImagePath(link.path, baseDir);
          const fallbackVal = fallbackPath
            ? await validateLocalImagePath({ filePath: fallbackPath })
            : { valid: false };
          if (fallbackPath && fallbackVal.valid) {
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
    const uniquePaths = Array.from(
      new Set(
        prepared.imageLinks
          .map((link) => link.resolvedPath)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    let filenames: Map<string, string>;
    try {
      filenames = resolveMarkdownImageFilenames(uniquePaths, repo.getOperation(opKey, context.connectionScope) ?? operation, findMarkdownImageEffect);
    } catch (error) {
      return { ok: false, error: error as Error };
    }

    for (const filePath of uniquePaths) {
      const canonicalEffectId = `image:markdown:${filePath}`;
      const currentOp = repo.getOperation(opKey, context.connectionScope) ?? operation;
      const matchingEffects = getEffectsForRevision(currentOp, revision)
        .filter((e) => e.effectId === canonicalEffectId || (e.kind === "image_upload" && e.target.filePath === filePath));
      const blockingEffect = matchingEffects.find((e) =>
        e.state === "started" ||
        e.state === "commit_unknown" ||
        e.state === "failed" ||
        e.state === "compensation_started" ||
        e.state === "compensation_unknown");
      if (blockingEffect) {
        return {
          ok: false,
          error: new Error(`Markdown image effect ${blockingEffect.effectId} requires explicit recovery.`),
          commitUnknown: blockingEffect.state === "commit_unknown" || blockingEffect.state === "started",
        };
      }
      const existingEffect = matchingEffects.find((e) => e.effectId === canonicalEffectId)
        ?? matchingEffects.find((e) => e.state === "committed")
        ?? matchingEffects.find((e) => e.state === "planned");
      const effectId = existingEffect?.effectId ?? canonicalEffectId;

      if (existingEffect?.state === "committed" && existingEffect.token) {
        const upload = getCommittedMarkdownImageUpload(existingEffect, filePath);
        if (upload) {
          resolvedMap.set(filePath, upload);
        }
        continue;
      }

      if (existingEffect && existingEffect.state !== "planned") {
        return {
          ok: false,
          error: new Error(`Markdown image effect ${effectId} requires explicit recovery.`),
          commitUnknown: existingEffect.state === "commit_unknown" || existingEffect.state === "started",
        };
      }

      let uploadFilePath: string;
      let uploadSnapshot: UploadRequestSnapshot;
      try {
        ({ uploadFilePath, snapshot: uploadSnapshot } = await prepareMarkdownImageUpload(filePath, existingEffect, context.connectionScope, deps?.uploadSpoolStore ?? getDefaultUploadSpoolStore(), filenames.get(filePath)));
      } catch (error) {
        return { ok: false, error: error as Error };
      }

      const planImg = await persistUploadSnapshot(uploadSnapshot, () => repo.planEffect(
        opKey,
        {
          effectId,
          kind: "image_upload",
          operationRevision: revision,
          state: "planned",
          target: { filePath, filename: uploadSnapshot.filename },
          requestSnapshot: uploadSnapshot,
        },
        context.connectionScope,
        revision,
      ));
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
        const upload = await commentDeps.uploadFile(uploadFilePath);
        let commitImg: UnifiedSyncOperation | undefined;
        try {
          commitImg = await repo.transitionEffect(
            opKey,
            effectId,
            { kind: "commit", token: upload.token, target: { filePath, filename: uploadSnapshot.filename }, requestSnapshot: uploadSnapshot },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
        } catch {
          commitImg = undefined;
        }
        if (!commitImg) {
          try {
            await repo.transitionEffect(
              opKey,
              effectId,
              { kind: "mark_commit_unknown" },
              context.connectionScope,
              { operationRevision: revision, sourceState: "started" },
            );
          } catch {
            // ignore
          }
          return { ok: false, error: new Error(`Failed to commit effect ${effectId}`), commitUnknown: true };
        }
        resolvedMap.set(filePath, {
          token: upload.token,
          filename: uploadSnapshot.filename,
          content_type: uploadSnapshot.contentType,
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

    if (prepared.uploads.length > 0) {
      const linkEffectId = "attachment-link";
      const operationSnapshot = repo.getOperation(opKey, context.connectionScope) ?? operation;
      const existingLink = getEffectsForRevision(operationSnapshot, revision)
        .find((effect) => effect.effectId === linkEffectId);
      const linkSnapshot: AttachmentLinkRequestSnapshot = existingLink?.requestSnapshot?.kind === "attachment_link"
        ? existingLink.requestSnapshot as AttachmentLinkRequestSnapshot
        : {
          kind: "attachment_link",
          request: {
            issueId: prepared.ticketId,
            fields: { uploads: prepared.uploads },
          },
        };

      if (existingLink?.state === "committed") {
        prepared.uploads = linkSnapshot.request.fields.uploads;
      } else {
        if (existingLink && existingLink.state !== "planned") {
          return {
            ok: false,
            error: new Error("Attachment link effect requires explicit recovery."),
            commitUnknown: existingLink.state === "commit_unknown" || existingLink.state === "started",
          };
        }
        const plannedLink = await repo.planEffect(
          opKey,
          {
            effectId: linkEffectId,
            kind: "attachment_link",
            operationRevision: revision,
            state: "planned",
            target: { ticketId: prepared.ticketId, commentId: prepared.commentId },
            requestSnapshot: linkSnapshot,
          },
          context.connectionScope,
          revision,
        );
        if (!plannedLink) {
          return { ok: false, error: new Error("Failed to plan attachment link effect") };
        }
        const startedLink = await repo.transitionEffect(
          opKey,
          linkEffectId,
          { kind: "start", requestSnapshot: linkSnapshot },
          context.connectionScope,
          { operationRevision: revision, sourceState: "planned" },
        );
        if (!startedLink) {
          return { ok: false, error: new Error("Failed to start attachment link effect") };
        }

        try {
          await commentDeps.updateIssue(linkSnapshot.request);
        } catch (error) {
          const commitUnknown = isRemoteCommitUnknownError(error);
          const disposition = classifyFailureDisposition(error);
          await repo.transitionEffect(
            opKey,
            linkEffectId,
            commitUnknown
              ? { kind: "mark_commit_unknown" }
              : { kind: "mark_failed", detail: (error as Error).message, disposition },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
          return { ok: false, error: error as Error, commitUnknown };
        }

        let committedLink: UnifiedSyncOperation | undefined;
        try {
          committedLink = await repo.transitionEffect(
            opKey,
            linkEffectId,
            { kind: "commit", target: { ticketId: prepared.ticketId }, requestSnapshot: linkSnapshot },
            context.connectionScope,
            { operationRevision: revision, sourceState: "started" },
          );
        } catch {
          committedLink = undefined;
        }
        if (!committedLink) {
          try {
            await repo.transitionEffect(
              opKey,
              linkEffectId,
              { kind: "mark_commit_unknown" },
              context.connectionScope,
              { operationRevision: revision, sourceState: "started" },
            );
          } catch {
            // Keep the started state when the unknown checkpoint itself cannot be persisted.
          }
          return { ok: false, error: new Error("Failed to commit attachment link effect"), commitUnknown: true };
        }
      }
    }

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

    const existingPrimaryEffect = getPrimaryEffectForRevision(currentOp ?? operation);
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
      const uploads = requestSnapshot.request?.uploads;
      if (!prepared.alreadyApplied) {
        await commentDeps.updateComment(
          requestSnapshot.request?.commentId ?? prepared.commentId!,
          requestSnapshot.request?.notes ?? prepared.body,
          uploads,
        );
      }

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

      const primaryEffect = getPrimaryEffectForRevision(operation);
      const expectedBody = (primaryEffect?.requestSnapshot as CommentUpdateRequestSnapshot | undefined)?.submittedBody
        ?? primaryEffect?.target?.submittedBody
        ?? operation.intent?.body
        ?? "";

      if ((operation.phase === "commit_unknown" || primaryEffect?.state === "failed") && normalizeCommentBody(remoteComment.body) !== normalizeCommentBody(expectedBody)) {
        return { ok: false, message: "Remote comment body does not match intended update" };
      }
    return {
      ok: true,
      remoteId: commentId,
      projectId: detail.ticket.projectId,
      remoteUpdatedAt: remoteComment.updatedAt,
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
    return finalizeCommentUpdateLocal(operation, reconciled, context);
  }

  public async resolveEffect(input: {
    key: SyncOperationKey;
    effectId: string;
    operation: UnifiedSyncOperation<CommentUpdateIntent>;
    context: OperationHandlerContext;
    deps: OperationHandlerDeps & { repository: SyncOperationRepository };
    resolution: EffectResolution;
  }): Promise<SyncOutcome> {
    return resolveCommentUpdateEffect(input);
  }
}
