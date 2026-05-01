import { showError, showSuccess, showWarning } from "../utils/notifications";
import { getSaveNotification } from "../views/ticketSaveNotifications";
import { getCommentSaveNotification } from "../views/commentSaveNotifications";
import type { TicketSaveResult } from "../views/ticketSaveTypes";
import type { CommentSaveResult } from "../views/commentSaveTypes";
import type { UnsyncedPresentationPort } from "./presentationPorts";

export interface NotificationDeps {
  unsyncedPresentation: UnsyncedPresentationPort;
}

export interface NotificationController {
  notifyTicketSaveResult: (result: TicketSaveResult | undefined) => void;
  notifyCommentSaveResult: (result: CommentSaveResult | undefined) => void;
}

export const createNotificationController = (
  deps: NotificationDeps,
): NotificationController => {
  const notifyTicketSaveResult = (result: TicketSaveResult | undefined): void => {
    if (!result) {
      return;
    }
    const notification = getSaveNotification(result);
    if (!notification) {
      return;
    }
    if (notification.type === "info") {
      showSuccess(notification.message);
    } else if (notification.type === "warning") {
      showWarning(notification.message);
    } else {
      showError(notification.message);
    }
    deps.unsyncedPresentation.refresh();
  };

  const notifyCommentSaveResult = (result: CommentSaveResult | undefined): void => {
    if (!result) {
      return;
    }
    const notification = getCommentSaveNotification(result);
    if (!notification) {
      return;
    }
    if (notification.type === "info") {
      showSuccess(notification.message);
    } else if (notification.type === "warning") {
      showWarning(notification.message);
    } else {
      showError(notification.message);
    }
    deps.unsyncedPresentation.refresh();
  };

  return { notifyTicketSaveResult, notifyCommentSaveResult };
};
