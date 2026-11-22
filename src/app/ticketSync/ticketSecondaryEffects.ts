import * as path from "path";
import * as vscode from "vscode";
import type { IssueUploadInput } from "../../redmine/issues";
import { getAttachmentContentType, parseClipboardImageDataUri, uploadFileAttachment } from "../../redmine/attachments";
import { applyMarkdownImageReplacements } from "../../utils/markdownImageLinks";
import { computeFileHashAndSizeAsync } from "../../utils/fileHash";
import { classifyFailureDisposition } from "../../utils/redmineErrors";
import { defaultCreateDeps } from "../../views/ticketSync/ticketSyncDeps";
import { isRemoteCommitUnknownError } from "../../views/ticketSync/ticketSyncResult";
import { getEffectsForRevision, getOperationRecoveryMode, type UploadRequestSnapshot } from "../syncEffects";
import { resolveMarkdownImageFilenames, uploadMarkdownImageEffects } from "./markdownImageEffects";
import type { OperationHandlerContext, OperationHandlerDeps } from "./operationHandlerTypes";
import type { SyncOperationKey, TicketCreateIntent, TicketUpdateIntent, UnifiedSyncOperation } from "./syncOperationTypes";
import { createSyncOperationRepository } from "./syncRepository";
import type { PreparedTicketCreate } from "./ticketHandlerTypes";
import { persistUploadSnapshot, retainUploadSnapshotLease } from "./uploadSnapshotLease";
import { getDefaultUploadSpoolStore } from "./uploadSpoolStore";

export const executeTicketSecondaryEffects = async (
  operation: UnifiedSyncOperation<TicketCreateIntent | TicketUpdateIntent>,
  prepared: PreparedTicketCreate,
  context: OperationHandlerContext,
  deps?: OperationHandlerDeps,
): Promise<{ ok: true; uploadTokens?: IssueUploadInput[] } | { ok: false; error: Error; commitUnknown?: boolean }> => {
  if (getOperationRecoveryMode(operation) === "compensation_blocked") {
    return {
      ok: false,
      error: new Error("Forward secondary effects are blocked while primary compensation has unresolved rollback obligations."),
    };
  }

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

  try {
    resolveMarkdownImageFilenames((prepared.imageLinks ?? []).map((link) => link.resolvedPath),
      repo.getOperation(opKey, context.connectionScope) ?? operation);
  } catch (error) {
    return { ok: false, error: error as Error };
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
      const existingEffect = getEffectsForRevision(currentOp, revision).find((e) => e.effectId === effectId);

      if (existingEffect?.state === "committed" && existingEffect.token) {
        if (!tokens.some((t) => t.token === existingEffect.token)) {
          const snapshot = existingEffect.requestSnapshot?.kind === "upload" ? existingEffect.requestSnapshot : undefined;
          tokens.push({ token: existingEffect.token, filename: snapshot?.filename ?? existingEffect.target.filename ?? att.filename ?? "attachment", content_type: snapshot?.contentType ?? att.contentType ?? "application/octet-stream" });
        }
        continue;
      }

      let uploadSnapshot: UploadRequestSnapshot;
      let uploadFilePath: string;
      if (existingEffect?.requestSnapshot) {
        uploadSnapshot = existingEffect.requestSnapshot as UploadRequestSnapshot;
        if (uploadSnapshot.spoolFilePath !== undefined) {
          if (!await (deps?.uploadSpoolStore ?? getDefaultUploadSpoolStore()).verify(uploadSnapshot)) {
            return { ok: false, error: new Error(`Spool file identity mismatch for file attachment: ${effectId}`) };
          }
          uploadFilePath = uploadSnapshot.spoolFilePath;
        } else {
          uploadFilePath = uploadSnapshot.filePath ?? att.filePath;
          const fileId = await computeFileHashAndSizeAsync(uploadFilePath);
          if (!fileId) {
            return { ok: false, error: new Error(`Failed to compute hash for file attachment: ${uploadFilePath}`) };
          }
          if (
            uploadSnapshot.contentHash &&
            (uploadSnapshot.contentHash !== fileId.contentHash || uploadSnapshot.contentSize !== fileId.contentSize)
          ) {
            return { ok: false, error: new Error(`File content has changed since original snapshot: ${uploadFilePath}`) };
          }
        }
      } else {
        try {
          const frozen = await (deps?.uploadSpoolStore ?? getDefaultUploadSpoolStore()).freezeFile({
            connectionScope: context.connectionScope, sourcePath: att.filePath,
            filename: att.filename ?? path.basename(att.filePath),
          });
          const spoolFilePath = frozen.spoolFilePath;
          uploadSnapshot = {
            kind: "upload",
            filePath: att.filePath,
            spoolFilePath,
            filename: att.filename ?? path.basename(att.filePath),
            contentType: att.contentType ?? getAttachmentContentType(att.filename ?? path.basename(att.filePath)),
            contentHash: frozen.contentHash,
            contentSize: frozen.contentSize,
          };
          retainUploadSnapshotLease(uploadSnapshot, frozen);
          uploadFilePath = spoolFilePath;
        } catch (error) {
          return { ok: false, error: error as Error };
        }
      }

      const planRes = await persistUploadSnapshot(uploadSnapshot, () => repo.planEffect(
        opKey,
        {
          effectId,
          kind: "attachment_upload",
          operationRevision: revision,
          state: "planned",
          target: { filePath: uploadSnapshot.filePath ?? att.filePath, filename: uploadSnapshot.filename },
          requestSnapshot: uploadSnapshot,
        },
        context.connectionScope,
        revision,
      ));
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
        const res = await uploadFn(uploadFilePath);
        const commitRes = await repo.transitionEffect(
          opKey,
          effectId,
          { kind: "commit", token: res.token, target: { filePath: uploadSnapshot.filePath ?? att.filePath, filename: uploadSnapshot.filename }, requestSnapshot: uploadSnapshot },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
        );
        if (!commitRes) {
          try {
            await repo.transitionEffect(
              opKey,
              effectId,
              { kind: "mark_commit_unknown" },
              context.connectionScope,
              { operationRevision: revision, sourceState: "started" },
            );
          } catch {
            // ignore persistence failure
          }
          return { ok: false, error: new Error(`Failed to commit effect ${effectId}`), commitUnknown: true };
        }
        tokens.push({ token: res.token, filename: uploadSnapshot.filename, content_type: uploadSnapshot.contentType });
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
      const existingEffect = getEffectsForRevision(currentOp, revision).find((e) => e.effectId === effectId);

      if (existingEffect?.state === "committed" && existingEffect.token) {
        if (!tokens.some((t) => t.token === existingEffect.token)) {
          const snapshot = existingEffect.requestSnapshot?.kind === "upload" ? existingEffect.requestSnapshot : undefined;
          tokens.push({ token: existingEffect.token, filename: snapshot?.filename ?? att.filename ?? "clipboard.png",
            content_type: snapshot?.contentType ?? att.contentType ?? "image/png" });
        }
        continue;
      }

      let uploadSnapshot: UploadRequestSnapshot;
      let spoolFilePath: string | undefined;

      if (existingEffect?.requestSnapshot) {
        uploadSnapshot = existingEffect.requestSnapshot as UploadRequestSnapshot;
        spoolFilePath = uploadSnapshot.spoolFilePath;
        if (!await (deps?.uploadSpoolStore ?? getDefaultUploadSpoolStore()).verify(uploadSnapshot)) {
          return { ok: false, error: new Error(`Spool file not found for clipboard attachment: ${effectId}`) };
        }
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
        } catch (err) {
          return { ok: false, error: new Error(`Failed to parse clipboard image data: ${(err as Error).message}`) };
        }
        try {
          const frozen = await (deps?.uploadSpoolStore ?? getDefaultUploadSpoolStore()).freezeBuffer({
            connectionScope: context.connectionScope, buffer, filename, contentType,
          });
          spoolFilePath = frozen.spoolFilePath;
          uploadSnapshot = { kind: "upload", filePath: spoolFilePath,
            filename, contentType, contentHash: frozen.contentHash,
            contentSize: frozen.contentSize, spoolFilePath };
          retainUploadSnapshotLease(uploadSnapshot, frozen);
        } catch (error) {
          return { ok: false, error: error as Error };
        }
      }

      const planClipRes = await persistUploadSnapshot(uploadSnapshot, () => repo.planEffect(
        opKey,
        {
          effectId,
          kind: "attachment_upload",
          operationRevision: revision,
          state: "planned",
          target: { filename: uploadSnapshot.filename },
          requestSnapshot: uploadSnapshot,
        },
        context.connectionScope,
        revision,
      ));
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
        const uploadFn = createDeps.uploadFile ?? uploadFileAttachment;
        const res = await uploadFn(spoolFilePath!);
        const commitClipRes = await repo.transitionEffect(
          opKey,
          effectId,
          { kind: "commit", token: res.token, target: { filename: uploadSnapshot.filename }, requestSnapshot: uploadSnapshot },
          context.connectionScope,
          { operationRevision: revision, sourceState: "started" },
        );
        if (!commitClipRes) {
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
        tokens.push({ token: res.token, filename: uploadSnapshot.filename, content_type: uploadSnapshot.contentType });
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

  const imageLinks = prepared.imageLinks ?? [];
  if (imageLinks.length > 0) {
    const uploaded = await uploadMarkdownImageEffects(
      operation, opKey, imageLinks.map((link) => link.resolvedPath),
      context, repo, createDeps.uploadFile, deps?.uploadSpoolStore,
    );
    if (!uploaded.ok) {
      return uploaded;
    }
    const replacements = imageLinks.flatMap((link) => {
      const upload = uploaded.resolvedMap.get(link.resolvedPath);
      return upload ? [{ range: link.range, value: upload.filename }] : [];
    });
    const description = applyMarkdownImageReplacements(prepared.parsed.description, replacements);
    for (const upload of uploaded.resolvedMap.values()) {
      if (!tokens.some((existing) => existing.token === upload.token)) {
        tokens.push(upload);
      }
    }
    prepared.parsed = { ...prepared.parsed, description };
    if (prepared.request) {
      prepared.request = { ...prepared.request, description, uploads: tokens };
      prepared.snapshot = { kind: "ticket_create", request: prepared.request };
    }
  }
  prepared.uploadTokens = tokens;
  return { ok: true, uploadTokens: tokens };
};
