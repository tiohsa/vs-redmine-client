import * as vscode from "vscode";
import { getOfflineSyncQueue } from "../views/offlineSyncStore";
import type { SyncEngine, SyncEngineOutcome } from "../app/syncEngine";
import type { UnsyncedFileSyncKey } from "../app/unsyncedTypes";
import type { RecoveryCancelled } from "./unsyncedRecoveryPrompt";

export const resolveTicketLocalFinalizeInteractive = async (
  engine: SyncEngine,
  key: Extract<UnsyncedFileSyncKey, { kind: "ticket" }>,
  operationScope: string,
  currentOutcome: Extract<SyncEngineOutcome, { kind: "remote_committed" }>,
): Promise<SyncEngineOutcome | RecoveryCancelled | undefined> => {
  let outcome: SyncEngineOutcome = currentOutcome;
  const currentOp = getOfflineSyncQueue(operationScope).tickets.get(key.ticketId);
  const documentUri = currentOp?.documentUri;
  const shouldOpenDocument =
    Boolean(documentUri) &&
    (currentOutcome.message === "Document is closed or not available" ||
      currentOutcome.message === "Editor rewrite pending: not_available");

  if (documentUri && shouldOpenDocument) {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(documentUri));
      await vscode.window.showTextDocument(doc, { preview: false });
      outcome = await engine.syncOne(key, { connectionScope: operationScope });
      if (outcome.kind !== "remote_committed" || outcome.pending !== "local_finalize") {
        return outcome;
      }
    } catch {}
  }

  if (typeof engine.resolveLocalFinalize !== "function") {
    return outcome;
  }

  const latestOp = getOfflineSyncQueue(operationScope).tickets.get(key.ticketId);
  if (!latestOp || latestOp.phase !== "local_finalize_pending" || !latestOp.operationId) {
    return outcome;
  }

  const reason = (outcome.kind === "remote_committed" ? outcome.message : undefined)
    ?? currentOutcome.message
    ?? vscode.l10n.t("Local file is unavailable or modified.");
  const completeLabel = vscode.l10n.t("Complete without updating local file");
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t(
      "Changes are already on Redmine, but the local file could not be updated automatically ({0}). Complete sync without updating the local file?",
      reason,
    ),
    { modal: true },
    completeLabel,
  );
  if (choice !== completeLabel) {
    return { kind: "cancelled" };
  }
  return engine.resolveLocalFinalize({
    key,
    operationId: latestOp.operationId,
    operationRevision: latestOp.intentRevision ?? latestOp.revision ?? 1,
    attemptGeneration: latestOp.attemptGeneration ?? 1,
    context: { connectionScope: operationScope },
  });
};
