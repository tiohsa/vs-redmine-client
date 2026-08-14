import * as vscode from "vscode";
import { showError, showInfo, showWarning } from "../utils/notifications";
import type {
  CommentPresentationPort,
  TicketPresentationPort,
  UnsyncedPresentationPort,
} from "./presentationPorts";
import type { NotificationController } from "./notificationController";
import type { SyncOutcome } from "./ticketSync/syncOperationTypes";

export interface OutcomePresenterDeps {
  ticketsPresentation: TicketPresentationPort;
  commentsPresentation: CommentPresentationPort;
  unsyncedPresentation: UnsyncedPresentationPort;
  notifications?: NotificationController;
}

export class OutcomePresenter {
  public constructor(private readonly deps: OutcomePresenterDeps) {}

  public present(outcome: SyncOutcome, context: { ticketId?: number; commentId?: number; isAuto?: boolean } = {}): void {
    const { ticketsPresentation, commentsPresentation, unsyncedPresentation, notifications } = this.deps;

    switch (outcome.kind) {
      case "completed": {
        unsyncedPresentation.refresh();
        const ticketId = outcome.ticketId || context.ticketId;
        if (ticketId) {
          ticketsPresentation.notifyChange();
          commentsPresentation.refreshForTicket(ticketId);
        }
        if (!context.isAuto) {
          showInfo(vscode.l10n.t("Sync completed successfully."));
        }
        break;
      }

      case "queued": {
        unsyncedPresentation.refresh();
        const ticketId = outcome.ticketId || context.ticketId;
        if (ticketId) {
          commentsPresentation.refreshForTicket(ticketId);
        }
        break;
      }

      case "no_change": {
        // サイレント (通知なし)
        break;
      }

      case "conflict": {
        unsyncedPresentation.refresh();
        const message = outcome.message ?? vscode.l10n.t("A conflict was detected while synchronizing.");
        if (notifications) {
          notifications.notifyTicketSaveResult({ status: "conflict", message });
        }
        showWarning(message);
        break;
      }

      case "commit_unknown": {
        unsyncedPresentation.refresh();
        const message = outcome.message || vscode.l10n.t("The sync request timed out. The remote status is unknown. Please reconcile before retrying.");
        if (notifications) {
          notifications.notifyTicketSaveResult({ status: "failed", message, remoteCommitUnknown: true });
        }
        showWarning(message);
        break;
      }

      case "remote_committed": {
        unsyncedPresentation.refresh();
        const ticketId = outcome.ticketId || context.ticketId;
        if (ticketId) {
          ticketsPresentation.notifyChange();
          commentsPresentation.refreshForTicket(ticketId);
        }
        const message = outcome.message || (
          outcome.pending === "remote_reconcile"
            ? vscode.l10n.t("Changes were committed remotely, but read-back reconciliation is pending.")
            : vscode.l10n.t("Changes were committed remotely, but local document finalization is pending.")
        );
        if (notifications) {
          notifications.notifyTicketSaveResult({ status: "failed", message });
        }
        showWarning(message);
        break;
      }

      case "failed_before_commit": {
        unsyncedPresentation.refresh();
        const message = outcome.error.message || vscode.l10n.t("Sync failed before remote commit.");
        if (notifications) {
          notifications.notifyTicketSaveResult({ status: "failed", message });
        }
        showError(message);
        break;
      }
    }
  }
}

export const createOutcomePresenter = (deps: OutcomePresenterDeps): OutcomePresenter =>
  new OutcomePresenter(deps);
