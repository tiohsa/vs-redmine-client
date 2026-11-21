import * as vscode from "vscode";
import type { IssueUploadInput } from "../../redmine/issues";
import { createSyncOperationRepository, type SyncOperationRepository } from "./syncRepository";
import { finalizeNewCommentDraftDocument, reconcileCommentCommitUnknown } from "../../views/commentSaveSync";
import { finalizeNewCommentDraftFileAfterSync } from "../../views/commentUpdateFile";
import { isMissingPathReason, resolveFallbackImagePath, resolveLocalPath } from "../../utils/markdownImageUpload";
import { validateComment } from "../../utils/commentValidation";
import { containsConflictMarkers } from "../../utils/threeWayMerge";
import { classifyFailureDisposition } from "../../utils/redmineErrors";
import type { UploadToken } from "../../redmine/types";
import {
  getEffectsForRevision,
  getPrimaryEffectForRevision,
  canRetryFailedCommentEffect,
  type CommentCreateRequestSnapshot,
  type UploadRequestSnapshot,
} from "../syncEffects";
import type { CommentCreateIntent, SyncOperationKey, SyncOutcome, UnifiedSyncOperation } from "./syncOperationTypes";
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
import { resolveIntentBaseDir } from "./resolveIntentBaseDir";
import { resolvePersistedMarkdownImagePath, resolveMarkdownImageFilenames, findMarkdownImageEffect, getCommittedMarkdownImageUpload, prepareMarkdownImageUpload } from "./markdownImageEffects";
import { persistUploadSnapshot } from "./uploadSnapshotLease";
import { resolveCommentUploadEffect } from "./commentUploadEffectRecovery";
import { defaultCommentDeps } from "./commentHandlerDependencies";

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

    const primary = getPrimaryEffectForRevision(operation);
    const snapshot = primary?.requestSnapshot;
    if (primary && canRetryFailedCommentEffect(primary) && snapshot?.kind === "comment_create") {
      return {
        ok: true,
        prepared: {
          ticketId: snapshot.request.ticketId,
          rawBody: intent.body,
          body: snapshot.request.notes,
          uploads: snapshot.request.uploads ?? [],
          imageLinks: [],
        },
      };
    }

    const rawBody = intent.body ?? "";

    if (containsConflictMarkers(rawBody)) {
      return { ok: false, outcome: { kind: "failed_before_commit", ticketId, error: new Error(vscode.l10n.t("Resolve all merge conflict markers before syncing.")) } };
    }

    const validation = validateComment(rawBody);
    if (!validation.valid) {
      return { ok: false, outcome: { kind: "failed_before_commit", ticketId, error: new Error(validation.message ?? "Invalid comment.") } };
    }

    const links = extractMarkdownImageLinks(rawBody);
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
          outcome: { kind: "failed_before_commit", ticketId, error: new Error(`Relative path cannot be resolved: ${link.path}`) },
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

    const existingPrimaryEffect = getPrimaryEffectForRevision(currentOp ?? operation);
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

    const primaryEffect = getPrimaryEffectForRevision(operation);
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
    const primary = getPrimaryEffectForRevision(operation);
    const snapshot = primary?.requestSnapshot;
    const syncedBody = snapshot?.kind === "comment_create"
      ? snapshot.request.notes
      : primary?.target.submittedBody ?? operation.intent?.body ?? "";

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
          body: syncedBody,
        });
      }
      if (operation.intent?.finalizeDraft) {
        const res = await finalizeNewCommentDraftFileAfterSync({
          documentUri,
          ticketId,
          commentId,
          projectId: operation.projectId ?? reconciled?.projectId,
          expectedDocumentBody: operation.intent?.body ?? "",
          syncedBody,
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
    const { effectId, operation, deps } = input;
    const revision = operation.intentRevision ?? operation.revision ?? 1;
    const effect = getEffectsForRevision(operation, revision).find((e) => e.effectId === effectId);
    if (!effect) {
      return { kind: "failed_before_commit", error: new Error(`Effect not found: ${effectId}`) };
    }

    const commentDeps = { ...defaultCommentDeps, ...deps.comment };

    return resolveCommentUploadEffect({
      ...input, effect, revision, commentDeps,
    });
  }
}
