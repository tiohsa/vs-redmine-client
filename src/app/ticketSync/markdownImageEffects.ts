import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { getAttachmentContentType, uploadFileAttachment } from "../../redmine/attachments";
import { type SyncOperationRepository } from "./syncRepository";
import { resolveFallbackImagePath, resolveLocalPath } from "../../utils/markdownImageUpload";
import { computeFileHashAndSizeAsync } from "../../utils/fileHash";
import { classifyFailureDisposition } from "../../utils/redmineErrors";
import type { UploadToken } from "../../redmine/types";
import {
  getAttemptGeneration,
  getEffectsForRevision,
  type SyncEffectRequestSnapshot,
  type UploadRequestSnapshot,
  type DurableSyncEffect,
} from "../syncEffects";
import type { SyncOperationKey, UnifiedSyncOperation } from "./syncOperationTypes";
import { isRemoteCommitUnknownError } from "../../views/ticketSync/ticketSyncResult";
import type { UploadSpoolStore } from "./ports";
import { getDefaultUploadSpoolStore } from "./uploadSpoolStore";
import type { OperationHandlerContext } from "./operationHandlerTypes";
import { persistUploadSnapshot, retainUploadSnapshotLease } from "./uploadSnapshotLease";

export const prepareMarkdownImageUpload = async (
  filePath: string,
  existingEffect: { requestSnapshot?: SyncEffectRequestSnapshot } | undefined,
  connectionScope: string,
  store: UploadSpoolStore,
  filename = path.basename(filePath),
): Promise<{ uploadFilePath: string; snapshot: UploadRequestSnapshot }> => {
  const existingSnapshot = existingEffect?.requestSnapshot?.kind === "upload"
    ? existingEffect.requestSnapshot as UploadRequestSnapshot
    : undefined;

  if (existingSnapshot?.spoolFilePath !== undefined) {
    if (!await store.verify(existingSnapshot)) {
      throw new Error(`Spool file identity mismatch for markdown image: ${filePath}`);
    }
    return { uploadFilePath: existingSnapshot.spoolFilePath, snapshot: existingSnapshot };
  }

  const sourcePath = existingSnapshot?.filePath ?? filePath;
  if (existingSnapshot) {
    const sourceIdentity = await computeFileHashAndSizeAsync(sourcePath);
    if (!sourceIdentity || existingSnapshot.contentHash !== sourceIdentity.contentHash ||
        existingSnapshot.contentSize !== sourceIdentity.contentSize) {
      throw new Error(`File content has changed since original snapshot: ${filePath}`);
    }
    return { uploadFilePath: sourcePath, snapshot: existingSnapshot };
  }
  const frozen = await store.freezeFile({ connectionScope, sourcePath, filename });
  const spoolFilePath = frozen.spoolFilePath;
  const snapshot: UploadRequestSnapshot = {
    kind: "upload",
    filePath: sourcePath,
    spoolFilePath,
    filename,
    contentType: getAttachmentContentType(filename),
    contentHash: frozen.contentHash,
    contentSize: frozen.contentSize,
  };
  retainUploadSnapshotLease(snapshot, frozen);
  return { uploadFilePath: spoolFilePath, snapshot };
};

export const findMarkdownImageEffect = (effects: DurableSyncEffect[], filePath: string): DurableSyncEffect | undefined => {
  const matching = effects.filter((effect) => effect.effectId === `image:markdown:${filePath}` ||
    (effect.kind === "image_upload" && effect.target.filePath === filePath));
  return matching.find((effect) => effect.effectId === `image:markdown:${filePath}`)
    ?? matching.find((effect) => effect.state === "committed")
    ?? matching.find((effect) => effect.state === "planned");
};

export const resolvePersistedMarkdownImagePath = async (
  operation: UnifiedSyncOperation,
  imagePath: string,
  baseDir?: string,
): Promise<string | undefined> => {
  const effects = getEffectsForRevision(operation);
  if (effects.length === 0) { return undefined; }
  const paths = await Promise.all([
    resolveLocalPath(imagePath, baseDir),
    resolveFallbackImagePath(imagePath, baseDir),
  ]);
  for (const filePath of paths) {
    if (!filePath) { continue; }
    const effect = findMarkdownImageEffect(effects, filePath);
    if ((effect?.state === "committed" && effect.token) ||
        (effect?.requestSnapshot?.kind === "upload" && effect.requestSnapshot.spoolFilePath)) {
      return filePath;
    }
  }
  return undefined;
};

const resolvePersistedMarkdownFilename = (
  effect: DurableSyncEffect | undefined,
  filePath: string,
): string | undefined => {
  if (!effect) { return undefined; }
  const snapshot = effect.requestSnapshot?.kind === "upload" ? effect.requestSnapshot : undefined;
  if (effect.state === "committed" && effect.target.filename && snapshot?.filename &&
    effect.target.filename !== snapshot.filename) {
    return effect.target.filename;
  }
  return snapshot?.filename ?? effect.target.filename ?? path.basename(filePath);
};

export const resolveMarkdownImageFilenames = (
  filePaths: string[],
  operation: UnifiedSyncOperation,
  selectEffect = (effects: DurableSyncEffect[], filePath: string): DurableSyncEffect | undefined => effects.find(
    (effect) => effect.effectId === `image:markdown:${filePath}` || (effect.kind === "image_upload" && effect.target.filePath === filePath),
  ),
): Map<string, string> => {
  const paths = Array.from(new Set(filePaths)).sort();
  const effects = getEffectsForRevision(operation);
  const names = new Map<string, string>();
  const owners = new Map<string, string>();
  const basenameCounts = new Map<string, number>();
  for (const filePath of paths) {
    const basename = path.basename(filePath);
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
    const effect = selectEffect(effects, filePath);
    const filename = resolvePersistedMarkdownFilename(effect, filePath);
    if (filename !== undefined) {
      if (owners.has(filename)) {
        throw new Error(vscode.l10n.t("Saved Markdown images have the same filename: {0}", filename));
      }
      owners.set(filename, filePath);
      names.set(filePath, filename);
    }
  }
  const reserved = new Set([...owners.keys(), ...paths.map((filePath) => path.basename(filePath))]);
  for (const filePath of paths) {
    if (names.has(filePath)) { continue; }
    const basename = path.basename(filePath);
    let filename = basename;
    if (basename.length > 255 || (basenameCounts.get(basename) ?? 0) > 1 || owners.has(basename)) {
      const extension = path.extname(basename);
      const stem = basename.slice(0, basename.length - extension.length);
      const hash = crypto.createHash("sha256").update(path.normalize(filePath)).digest("hex");
      let length = 12;
      const candidate = (hashLength: number): string => {
        const suffix = `-${hash.slice(0, hashLength)}${extension}`;
        if (suffix.length > 255) {
          throw new Error(vscode.l10n.t("Cannot determine a unique Markdown image filename: {0}", basename));
        }
        return `${stem.slice(0, Math.max(0, 255 - suffix.length))}${suffix}`;
      };
      filename = candidate(length);
      while (reserved.has(filename)) {
        if (length === hash.length) {
          throw new Error(vscode.l10n.t("Cannot determine a unique Markdown image filename: {0}", basename));
        }
        length = Math.min(length + 4, hash.length);
        filename = candidate(length);
      }
    }
    names.set(filePath, filename);
    owners.set(filename, filePath);
    reserved.add(filename);
  }
  return names;
};

export const getCommittedMarkdownImageUpload = (
  effect: DurableSyncEffect,
  filePath: string,
): UploadToken | undefined => {
  if (!effect.token) {
    return undefined;
  }
  const snapshot = effect.requestSnapshot?.kind === "upload"
    ? effect.requestSnapshot as UploadRequestSnapshot
    : undefined;
  const filename = resolvePersistedMarkdownFilename(effect, filePath) ?? path.basename(filePath);
  return {
    token: effect.token,
    filename,
    content_type: snapshot?.contentType ?? getAttachmentContentType(filename),
  };
};

export const uploadMarkdownImageEffects = async (
  operation: UnifiedSyncOperation,
  opKey: SyncOperationKey,
  filePaths: string[],
  context: OperationHandlerContext,
  repo: SyncOperationRepository,
  uploadFile: typeof uploadFileAttachment,
  uploadSpoolStore?: UploadSpoolStore,
): Promise<
  | { ok: true; resolvedMap: Map<string, UploadToken> }
  | { ok: false; error: Error; commitUnknown?: boolean }
> => {
  const revision = operation.intentRevision ?? operation.revision ?? 1;
  const attemptGeneration = getAttemptGeneration(operation);
  const resolvedMap = new Map<string, UploadToken>();

  const currentOp = repo.getOperation(opKey, context.connectionScope);
  if (!currentOp) {
    await repo.saveOperation(operation, context.connectionScope);
  }

  const uniquePaths = Array.from(new Set(filePaths));
  let filenames: Map<string, string>;
  try {
    filenames = resolveMarkdownImageFilenames(uniquePaths, repo.getOperation(opKey, context.connectionScope) ?? operation);
  } catch (error) {
    return { ok: false, error: error as Error };
  }
  for (const filePath of uniquePaths) {
    const canonicalEffectId = `image:markdown:${filePath}`;
    const operationSnapshot = repo.getOperation(opKey, context.connectionScope) ?? operation;
    if (getAttemptGeneration(operationSnapshot) !== attemptGeneration ||
        (operationSnapshot.intentRevision ?? operationSnapshot.revision ?? 1) !== revision) {
      return { ok: false, error: new Error(vscode.l10n.t("Markdown image operation is stale.")) };
    }
    const existingEffect = getEffectsForRevision(operationSnapshot, revision, attemptGeneration)
      .find((effect) => effect.effectId === canonicalEffectId || (effect.kind === "image_upload" && effect.target.filePath === filePath));
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
      ({ uploadFilePath, snapshot: uploadSnapshot } = await prepareMarkdownImageUpload(filePath, existingEffect, context.connectionScope, uploadSpoolStore ?? getDefaultUploadSpoolStore(), filenames.get(filePath)));
    } catch (error) {
      return { ok: false, error: error as Error };
    }

    const planned = await persistUploadSnapshot(uploadSnapshot, () => repo.planEffect(
      opKey,
      {
        effectId,
        kind: "image_upload",
        operationRevision: revision,
        attemptGeneration,
        state: "planned",
        target: { filePath, filename: uploadSnapshot.filename },
        requestSnapshot: uploadSnapshot,
      },
      context.connectionScope,
      revision,
    ));
    if (!planned) {
      return { ok: false, error: new Error(`Failed to plan effect ${effectId}`) };
    }

    const started = await repo.transitionEffect(
      opKey,
      effectId,
      { kind: "start", requestSnapshot: uploadSnapshot },
      context.connectionScope,
      { operationRevision: revision, attemptGeneration, sourceState: "planned" },
    );
    if (!started) {
      return { ok: false, error: new Error(`Failed to start effect ${effectId}`) };
    }

    try {
      const upload = await uploadFile(uploadFilePath);
      let committed: UnifiedSyncOperation | undefined;
      try {
        committed = await repo.transitionEffect(
          opKey,
          effectId,
          {
            kind: "commit",
            token: upload.token,
            target: { filePath, filename: uploadSnapshot.filename },
            requestSnapshot: uploadSnapshot,
          },
          context.connectionScope,
          { operationRevision: revision, attemptGeneration, sourceState: "started" },
        );
      } catch {
        committed = undefined;
      }
      if (!committed) {
        try {
          await repo.transitionEffect(
            opKey,
            effectId,
            { kind: "mark_commit_unknown" },
            context.connectionScope,
            { operationRevision: revision, attemptGeneration, sourceState: "started" },
          );
        } catch {
          // Keep the started state when the unknown checkpoint itself cannot be persisted.
        }
        return {
          ok: false,
          error: new Error(`Failed to commit effect ${effectId}`),
          commitUnknown: true,
        };
      }
      resolvedMap.set(filePath, {
        token: upload.token,
        filename: uploadSnapshot.filename,
        content_type: uploadSnapshot.contentType,
      });
    } catch (error) {
      const commitUnknown = isRemoteCommitUnknownError(error);
      const disposition = classifyFailureDisposition(error);
      await repo.transitionEffect(
        opKey,
        effectId,
        commitUnknown
          ? { kind: "mark_commit_unknown" }
          : { kind: "mark_failed", detail: (error as Error).message, disposition },
        context.connectionScope,
        { operationRevision: revision, attemptGeneration, sourceState: "started" },
      );
      return { ok: false, error: error as Error, commitUnknown };
    }
  }
  return { ok: true, resolvedMap };
};
