import * as vscode from "vscode";
import { finalizeNewCommentDraftDocument } from "../../views/commentSaveSync";
import { finalizeNewCommentDraftFileAfterSync } from "../../views/commentUpdateFile";
import { getPrimaryEffectForRevision } from "../syncEffects";
import type { OperationHandlerContext, OperationHandlerDeps } from "./operationHandlerTypes";
import type { CommentCreateIntent, UnifiedSyncOperation } from "./syncOperationTypes";

export async function finalizeCommentCreateLocal(
  operation: UnifiedSyncOperation<CommentCreateIntent>,
  reconciled: any,
  context: OperationHandlerContext,
  _deps?: OperationHandlerDeps,
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
