import * as vscode from "vscode";
import { createSyncEngine, type SyncEngine } from "../../app/syncEngine";
import { getAttemptGeneration } from "../../app/syncEffects";
import type { SyncStatus } from "../../app/syncController";
import type { SyncUnsyncedFileResult } from "../../commands/syncUnsyncedFile";
import { getCurrentConnectionScope } from "../../config/connectionScope";
import { runWithConnectionScope } from "../../redmine/client";
import { getIssueDetail } from "../../redmine/issues";
import type { CommentSaveResult } from "../../views/commentSaveTypes";
import { getConflictContext, getConflictContextExpectation, registerConflictContext } from "../../views/conflictDiffProvider";
import { handleCommentConflict, handleConflict } from "../../views/conflictResolver";
import { getOfflineSyncQueue, type OfflineTicketConflictExpectation, type OfflineTicketUpdate } from "../../views/offlineSyncStore";
import { getConnectionScopeForEditor, getTicketEditors } from "../../views/ticketEditorRegistry";
import type { TicketSaveResult } from "../../views/ticketSaveTypes";
import { matchesQueuedTicketConflict } from "../../views/ticketConflictResolution";
import { parseQueuedTicketIntent } from "../../views/ticketSync/ticketChangeDetector";
import { metadataFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import type { DashboardUnsyncedKey } from "../dashboardProtocol";
import type { DashboardServiceContext } from "./DashboardServiceContext";

const conflictExpectationFor = (operation: OfflineTicketUpdate): OfflineTicketConflictExpectation => ({
  operationId: operation.operationId,
  revision: operation.revision,
  intentRevision: operation.intentRevision,
  attemptGeneration: getAttemptGeneration(operation),
  connectionScope: operation.connectionScope,
  content: operation.content,
});

export class DashboardSyncConflictService {
  constructor(private readonly deps: {
    context: Pick<DashboardServiceContext, "notifyError" | "notifyOperationStarted">;
    openTicketEditor?: (ticketId: number) => Promise<void>;
    getIssueDetail?: typeof getIssueDetail;
    syncEngine?: SyncEngine;
  }) {}

  async reviewTicket(requestId: string, ticketId: number): Promise<SyncStatus | undefined> {
    this.deps.context.notifyOperationStarted(requestId, vscode.l10n.t("Reviewing conflict…"));
    const operationScope = getCurrentConnectionScope();
    let conflictContext = getConflictContext(ticketId, operationScope);
    if (
      (conflictContext && conflictContext.ticketId !== ticketId) ||
      (conflictContext?.connectionScope !== undefined && conflictContext.connectionScope !== operationScope)
    ) {
      this.deps.context.notifyError(
        requestId,
        vscode.l10n.t("Conflict context is no longer available. Refresh before saving."),
      );
      return;
    }

    let expectedOperation = getConflictContextExpectation(ticketId, operationScope);
    let queued = getOfflineSyncQueue(operationScope).tickets.get(ticketId);
    if (!expectedOperation && queued) {
      expectedOperation = conflictExpectationFor(queued);
    }
    if (expectedOperation && !matchesQueuedTicketConflict(queued, expectedOperation)) {
      this.deps.context.notifyError(
        requestId,
        vscode.l10n.t("Remote changes detected. Refresh before saving."),
      );
      return;
    }

    if (!conflictContext) {
      if (
        !queued ||
        !queued.operationId ||
        typeof queued.revision !== "number" ||
        !Number.isSafeInteger(queued.revision) ||
        queued.revision <= 0
      ) {
        this.deps.context.notifyError(
          requestId,
          vscode.l10n.t("Persisted conflict data is unavailable. Refresh before saving."),
        );
        return;
      }
      const local = parseQueuedTicketIntent(queued);
      if (!local) {
        this.deps.context.notifyError(
          requestId,
          vscode.l10n.t("Persisted conflict data is invalid. Refresh before saving."),
        );
        return;
      }

      const capturedOperation = conflictExpectationFor(queued);
      try {
        const detail = await runWithConnectionScope(
          operationScope,
          () => (this.deps.getIssueDetail ?? getIssueDetail)(ticketId),
        );
        if (getCurrentConnectionScope() !== operationScope || detail.ticket.id !== ticketId) {
          throw new Error(vscode.l10n.t("The Redmine connection changed while refreshing the conflict."));
        }
        const current = getOfflineSyncQueue(operationScope).tickets.get(ticketId);
        if (!current || !matchesQueuedTicketConflict(current, capturedOperation)) {
          this.deps.context.notifyError(
            requestId,
            vscode.l10n.t("Remote changes detected. Refresh before saving."),
          );
          return;
        }
        if (!detail.ticket.updatedAt) {
          throw new Error(vscode.l10n.t("Redmine did not return the ticket update time."));
        }
        conflictContext = {
          connectionScope: operationScope,
          ticketId,
          baseSubject: current.baseSubject,
          baseDescription: current.baseDescription,
          localSubject: local.subject || current.baseSubject,
          localDescription: local.description,
          remoteSubject: detail.ticket.subject,
          remoteDescription: detail.ticket.description ?? "",
          remoteMetadata: metadataFromTicket(detail.ticket),
          remoteUpdatedAt: detail.ticket.updatedAt,
        };
        expectedOperation = capturedOperation;
        registerConflictContext(conflictContext, expectedOperation);
      } catch (error) {
        this.deps.context.notifyError(
          requestId,
          vscode.l10n.t(
            "Conflict review could not be refreshed from Redmine: {0}",
            error instanceof Error ? error.message : String(error),
          ),
        );
        return;
      }
    }

    const key: DashboardUnsyncedKey = { kind: "ticket", ticketId };
    const result: Extract<SyncUnsyncedFileResult, { status: "conflict" }> = {
      status: "conflict",
      kind: "ticket",
      id: ticketId,
      conflictContext,
    };
    const status = await this.resolveConflictInEditor(key, result, expectedOperation);
    if (!status) {
      this.deps.context.notifyError(
        requestId,
        vscode.l10n.t("Conflicts with remote changes detected. Open the file to review."),
      );
      return;
    }
    return status;
  }

  async resolveConflictInEditor(
    key: DashboardUnsyncedKey,
    result: Extract<SyncUnsyncedFileResult, { status: "conflict" }>,
    expectedOperation?: OfflineTicketConflictExpectation,
  ): Promise<SyncStatus | undefined> {
    if ((key.kind !== "ticket" && key.kind !== "comment") || key.ticketId === undefined) {
      return undefined;
    }
    const commentContext = result.kind === "comment" ? result.commentConflictContext : undefined;
    if (key.kind === "comment" && (
      (key.commentId === undefined && key.documentUri === undefined) ||
      !commentContext || commentContext.ticketId !== key.ticketId ||
      (key.commentId !== undefined && commentContext.commentId !== key.commentId) ||
      (commentContext.connectionScope !== undefined &&
        commentContext.connectionScope !== getCurrentConnectionScope())
    )) {
      return undefined;
    }
    if (key.kind === "ticket" && result.kind === "ticket" && (
      !result.conflictContext ||
      result.conflictContext.ticketId !== key.ticketId ||
      (result.conflictContext.connectionScope !== undefined &&
        result.conflictContext.connectionScope !== getCurrentConnectionScope())
    )) {
      return undefined;
    }
    const operationScope = getCurrentConnectionScope();
    const findEditor = () => getTicketEditors(key.ticketId, operationScope)
      .filter((record) => key.kind === "ticket"
        ? record.contentType === "ticket"
        : (record.contentType === "comment" || record.contentType === "commentDraft") &&
          (key.commentId === undefined || record.commentId === key.commentId) &&
          record.commentId === commentContext?.commentId &&
          (key.documentUri === undefined || record.uri === key.documentUri))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
    let editor = findEditor();
    if (!editor && key.kind === "ticket") {
      await this.deps.openTicketEditor?.(key.ticketId);
      editor = findEditor();
    }
    if (!editor) {
      return undefined;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(editor.uri));
    const textEditor = vscode.window.visibleTextEditors.find(
      (candidate) => candidate.document === document,
    ) ?? await vscode.window.showTextDocument(document, { preview: false });
    const editorScope = getConnectionScopeForEditor(textEditor);
    if (editorScope !== undefined && editorScope !== operationScope) {
      return undefined;
    }
    const resolverScope = editorScope ?? operationScope;
    const syncEngine = this.deps.syncEngine ?? createSyncEngine();

    if (key.kind === "ticket" && result.kind === "ticket" && result.conflictContext) {
      const resolved = await handleConflict(
        {
          status: "conflict",
          message: vscode.l10n.t("Remote changes detected. Review diff before syncing."),
          conflictContext: result.conflictContext,
        } satisfies TicketSaveResult,
        textEditor,
        undefined,
        resolverScope,
        syncEngine,
        expectedOperation,
      );
      return toSyncStatus(resolved.status);
    }

    if (key.kind === "comment" && result.kind === "comment" && result.commentConflictContext) {
      const resolved = await handleCommentConflict(
        {
          status: "conflict",
          message: vscode.l10n.t("Comment was updated in Redmine. Review diff before syncing."),
          commentId: result.commentConflictContext.commentId,
          conflictContext: result.commentConflictContext,
        } satisfies CommentSaveResult,
        textEditor,
        resolverScope,
        syncEngine,
      );
      return toSyncStatus(resolved.status);
    }

    return undefined;
  }

}

const toSyncStatus = (status: TicketSaveResult["status"] | CommentSaveResult["status"]): SyncStatus => {
  switch (status) {
    case "created":
    case "success":
      return "uploaded";
    case "merged":
      return "merged";
    case "no_change":
      return "noChange";
    case "conflict":
      return "conflict";
    default:
      return "failed";
  }
};
