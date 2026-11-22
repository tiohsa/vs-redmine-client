import * as vscode from "vscode";
import type { SyncStatus } from "../../app/syncController";
import type { SyncEngine } from "../../app/syncEngine";
import type { UnsyncedFileSyncKey } from "../../app/unsyncedTypes";
import { runOfflineSync } from "../../commands/offlineSync";
import { syncUnsyncedFile, type SyncUnsyncedFileResult } from "../../commands/syncUnsyncedFile";
import { getCurrentConnectionScope } from "../../config/connectionScope";
import type { getIssueDetail } from "../../redmine/issues";
import { getOfflineSyncQueue, isAbandoned, sameDocumentIdentity } from "../../views/offlineSyncStore";
import { getTicketEditors } from "../../views/ticketEditorRegistry";
import type { DashboardUnsyncedKey } from "../dashboardProtocol";
import { buildUnsyncedDashboardItems } from "../viewModels/unsyncedDashboardViewModel";
import type { DashboardServiceContext } from "./DashboardServiceContext";
import { DashboardSyncConflictService } from "./DashboardSyncConflictService";
import { DashboardSyncNotifications } from "./DashboardSyncNotifications";
import { DashboardUnsyncedQueueActions } from "./DashboardUnsyncedQueueActions";
import { openSnapshot } from "./dashboardPendingDeletionChanges";
import { buildUnsyncedPendingChanges, pendingChangeFocusId } from "./dashboardUnsyncedPendingChanges";
import { discardReadOnlyDraft } from "./dashboardReadOnlyDraftDiscard";

export class DashboardUnsyncedService {
  private readonly conflicts: DashboardSyncConflictService;
  private readonly notifications: DashboardSyncNotifications;
  private readonly queueActions: DashboardUnsyncedQueueActions;

  constructor(private readonly deps: {
    context: DashboardServiceContext;
    refreshTicketPresentation: () => void;
    loadComments: (ticketId: number) => Promise<void>;
    openTicketEditor?: (ticketId: number) => Promise<void>;
    revealCreatedTickets?: (ticketIds: readonly number[]) => Promise<void>;
    revealCreatedComment?: (
      ticketId: number,
      commentId: number,
      options?: { connectionScope?: string },
    ) => Promise<void>;
    getIssueDetail?: typeof getIssueDetail;
    syncEngine?: SyncEngine;
  }) {
    this.conflicts = new DashboardSyncConflictService(deps);
    this.notifications = new DashboardSyncNotifications(deps.context);
    this.queueActions = new DashboardUnsyncedQueueActions(deps, () => this.refreshUnsynced());
  }

  refreshUnsynced(): void {
    const { store } = this.deps.context;
    const { items, local } = this.collectPendingChanges();
    store.updateNested("unsynced", {
      totalCount: items.length + local.length,
      items,
      localChanges: local.map(item => item.row),
      abandonedItems: buildUnsyncedDashboardItems(true),
    });
  }

  revealPendingChanges(ids: readonly string[]): void {
    this.refreshUnsynced();
    const { store } = this.deps.context;
    const { connectionGeneration, unsynced } = store.getState();
    const scope = getCurrentConnectionScope();
    store.updateNested("unsynced", { reveal: {
      sequence: (unsynced.reveal?.sequence ?? 0) + 1,
      focusIds: ids.map(id => pendingChangeFocusId(scope, connectionGeneration, id)),
    } });
  }

  async openPendingChange(itemId: string): Promise<void> {
    const scope = getCurrentConnectionScope();
    const row = this.collectPendingChanges().local.find(item => item.row.id === itemId);
    if (!row || getCurrentConnectionScope() !== scope || !row.row.open) {
      throw new Error(vscode.l10n.t("This pending change is no longer available. Refresh Unsynced and try again."));
    }
    if (row.editor) { await vscode.window.showTextDocument(row.editor); }
    else { await openSnapshot(scope, row.change); }
  }

  discardPendingChange(itemId: string): Promise<"discarded" | "cancelled"> {
    return discardReadOnlyDraft(itemId, () => ({
      scope: getCurrentConnectionScope(),
      generation: this.deps.context.store.getState().connectionGeneration,
      local: this.collectPendingChanges().local,
    }));
  }

  private collectPendingChanges(): ReturnType<typeof buildUnsyncedPendingChanges> {
    return buildUnsyncedPendingChanges(getCurrentConnectionScope(),
      this.deps.context.store.getState().connectionGeneration, buildUnsyncedDashboardItems());
  }

  handleStartNewTicketEdit(requestId: string, ticketId: number): Promise<void> {
    return this.queueActions.handleStartNewTicketEdit(requestId, ticketId);
  }

  handleAbandonOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    return this.queueActions.handleAbandonOne(requestId, key);
  }

  handleForgetAbandoned(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    return this.queueActions.handleForgetAbandoned(requestId, key);
  }

  handleForgetAllAbandoned(requestId: string): Promise<void> {
    return this.queueActions.handleForgetAllAbandoned(requestId);
  }

  handleDiscardOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    return this.queueActions.handleDiscardOne(requestId, key);
  }

  async handleSyncOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    if (key.kind === "comment" && key.ticketId === undefined) {
      this.deps.context.notifyError(requestId, vscode.l10n.t("Invalid comment sync key."));
      return;
    }
    this.deps.context.notifyOperationStarted(requestId, vscode.l10n.t("Syncing…"));
    const result = await this.syncOne(key);
    if (result?.status === "conflict") {
      const status = await this.conflicts.resolveConflictInEditor(key, result);
      if (status) {
        await this.refreshAfterConflict(key, status);
        this.notifications.notifySyncStatusResult(requestId, status);
        return;
      }
    }
    const createdTicketRevealed =
      result?.kind === "newTicket" &&
      result.status === "success" &&
      typeof result.id === "number" &&
      result.id > 0 &&
      Boolean(this.deps.revealCreatedTickets);
    const createdCommentRevealed =
      key.kind === "comment" &&
      key.commentId === undefined &&
      result?.status === "success" &&
      typeof result.id === "number" &&
      result.id > 0 &&
      Boolean(this.deps.revealCreatedComment);
    this.notifications.notifySyncOneResult(requestId, result, {
      skipRefresh: createdTicketRevealed || createdCommentRevealed,
    });
  }

  async handleSyncSelectedComment(
    requestId: string,
    target: { ticketId: number; commentId?: number; documentUri?: string },
  ): Promise<void> {
    const scope = getCurrentConnectionScope();
    const queue = getOfflineSyncQueue(scope);
    const queuedEntry = queue.comments.find((entry) => {
      if (entry.ticketId !== target.ticketId || isAbandoned(entry)) {
        return false;
      }
      if (target.commentId !== undefined) {
        return entry.commentId === target.commentId;
      }
      return Boolean(
        target.documentUri &&
          entry.commentId === undefined &&
          sameDocumentIdentity(entry.documentUri, target.documentUri),
      );
    });
    if (queuedEntry) {
      await this.handleSyncOne(requestId, {
        kind: "comment",
        ticketId: target.ticketId,
        operationId: queuedEntry.operationId,
        commentId: queuedEntry.commentId,
        documentUri: queuedEntry.documentUri,
      });
      return;
    }

    const openCommentRecord = getTicketEditors(target.ticketId, scope)
      .filter((record) => {
        if (target.commentId !== undefined) {
          return record.contentType === "comment" && record.commentId === target.commentId;
        }
        return Boolean(
          target.documentUri &&
            record.contentType === "commentDraft" &&
            sameDocumentIdentity(record.uri, target.documentUri),
        );
      })
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
    if (!openCommentRecord) {
      this.deps.context.notifySuccess(requestId, vscode.l10n.t("No unsynced changes to sync."));
      return;
    }

    this.deps.context.notifyOperationStarted(requestId, vscode.l10n.t("Syncing…"));
    const status = await vscode.commands.executeCommand<SyncStatus | undefined>(
      "redmine-client.syncOpenEditor",
      { uri: openCommentRecord.uri },
    );
    this.notifications.notifySyncStatusResult(requestId, status);
  }

  async handleSyncSelectedTicket(requestId: string, ticketId: number): Promise<void> {
    const keys = this.buildSelectedTicketSyncKeys(ticketId);
    if (keys.length === 0) {
      const openTicketRecord = getTicketEditors(ticketId)
        .filter((record) => record.contentType === "ticket")
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
      if (!openTicketRecord) {
        this.deps.context.notifySuccess(requestId, vscode.l10n.t("No unsynced changes to sync."));
        return;
      }
      this.deps.context.notifyOperationStarted(requestId, vscode.l10n.t("Syncing…"));
      const status = await vscode.commands.executeCommand<SyncStatus | undefined>(
        "redmine-client.syncOpenEditor",
        { uri: openTicketRecord.uri },
      );
      this.notifications.notifySyncStatusResult(requestId, status);
      return;
    }

    this.deps.context.notifyOperationStarted(requestId, vscode.l10n.t("Syncing…"));
    const results: Array<SyncUnsyncedFileResult | undefined> = [];
    let merged = 0;
    for (const key of keys) {
      const result = await this.syncOne(key);
      if (result?.status === "conflict") {
        const status = await this.conflicts.resolveConflictInEditor(key, result);
        if (status === "uploaded") {
          await this.refreshAfterConflict(key, status);
          results.push({ status: "success", kind: key.kind, id: key.kind === "ticket" ? key.ticketId : undefined });
          continue;
        }
        if (status === "noChange") {
          await this.refreshAfterConflict(key, status);
          results.push({ status: "no_change", kind: key.kind, id: key.kind === "ticket" ? key.ticketId : undefined });
          continue;
        }
        if (status === "merged") {
          merged++;
          await this.refreshAfterConflict(key, status);
          results.push({ status: "no_change", kind: key.kind, id: key.kind === "ticket" ? key.ticketId : undefined });
          continue;
        }
      }
      results.push(result);
      if (result?.status === "cancelled" || result?.status === "commit_unknown" || result?.status === "recovery_pending") {
        this.notifications.notifySyncOneResult(requestId, result);
        return;
      }
    }

    this.notifications.notifySelectedTicketResult(requestId, results, merged);
  }

  async handleReviewConflict(requestId: string, ticketId: number): Promise<void> {
    const status = await this.conflicts.reviewTicket(requestId, ticketId);
    if (!status) {
      return;
    }
    await this.refreshAfterConflict({ kind: "ticket", ticketId }, status);
    this.notifications.notifySyncStatusResult(requestId, status);
  }

  async handleSyncAll(requestId: string): Promise<void> {
    this.deps.context.notifyOperationStarted(requestId, vscode.l10n.t("Syncing all…"));
    const result = await runOfflineSync({
      suppressResultNotifications: true,
      ...(this.deps.syncEngine ? { createSyncEngine: () => this.deps.syncEngine! } : {}),
    });
    this.refreshUnsynced();
    const createdTicketIds = result.createdTicketIds;
    if (createdTicketIds && createdTicketIds.length > 0 && this.deps.revealCreatedTickets) {
      try {
        await this.deps.revealCreatedTickets(createdTicketIds);
      } catch {
        this.deps.refreshTicketPresentation();
      }
    } else if (
      result.createdComments &&
      result.createdComments.length > 0 &&
      this.deps.revealCreatedComment
    ) {
      this.deps.refreshTicketPresentation();
      const lastComment = result.createdComments[result.createdComments.length - 1];
      try {
        await this.deps.revealCreatedComment(lastComment.ticketId, lastComment.commentId);
      } catch {
      }
    } else {
      this.deps.context.onTicketsRefreshed();
      this.deps.refreshTicketPresentation();
    }
    this.notifications.notifySyncAllResult(requestId, result);
  }

  private buildSelectedTicketSyncKeys(ticketId: number): DashboardUnsyncedKey[] {
    const queue = getOfflineSyncQueue(getCurrentConnectionScope());
    const keys: DashboardUnsyncedKey[] = [];
    if (queue.tickets.has(ticketId) && !isAbandoned(queue.tickets.get(ticketId)!)) {
      keys.push({ kind: "ticket", ticketId });
    }
    for (const comment of queue.comments) {
      if (comment.ticketId !== ticketId || isAbandoned(comment)) {
        continue;
      }
      keys.push({
        kind: "comment",
        ticketId,
        operationId: comment.operationId,
        commentId: comment.commentId,
        documentUri: comment.documentUri,
      });
    }
    return keys;
  }

  private async syncOne(key: DashboardUnsyncedKey): Promise<SyncUnsyncedFileResult | undefined> {
    let syncKey: UnsyncedFileSyncKey | undefined;

    if (key.kind === "ticket" && key.ticketId !== undefined) {
      syncKey = { kind: "ticket", ticketId: key.ticketId };
    } else if (key.kind === "newTicket") {
      syncKey = { kind: "newTicket", queueId: key.queueId, documentUri: key.documentUri };
    } else if (key.kind === "comment" && key.ticketId !== undefined) {
      syncKey = {
        kind: "comment",
        ticketId: key.ticketId,
        operationId: key.operationId,
        commentId: key.commentId,
        documentUri: key.documentUri,
      };
    }

    if (!syncKey) {
      return undefined;
    }

    let createdTicketId: number | undefined;
    const result = await syncUnsyncedFile(
      { syncKey },
      {
        suppressResultNotifications: true,
        onTicketCreated: (ticketId) => {
          createdTicketId = ticketId;
        },
        createSyncEngine: this.deps.syncEngine
          ? () => this.deps.syncEngine!
          : undefined,
      },
    );
    this.refreshUnsynced();
    const resolvedCreatedId =
      createdTicketId ??
      (result?.kind === "newTicket" && result.status === "success" ? result.id : undefined);
    if (resolvedCreatedId !== undefined && resolvedCreatedId > 0 && this.deps.revealCreatedTickets) {
      try {
        await this.deps.revealCreatedTickets([resolvedCreatedId]);
      } catch {
        this.deps.refreshTicketPresentation();
      }
    } else {
      this.deps.refreshTicketPresentation();
    }
    await this.refreshSyncedComments(key, result);
    return result;
  }

  private async refreshAfterConflict(key: DashboardUnsyncedKey, status: SyncStatus): Promise<void> {
    if (status === "uploaded" || status === "noChange" || status === "merged") {
      this.refreshUnsynced();
      this.deps.refreshTicketPresentation();
      if (key.kind === "comment") {
        await this.deps.loadComments(key.ticketId);
      }
    }
  }

  private async refreshSyncedComments(
    key: DashboardUnsyncedKey,
    result: SyncUnsyncedFileResult | undefined,
  ): Promise<void> {
    if (
      key.kind !== "comment" ||
      !result ||
      (result.status !== "success" && result.status !== "no_change")
    ) {
      return;
    }
    if (
      key.commentId === undefined &&
      result.status === "success" &&
      typeof result.id === "number" &&
      result.id > 0 &&
      this.deps.revealCreatedComment
    ) {
      try {
        await this.deps.revealCreatedComment(key.ticketId, result.id);
        return;
      } catch {
      }
    }
    await this.deps.loadComments(key.ticketId);
  }
}
