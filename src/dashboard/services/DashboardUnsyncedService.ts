import type { DashboardServiceContext } from "./DashboardServiceContext";
import * as vscode from "vscode";
import { runOfflineSync } from "../../commands/offlineSync";
import type { OfflineSyncRunResult } from "../../commands/offlineSync";
import { syncUnsyncedFile } from "../../commands/syncUnsyncedFile";
import type { SyncUnsyncedFileResult } from "../../commands/syncUnsyncedFile";
import {
  getOfflineSyncQueue,
  removeOfflineCommentEntry,
  removeOfflineNewTicket,
  removeOfflineTicketUpdate,
} from "../../views/offlineSyncStore";
import { buildUnsyncedDashboardItems } from "../viewModels/unsyncedDashboardViewModel";
import type { DashboardUnsyncedKey } from "../dashboardProtocol";
import type { UnsyncedFileSyncKey } from "../../app/unsyncedTypes";
import { getTicketEditors } from "../../views/ticketEditorRegistry";
import type { SyncStatus } from "../../app/syncController";

export class DashboardUnsyncedService {
  constructor(private readonly deps: {
    context: DashboardServiceContext;
    refreshTicketPresentation: () => void;
  }) {}

  refreshUnsynced(): void {
    const items = buildUnsyncedDashboardItems();
    this.deps.context.store.updateNested("unsynced", {
      totalCount: items.length,
      items,
    });
  }

  async handleSyncOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    if (key.kind === "comment" && key.ticketId === undefined) {
      this.deps.context.notifyError(requestId, vscode.l10n.t("Invalid comment sync key."));
      return;
    }
    this.deps.context.notifyOperationStarted(requestId, vscode.l10n.t("Syncing…"));
    const result = await this.syncOne(key);
    this.notifySyncOneResult(requestId, result);
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
      this.notifySyncStatusResult(requestId, status);
      return;
    }

    this.deps.context.notifyOperationStarted(requestId, vscode.l10n.t("Syncing…"));
    const results: Array<SyncUnsyncedFileResult | undefined> = [];
    for (const key of keys) {
      results.push(await this.syncOne(key));
    }

    const failures = results.filter(
      (result) => !result || result.status === "failed" || result.status === "conflict",
    );
    if (failures.length > 0) {
      this.deps.context.notifyError(
        requestId,
        vscode.l10n.t("Partial sync failure. Succeeded: {0} / Failed: {1}.", results.length - failures.length, failures.length),
      );
      return;
    }

    const synced = results.filter((result) => result?.status === "success").length;
    if (synced === 0) {
      this.deps.context.notifySuccess(requestId, vscode.l10n.t("No changes."));
      return;
    }
    this.deps.context.onTicketsRefreshed();
    this.deps.context.notifySuccess(requestId, vscode.l10n.t("Sync completed. Synced: {0}.", synced));
  }

  async handleDiscardOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    const discardLabel = vscode.l10n.t("Discard");
    const confirmed = await vscode.window.showWarningMessage(
      vscode.l10n.t("This will discard the unsynced local changes. The ticket on the Redmine server will not be deleted."),
      { modal: true },
      discardLabel,
    );
    if (confirmed !== discardLabel) {
      return;
    }

    if (key.kind === "ticket") {
      removeOfflineTicketUpdate(key.ticketId);
    } else if (key.kind === "newTicket") {
      if (!key.documentUri) {
        this.deps.context.notifyError(requestId, vscode.l10n.t("Cannot identify the target new ticket draft."));
        return;
      }
      removeOfflineNewTicket({ documentUri: key.documentUri });
    } else if (key.kind === "comment") {
      removeOfflineCommentEntry({ commentId: key.commentId, documentUri: key.documentUri });
    }

    this.refreshUnsynced();
    this.deps.refreshTicketPresentation();
    this.deps.context.notifySuccess(requestId, vscode.l10n.t("Unsynced local changes discarded."));
  }

  async handleSyncAll(requestId: string): Promise<void> {
    this.deps.context.notifyOperationStarted(requestId, vscode.l10n.t("Syncing all…"));
    const result = await runOfflineSync();
    this.deps.context.onTicketsRefreshed();
    this.refreshUnsynced();
    this.deps.refreshTicketPresentation();
    this.notifySyncAllResult(requestId, result);
  }

  private notifySyncStatusResult(requestId: string, status: SyncStatus | undefined): void {
    switch (status) {
      case "uploaded":
        this.deps.context.onTicketsRefreshed();
        this.deps.context.notifySuccess(requestId, vscode.l10n.t("Sync completed."));
        break;
      case "noChange":
        this.deps.context.notifySuccess(requestId, vscode.l10n.t("No changes."));
        break;
      case "conflict":
        this.deps.context.notifyError(requestId, vscode.l10n.t("Conflicts with remote changes detected. Open the file to review."));
        break;
      case "failed":
      default:
        this.deps.context.notifyError(requestId, vscode.l10n.t("Sync failed. Check the VS Code notifications."));
        break;
    }
  }

  private buildSelectedTicketSyncKeys(ticketId: number): DashboardUnsyncedKey[] {
    const queue = getOfflineSyncQueue();
    const keys: DashboardUnsyncedKey[] = [];
    if (queue.tickets.has(ticketId)) {
      keys.push({ kind: "ticket", ticketId });
    }
    for (const comment of queue.comments) {
      if (comment.ticketId !== ticketId) {
        continue;
      }
      keys.push({
        kind: "comment",
        ticketId,
        commentId: comment.commentId,
        documentUri: comment.documentUri,
      });
    }
    return keys;
  }

  private notifySyncOneResult(requestId: string, result: SyncUnsyncedFileResult | undefined): void {
    if (!result) {
      this.deps.context.notifyError(requestId, vscode.l10n.t("Sync failed. Check the VS Code notifications."));
      return;
    }
    switch (result.status) {
      case "success":
        this.deps.context.onTicketsRefreshed();
        this.deps.context.notifySuccess(requestId, vscode.l10n.t("Sync completed."));
        break;
      case "no_change":
        this.deps.context.notifySuccess(requestId, vscode.l10n.t("No changes."));
        break;
      case "conflict":
        this.deps.context.notifyError(requestId, vscode.l10n.t("Conflicts with remote changes detected. Open the file to review."));
        break;
      case "failed":
        this.deps.context.notifyError(requestId, vscode.l10n.t("Sync failed. Check the VS Code notifications."));
        break;
    }
  }

  private notifySyncAllResult(requestId: string, result: OfflineSyncRunResult): void {
    switch (result.status) {
      case "nothing_to_sync":
        this.deps.context.notifySuccess(requestId, vscode.l10n.t("Nothing to sync."));
        break;
      case "success":
        this.deps.context.notifySuccess(requestId, vscode.l10n.t("All items synced. Synced: {0}.", result.synced));
        break;
      case "partial_failure":
        this.deps.context.notifyError(
          requestId,
          vscode.l10n.t("Partial sync failure. Succeeded: {0} / Failed: {1} / Conflicts: {2}.", result.synced, result.failed, result.conflicts),
        );
        break;
      case "cancelled":
        this.deps.context.notifyError(
          requestId,
          vscode.l10n.t("Sync cancelled. Succeeded: {0} / Incomplete: {1}.", result.synced, result.failed),
        );
        break;
      case "failed":
        this.deps.context.notifyError(requestId, vscode.l10n.t("Sync failed. Check the VS Code notifications."));
        break;
    }
  }

  private async syncOne(key: DashboardUnsyncedKey): Promise<SyncUnsyncedFileResult | undefined> {
    let syncKey: UnsyncedFileSyncKey | undefined;

    if (key.kind === "ticket" && key.ticketId !== undefined) {
      syncKey = { kind: "ticket", ticketId: key.ticketId };
    } else if (key.kind === "newTicket") {
      syncKey = { kind: "newTicket", documentUri: key.documentUri };
    } else if (key.kind === "comment" && key.ticketId !== undefined) {
      syncKey = {
        kind: "comment",
        ticketId: key.ticketId,
        commentId: key.commentId,
        documentUri: key.documentUri,
      };
    }

    if (!syncKey) {
      return undefined;
    }

    const result = await syncUnsyncedFile(
      { syncKey },
      { onTicketCreated: () => this.deps.context.onTicketsRefreshed() },
    );
    this.refreshUnsynced();
    this.deps.refreshTicketPresentation();
    return result;
  }
}
