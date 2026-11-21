import * as vscode from "vscode";
import { getCurrentConnectionScope } from "../../config/connectionScope";
import { runWithConnectionScope } from "../../redmine/client";
import { getIssueDetail } from "../../redmine/issues";
import {
  beginFreshTicketEdit,
  commitOfflineAbandonAsync,
  commitOfflineDiscardAsync,
  commitOfflineForgetAbandonedAsync,
  commitOfflineForgetAllAbandonedAsync,
  getOfflineSyncQueue,
  isAbandoned,
  prepareOfflineAbandon,
  prepareOfflineDiscard,
  prepareOfflineForgetAbandoned,
  prepareOfflineForgetAllAbandoned,
} from "../../views/offlineSyncStore";
import { updateDraftAfterSave } from "../../views/ticketDraftStore";
import { showTicketPreview } from "../../views/ticketPreview";
import { metadataFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import type { DashboardUnsyncedKey } from "../dashboardProtocol";
import { buildUnsyncedDashboardItems } from "../viewModels/unsyncedDashboardViewModel";
import type { DashboardServiceContext } from "./DashboardServiceContext";

export class DashboardUnsyncedQueueActions {
  constructor(private readonly deps: {
    context: DashboardServiceContext;
    refreshTicketPresentation: () => void;
    getIssueDetail?: typeof getIssueDetail;
  }, private readonly refreshUnsynced: () => void) {}

  async handleStartNewTicketEdit(requestId: string, ticketId: number): Promise<void> {
    const scope = getCurrentConnectionScope();
    const queue = getOfflineSyncQueue(scope);
    if (queue.tickets.has(ticketId) || !(queue.abandonedTickets ?? []).some((item) => item.ticketId === ticketId)) {
      this.deps.context.notifyError(requestId, vscode.l10n.t("The abandoned item changed. Refresh and try again."));
      return;
    }
    this.deps.context.notifyOperationStarted(requestId, vscode.l10n.t("Loading the latest ticket…"));
    try {
      const detail = await runWithConnectionScope(scope, () => (this.deps.getIssueDetail ?? getIssueDetail)(ticketId));
      if (scope !== getCurrentConnectionScope()) {
        this.deps.context.notifyError(requestId, vscode.l10n.t("The connection changed. Try again."));
        return;
      }
      const current = getOfflineSyncQueue(scope);
      if (current.tickets.has(ticketId) || !(current.abandonedTickets ?? []).some((item) => item.ticketId === ticketId)) {
        this.deps.context.notifyError(requestId, vscode.l10n.t("The abandoned item changed. Refresh and try again."));
        return;
      }
      const ticket = detail.ticket;
      const editor = await showTicketPreview(ticket, { kind: "extra", freshStart: true });
      if (scope !== getCurrentConnectionScope()) {
        this.deps.context.notifyError(requestId, vscode.l10n.t("The connection changed. Try again."));
        return;
      }
      if (getOfflineSyncQueue(scope).tickets.has(ticketId)) {
        this.deps.context.notifyError(requestId, vscode.l10n.t("The abandoned item changed. Refresh and try again."));
        return;
      }
      const authorization = await beginFreshTicketEdit(ticketId, editor.document.uri.toString(), scope);
      if (!authorization) {
        this.deps.context.notifyError(requestId, vscode.l10n.t("The abandoned item changed. Refresh and try again."));
        return;
      }
      updateDraftAfterSave(ticketId, ticket.subject, ticket.description ?? "",
        metadataFromTicket(ticket), ticket.updatedAt, scope);
      this.deps.refreshTicketPresentation();
      this.deps.context.notifySuccess(requestId, vscode.l10n.t("Latest ticket loaded. Start a new edit in the opened editor."));
    } catch (error) {
      this.deps.context.notifyError(requestId, error instanceof Error ? error.message : vscode.l10n.t("Could not load the ticket."));
    }
  }

  async handleAbandonOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    const scope = getCurrentConnectionScope();
    const plan = prepareOfflineAbandon(key, scope);
    if (!plan.expectation || isAbandoned(plan.expectation)) {
      this.deps.context.notifyError(requestId, vscode.l10n.t("The unsynced item changed. Refresh and try again."));
      return;
    }
    const target = buildUnsyncedDashboardItems().find((item) =>
      JSON.stringify(item.key) === JSON.stringify(key));
    const label = target?.label ?? vscode.l10n.t("Unsynced item");
    const laterChanges = plan.expectation.nextIntent !== undefined
      ? vscode.l10n.t("Later edits will also remain in the retained record and will not be synced automatically.")
      : vscode.l10n.t("There are no later queued edits.");
    const confirm = vscode.l10n.t("Abandon sync and exclude");
    const selected = await vscode.window.showWarningMessage(
      vscode.l10n.t("Abandon sync for this item?"),
      {
        modal: true,
        detail: `${vscode.l10n.t("Connection: {0}", scope)}\n${vscode.l10n.t("Target: {0}", label)}\n${laterChanges}\n\n${vscode.l10n.t("This item will be removed from the unsynced list and future sync runs. Changes already applied to Redmine will not be undone. An unknown remote outcome will remain unknown. The local Markdown file and processing record will be retained.")}`,
      },
      confirm,
    );
    if (selected !== confirm) {
      this.deps.context.notifySuccess(requestId, vscode.l10n.t("Operation cancelled. Saved changes were retained."), "info");
      return;
    }
    const result = await commitOfflineAbandonAsync(plan);
    this.refreshUnsynced();
    this.deps.refreshTicketPresentation();
    if (result === "abandoned") {
      this.deps.context.notifySuccess(requestId, vscode.l10n.t("Sync abandoned. The processing record was retained."));
    } else {
      this.deps.context.notifyError(requestId, result === "busy"
        ? vscode.l10n.t("This item is being synced. Wait for the current operation to finish and try again.")
        : result === "persistence_failed"
          ? vscode.l10n.t("Could not save the abandoned state. The item remains available for sync.")
          : vscode.l10n.t("The unsynced item changed. Refresh and try again."));
    }
  }

  async handleForgetAbandoned(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    const scope = getCurrentConnectionScope();
    const plan = prepareOfflineForgetAbandoned(key, scope);
    if (!plan.expectation || !isAbandoned(plan.expectation)) {
      this.refreshUnsynced();
      this.deps.context.notifyError(requestId, vscode.l10n.t("The abandoned item changed. Refresh and try again."));
      return;
    }
    const label = buildUnsyncedDashboardItems(true).find((item) =>
      JSON.stringify(item.key) === JSON.stringify(key))?.label ?? vscode.l10n.t("Unsynced item");
    const removeLabel = vscode.l10n.t("Delete retained record");
    const selected = await vscode.window.showWarningMessage(
      vscode.l10n.t("Delete this abandoned sync record permanently?"),
      {
        modal: true,
        detail: `${vscode.l10n.t("Connection: {0}", scope)}\n${vscode.l10n.t("Target: {0}", label)}\n${vscode.l10n.t("The local processing record will be deleted. The local Markdown file and any changes already applied to Redmine will remain.")}`,
      },
      removeLabel,
    );
    if (selected !== removeLabel) {
      this.deps.context.notifySuccess(requestId, vscode.l10n.t("Operation cancelled. Saved changes were retained."), "info");
      return;
    }
    const result = await commitOfflineForgetAbandonedAsync(plan);
    this.refreshUnsynced();
    this.deps.refreshTicketPresentation();
    if (result === "removed") {
      this.deps.context.notifySuccess(requestId, vscode.l10n.t("Abandoned sync record deleted."));
    } else {
      this.deps.context.notifyError(requestId, result === "busy"
        ? vscode.l10n.t("This item is being synced. Wait for the current operation to finish and try again.")
        : vscode.l10n.t("The abandoned item changed. Refresh and try again."));
    }
  }

  async handleForgetAllAbandoned(requestId: string): Promise<void> {
    const scope = getCurrentConnectionScope();
    const plan = prepareOfflineForgetAllAbandoned(scope);
    if (!plan.items.length) {
      this.refreshUnsynced();
      this.deps.context.notifySuccess(requestId, vscode.l10n.t("No abandoned sync records to delete."), "info");
      return;
    }
    const removeLabel = vscode.l10n.t("Delete all abandoned records");
    const selected = await vscode.window.showWarningMessage(
      vscode.l10n.t("Permanently delete {0} abandoned sync records?", plan.items.length),
      { modal: true, detail: `${vscode.l10n.t("Connection: {0}", scope)}\n${vscode.l10n.t("The local processing record will be deleted. The local Markdown file and any changes already applied to Redmine will remain.")}` },
      removeLabel,
    );
    if (selected !== removeLabel) {
      this.deps.context.notifySuccess(requestId, vscode.l10n.t("Operation cancelled. Saved changes were retained."), "info");
      return;
    }
    if (getCurrentConnectionScope() !== scope) {
      this.deps.context.notifyError(requestId, vscode.l10n.t("The connection changed. Try again."));
      return;
    }
    const result = await commitOfflineForgetAllAbandonedAsync(plan);
    this.refreshUnsynced();
    this.deps.refreshTicketPresentation();
    if (result === "removed") {
      this.deps.context.notifySuccess(requestId, vscode.l10n.t("Deleted {0} abandoned sync records.", plan.items.length));
    } else {
      this.deps.context.notifyError(requestId, result === "busy"
        ? vscode.l10n.t("This item is being synced. Wait for the current operation to finish and try again.")
        : result === "persistence_failed"
          ? vscode.l10n.t("Could not delete the records. All records were retained.")
          : vscode.l10n.t("The abandoned records changed. Nothing was deleted. Refresh and try again."));
    }
  }

  async handleDiscardOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    const operationScope = getCurrentConnectionScope();
    if (key.kind === "newTicket" && !key.queueId && !key.documentUri) {
      this.deps.context.notifyError(requestId, vscode.l10n.t("Cannot identify the target new ticket draft."));
      return;
    }
    const plan = prepareOfflineDiscard(key, operationScope);
    if (plan.mode !== "none") {
      const discardLaterChanges = plan.mode === "nextIntent";
      const discardLabel = discardLaterChanges
        ? vscode.l10n.t("Discard later changes")
        : vscode.l10n.t("Discard");
      const confirmed = await vscode.window.showWarningMessage(
        discardLaterChanges
          ? vscode.l10n.t("This will discard only the later local changes. The remote sync checkpoint will remain for review.")
          : vscode.l10n.t("This will discard the unsynced local changes. The ticket on the Redmine server will not be deleted."),
        { modal: true },
        discardLabel,
      );
      if (confirmed !== discardLabel) {
        this.deps.context.notifySuccess(requestId, vscode.l10n.t("Operation cancelled. Saved changes were retained."), "info");
        return;
      }
    }

    const result = await commitOfflineDiscardAsync(plan);

    switch (result) {
      case "recovery_required":
        this.deps.context.notifyError(
          requestId,
          vscode.l10n.t("This item has a remote sync checkpoint and must be resumed before it can be discarded."),
        );
        return;
      case "stale":
      case "not_found":
        this.refreshUnsynced();
        this.deps.refreshTicketPresentation();
        this.deps.context.notifyError(requestId, vscode.l10n.t("The unsynced item changed. Refresh and try again."));
        return;
      case "discarded":
      case "discarded_next":
        this.refreshUnsynced();
        this.deps.refreshTicketPresentation();
        this.deps.context.notifySuccess(requestId, result === "discarded_next"
          ? vscode.l10n.t("Later local changes discarded. The remote sync checkpoint was preserved.")
          : vscode.l10n.t("Unsynced local changes discarded."));
        return;
    }
  }
}
