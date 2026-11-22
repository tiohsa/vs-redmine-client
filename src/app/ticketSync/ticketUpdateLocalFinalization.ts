import * as vscode from "vscode";
import { getIssueDetail } from "../../redmine/issues";
import { compareAndRewriteDocumentWithRegisteredFields } from "../../views/editorDocumentRewrite";
import { updateDraftAfterSave } from "../../views/ticketDraftStore";
import { buildTicketEditorContent } from "../../views/ticketEditorContent";
import { editorContentFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import type {
  OperationHandlerContext,
  OperationHandlerDeps,
} from "./operationHandlerTypes";
import type { TicketUpdateIntent, UnifiedSyncOperation } from "./syncOperationTypes";
import { rebaseTicketEditorContent } from "./ticketIntentRebase";

export async function finalizeTicketUpdateLocal(
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
