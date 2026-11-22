import * as path from "path";
import * as vscode from "vscode";
import {
  getCommentIdForDocument,
  getConnectionScopeForDocument,
  getEditorContentTypeForDocument,
  getTicketIdForDocument,
} from "../../views/ticketEditorRegistry";
import {
  isCommentUpdateDocument,
  isCommentUpdateFilename,
  updateCommentUpdateFileAfterSync,
} from "../../views/commentUpdateFile";
import { updateCommentEdit } from "../../views/commentEditStore";
import type { OperationHandlerContext } from "./operationHandlerTypes";
import type { CommentUpdateIntent, UnifiedSyncOperation } from "./syncOperationTypes";

export async function finalizeCommentUpdateLocal(
  operation: UnifiedSyncOperation<CommentUpdateIntent>,
  reconciled: any,
  context: OperationHandlerContext,
): Promise<{ ok: true } | { ok: false; message: string; pending: "local_finalize" }> {
  const documentUri = operation.documentUri ?? operation.intent?.documentUri;
  const body = operation.intent?.body ?? "";
  const commentId = operation.commentId ?? operation.intent?.commentId;
  const remoteComment = commentId === undefined
    ? undefined
    : reconciled?.comments?.find((comment: { id?: number }) => comment.id === commentId);
  const remoteBody = typeof remoteComment?.body === "string" ? remoteComment.body : body;
  const remoteUpdatedAt = typeof remoteComment?.updatedAt === "string"
    ? remoteComment.updatedAt
    : operation.remoteUpdatedAt;

  const openDocument = documentUri === undefined
    ? undefined
    : vscode.workspace.textDocuments.find((document) => document.uri.toString() === documentUri);
  const isRegisteredPlainComment = openDocument !== undefined &&
    getEditorContentTypeForDocument(openDocument) === "comment" &&
    getTicketIdForDocument(openDocument) === (operation.ticketId ?? operation.intent?.ticketId) &&
    getCommentIdForDocument(openDocument) === commentId &&
    getConnectionScopeForDocument(openDocument) === context.connectionScope &&
    !isCommentUpdateDocument(openDocument.getText(), openDocument.uri.path);
  const requiresCommentUpdateFileFinalize = !isRegisteredPlainComment &&
    (operation.intent?.sourceNotesHash !== undefined ||
      (documentUri !== undefined && isCommentUpdateFilename(path.basename(vscode.Uri.parse(documentUri).path))));
  if (documentUri && requiresCommentUpdateFileFinalize) {
    const res = await updateCommentUpdateFileAfterSync({
      documentUri,
      syncedBody: remoteBody,
      expectedBody: operation.intent?.body ?? "",
      remoteUpdatedAt,
      canonical: reconciled,
    });
    if (res !== "applied") {
      return { ok: false, message: `Local finalization pending: ${res}`, pending: "local_finalize" };
    }
  } else if (commentId !== undefined) {
    updateCommentEdit(commentId, remoteBody, remoteUpdatedAt, context.connectionScope);
  }
  return { ok: true };
}
