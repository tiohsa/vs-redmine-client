import * as vscode from "vscode";
import { markNewTicketDraftSynced } from "../../views/newTicketDraftStore";
import { updateDraftAfterSave } from "../../views/ticketDraftStore";
import {
  buildTicketEditorContent,
  parseTicketEditorContent,
  type TicketEditorContent,
} from "../../views/ticketEditorContent";
import { registerTicketDocument, removeTicketEditorByUri } from "../../views/ticketEditorRegistry";
import { rewriteNewTicketEditorToTicketMode } from "../../views/ticketSync/ticketEditorRewrite";
import { editorContentFromTicket, metadataFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import type {
  OperationHandlerContext,
  OperationHandlerDeps,
} from "./operationHandlerTypes";
import type {
  TicketCreateIntent,
  UnifiedSyncOperation,
} from "./syncOperationTypes";

export async function finalizeTicketCreateLocal(
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
