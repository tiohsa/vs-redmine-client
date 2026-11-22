import * as vscode from "vscode";
import type { NotificationController } from "./notificationController";
import type { TicketPresentationPort, UnsyncedPresentationPort } from "./presentationPorts";
import type { SyncEngineKey } from "./syncEngine";
import type { TicketSaveResult } from "../views/ticketSaveTypes";

export interface LocalTicketSaveDependencies {
  notifications: Pick<NotificationController, "notifyTicketSaveResult">;
  ticketsPresentation: Pick<TicketPresentationPort, "notifyChange">;
  unsyncedPresentation: Pick<UnsyncedPresentationPort, "refresh">;
  syncIfAuto: (key: SyncEngineKey) => Promise<void>;
  updateDraftStatusFromDocument: (document: vscode.TextDocument) => void;
  shouldAutoSync: boolean;
}

export async function finishNewTicketDocumentSave(
  document: vscode.TextDocument,
  result: TicketSaveResult,
  deps: Pick<LocalTicketSaveDependencies, "notifications" | "unsyncedPresentation" | "syncIfAuto">,
): Promise<void> {
  deps.notifications.notifyTicketSaveResult(result);
  if (result.status === "queued") {
    await deps.syncIfAuto({ kind: "newTicket", documentUri: document.uri.toString() });
  } else {
    deps.unsyncedPresentation.refresh();
  }
}

export async function finishExistingTicketDocumentSave(
  document: vscode.TextDocument,
  savedContent: string,
  ticketId: number,
  status: "queued" | "no_change",
  deps: LocalTicketSaveDependencies,
): Promise<void> {
  const refreshTicket = (): void => {
    if (document.getText() !== savedContent) {
      deps.updateDraftStatusFromDocument(document);
    }
    deps.ticketsPresentation.notifyChange();
  };
  refreshTicket();

  if (status === "queued" && deps.shouldAutoSync) {
    await deps.syncIfAuto({ kind: "ticket", ticketId });
    refreshTicket();
  }
}
