import * as vscode from "vscode";
import type { SyncStatus } from "../../app/syncController";
import type { OfflineSyncRunResult } from "../../commands/offlineSync";
import type { SyncUnsyncedFileResult } from "../../commands/syncUnsyncedFile";
import type { DashboardServiceContext } from "./DashboardServiceContext";

export class DashboardSyncNotifications {
  constructor(private readonly context: Pick<DashboardServiceContext,
    "notifySuccess" | "notifyError" | "onTicketsRefreshed">) {}

  notifySyncStatusResult(requestId: string, status: SyncStatus | undefined): void {
    switch (status) {
      case "uploaded":
        this.context.onTicketsRefreshed();
        this.context.notifySuccess(requestId, vscode.l10n.t("Sync completed."));
        break;
      case "merged":
        this.context.notifySuccess(requestId, vscode.l10n.t("Merge result is ready. Review and save to sync."));
        break;
      case "noChange":
        this.context.notifySuccess(requestId, vscode.l10n.t("No changes."));
        break;
      case "conflict":
        this.context.notifyError(requestId, vscode.l10n.t("Conflicts with remote changes detected. Open the file to review."));
        break;
      case "failed":
      default:
        this.context.notifyError(requestId, vscode.l10n.t("Sync failed. Check the VS Code notifications."));
        break;
    }
  }

  notifySyncOneResult(
    requestId: string,
    result: SyncUnsyncedFileResult | undefined,
    options?: { skipRefresh?: boolean },
  ): void {
    if (!result) {
      this.context.notifyError(requestId, vscode.l10n.t("Sync failed. Check the VS Code notifications."));
      return;
    }
    switch (result.status) {
      case "success":
        if (!options?.skipRefresh) {
          this.context.onTicketsRefreshed();
        }
        this.context.notifySuccess(requestId, result.hasRemainingChanges
          ? vscode.l10n.t("This sync completed. Later local changes are still waiting to sync.")
          : vscode.l10n.t("Sync completed."), result.hasRemainingChanges ? "info" : "success");
        break;
      case "no_change":
        this.context.notifySuccess(requestId, result.hasRemainingChanges
          ? vscode.l10n.t("This sync completed. Later local changes are still waiting to sync.")
          : vscode.l10n.t("No changes."), "info");
        break;
      case "queued":
        this.context.notifySuccess(requestId, vscode.l10n.t("Recovery completed. The item is queued for synchronization."));
        break;
      case "conflict":
        this.context.notifyError(requestId, vscode.l10n.t("Conflicts with remote changes detected. Open the file to review."));
        break;
      case "cancelled":
        this.context.notifySuccess(requestId, vscode.l10n.t("Recovery cancelled. The saved synchronization state was retained."), "info");
        break;
      case "commit_unknown":
      case "recovery_pending":
        this.context.notifySuccess(requestId, result.message, "warning");
        break;
      case "failed":
        this.context.notifyError(requestId, result.message ?? vscode.l10n.t("Sync failed. Check the VS Code notifications."));
        break;
    }
  }

  notifySyncAllResult(requestId: string, result: OfflineSyncRunResult): void {
    const diagnostics = result.newTicketDiagnostics?.join(" ");
    const suffix = diagnostics ? ` ${diagnostics}` : "";
    switch (result.status) {
      case "nothing_to_sync":
        this.context.notifySuccess(requestId, vscode.l10n.t("Nothing to sync."));
        break;
      case "success":
        this.context.notifySuccess(requestId, result.remainingChanges
          ? vscode.l10n.t("Sync completed. Synced: {0}; local changes remaining: {1}.", result.synced, result.remainingChanges)
          : vscode.l10n.t("All items synced. Synced: {0}.", result.synced), result.remainingChanges ? "info" : "success");
        break;
      case "recovery_pending":
        this.context.notifySuccess(requestId, vscode.l10n.t("Sync paused for recovery. Synced: {0}; incomplete: {1}. Review the unsynced items.", result.synced, result.failed) + suffix, "warning");
        break;
      case "partial_failure":
        this.context.notifyError(
          requestId,
          vscode.l10n.t("Partial sync failure. Succeeded: {0} / Failed: {1} / Conflicts: {2}.", result.synced, result.failed, result.conflicts) + suffix,
        );
        break;
      case "cancelled":
        this.context.notifySuccess(
          requestId,
          vscode.l10n.t("Sync cancelled. Succeeded: {0} / Incomplete: {1}.", result.synced, result.failed) + suffix,
          "info",
        );
        break;
      case "failed":
        this.context.notifyError(requestId, diagnostics
          ? vscode.l10n.t("Sync failed: {0}", diagnostics)
          : vscode.l10n.t("Sync failed. Check the VS Code notifications."));
        break;
    }
  }

  notifySelectedTicketResult(
    requestId: string,
    results: readonly (SyncUnsyncedFileResult | undefined)[],
    merged: number,
  ): void {
    const failures = results.filter(
      (result) => !result || result.status === "failed" || result.status === "conflict",
    );
    if (failures.length > 0) {
      this.context.notifyError(
        requestId,
        vscode.l10n.t("Partial sync failure. Succeeded: {0} / Failed: {1}.", results.length - failures.length, failures.length),
      );
      return;
    }

    const synced = results.filter((result) => result?.status === "success").length;
    const queued = results.filter((result) => result?.status === "queued" ||
      ((result?.status === "success" || result?.status === "no_change") && result.hasRemainingChanges)).length;
    if (synced === 0) {
      this.context.notifySuccess(
        requestId,
        merged > 0
          ? vscode.l10n.t("Merge result is ready. Review and save to sync.")
          : queued > 0
          ? vscode.l10n.t("Recovery completed. The item is queued for synchronization.")
          : vscode.l10n.t("No changes."),
      );
      return;
    }
    this.context.onTicketsRefreshed();
    this.context.notifySuccess(
      requestId,
      queued > 0
        ? vscode.l10n.t("Sync completed. Synced: {0}; recovery queued: {1}.", synced, queued)
        : vscode.l10n.t("Sync completed. Synced: {0}.", synced),
    );
  }
}
