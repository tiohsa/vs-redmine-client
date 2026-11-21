import * as vscode from "vscode";
import type { SyncStatus } from "../../app/syncController";
import type { SyncEngine } from "../../app/syncEngine";
import type { UnsyncedFileSyncKey } from "../../app/unsyncedTypes";
import { runOfflineSync } from "../../commands/offlineSync";
import { syncUnsyncedFile, type SyncUnsyncedFileResult } from "../../commands/syncUnsyncedFile";
import { getCurrentConnectionScope } from "../../config/connectionScope";
import type { getIssueDetail } from "../../redmine/issues";
import { getOfflineSyncQueue, isAbandoned } from "../../views/offlineSyncStore";
import { getTicketEditors } from "../../views/ticketEditorRegistry";
import type { DashboardUnsyncedKey } from "../dashboardProtocol";
import { buildUnsyncedDashboardItems } from "../viewModels/unsyncedDashboardViewModel";
import type { DashboardServiceContext } from "./DashboardServiceContext";
import { DashboardSyncConflictService } from "./DashboardSyncConflictService";
import { DashboardSyncNotifications } from "./DashboardSyncNotifications";
import { DashboardUnsyncedQueueActions } from "./DashboardUnsyncedQueueActions";

export class DashboardUnsyncedService {
  private readonly conflicts: DashboardSyncConflictService;
  private readonly notifications: DashboardSyncNotifications;
  private readonly queueActions: DashboardUnsyncedQueueActions;

  constructor(private readonly deps: {
    context: DashboardServiceContext;
    refreshTicketPresentation: () => void;
    loadComments: (ticketId: number) => Promise<void>;
    openTicketEditor?: (ticketId: number) => Promise<void>;
    getIssueDetail?: typeof getIssueDetail;
    syncEngine?: SyncEngine;
  }) {
    this.conflicts = new DashboardSyncConflictService(deps);
    this.notifications = new DashboardSyncNotifications(deps.context);
    this.queueActions = new DashboardUnsyncedQueueActions(deps, () => this.refreshUnsynced());
  }

  refreshUnsynced(): void {
    const items = buildUnsyncedDashboardItems();
    this.deps.context.store.updateNested("unsynced", {
      totalCount: items.length,
      items,
      abandonedItems: buildUnsyncedDashboardItems(true),
    });
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
    this.notifications.notifySyncOneResult(requestId, result);
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
    this.deps.context.onTicketsRefreshed();
    this.refreshUnsynced();
    this.deps.refreshTicketPresentation();
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

    const result = await syncUnsyncedFile(
      { syncKey },
      {
        suppressResultNotifications: true,
        onTicketCreated: () => this.deps.context.onTicketsRefreshed(),
        createSyncEngine: this.deps.syncEngine
          ? () => this.deps.syncEngine!
          : undefined,
      },
    );
    this.refreshUnsynced();
    this.deps.refreshTicketPresentation();
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
    await this.deps.loadComments(key.ticketId);
  }
}
