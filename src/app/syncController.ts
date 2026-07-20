import * as vscode from "vscode";
import { syncEditorToRedmine } from "../commands/syncToRedmine";
import { handleConflict, handleCommentConflict } from "../views/conflictResolver";
import { shouldRefreshComments } from "../views/commentSaveSync";
import { isSaveSyncSuppressed } from "../views/saveSyncSuppression";
import type { NotificationController } from "./notificationController";
import { performSyncOnSave } from "./saveSyncExecutor";
import { scheduleSave } from "./saveSyncQueue";
import { getConnectionScopeForEditor } from "../views/ticketEditorRegistry";
import type {
  CommentPresentationPort,
  TicketPresentationPort,
  UnsyncedPresentationPort,
} from "./presentationPorts";

export type SyncStatus = "uploaded" | "noChange" | "conflict" | "failed";

const toSyncStatus = (s: string): SyncStatus =>
  s === "updated" || s === "created"
    ? "uploaded"
    : s === "noChange"
      ? "noChange"
      : s === "conflict"
        ? "conflict"
        : "failed";

export interface SyncControllerDeps {
  ticketsPresentation: TicketPresentationPort;
  commentsPresentation: CommentPresentationPort;
  unsyncedPresentation: UnsyncedPresentationPort;
  notifications: NotificationController;
  registerEditorDocument: (document: vscode.TextDocument) => void;
}

export interface SyncController {
  updateTicketListSubject: (ticketId: number, subject: string) => void;
  syncEditorAndNotify: (editor: vscode.TextEditor) => Promise<SyncStatus>;
  syncOnSave: (document: vscode.TextDocument) => void;
}

export const createSyncController = (deps: SyncControllerDeps): SyncController => {
  const { ticketsPresentation, commentsPresentation, unsyncedPresentation, notifications } = deps;

  const updateTicketListSubject = (ticketId: number, subject: string): void => {
    ticketsPresentation.updateTicketSubject(ticketId, subject);
  };

  const syncEditorAndNotify = async (editor: vscode.TextEditor): Promise<SyncStatus> => {
    try {
      const syncResult = await syncEditorToRedmine(editor, {
        onSubjectUpdated: updateTicketListSubject,
        onTicketCreated: () => ticketsPresentation.refresh(),
        onCommentsRefresh: (ticketId) => commentsPresentation.refreshForTicket(ticketId),
      });
      if (!syncResult) {
        return "failed";
      }
      if (syncResult.kind === "ticket") {
        let result = syncResult.result;
        if (result.status === "conflict" && result.conflictContext) {
          result = await handleConflict(
            result,
            editor,
            undefined,
            getConnectionScopeForEditor(editor),
          );
        }
        notifications.notifyTicketSaveResult(result);
        if (result.status === "created") {
          ticketsPresentation.refresh();
        } else {
          ticketsPresentation.notifyChange();
        }
        return toSyncStatus(result.status);
      } else {
        let result = syncResult.result;
        if (result.status === "conflict" && result.conflictContext) {
          result = await handleCommentConflict(
            result,
            editor,
            getConnectionScopeForEditor(editor),
          );
        }
        notifications.notifyCommentSaveResult(result);
        if (shouldRefreshComments(result.status)) {
          commentsPresentation.refreshForTicket(syncResult.ticketId);
        }
        return toSyncStatus(result.status);
      }
    } catch {
      return "failed";
    }
  };

  const handleSyncOnSave = async (document: vscode.TextDocument): Promise<void> => {
    const editor =
      vscode.window.visibleTextEditors.find((candidate) => candidate.document === document) ??
      (vscode.window.activeTextEditor?.document === document
        ? vscode.window.activeTextEditor
        : undefined);
    await performSyncOnSave(document, editor, {
      ticketsPresentation,
      commentsPresentation,
      unsyncedPresentation,
      notifications,
      updateTicketListSubject,
    });
  };

  const syncOnSave = (document: vscode.TextDocument): void => {
    // untitled→file 保存時に onDidOpenTextDocument より先に発火するケースがあるため明示的に登録する。
    deps.registerEditorDocument(document);
    const uriString = document.uri.toString();

    // suppressSaveSync が有効な場合はスキップ（applyEditorContent 後の自動保存など）
    if (isSaveSyncSuppressed(uriString)) {
      return;
    }

    scheduleSave(uriString, () => handleSyncOnSave(document));
  };

  return { updateTicketListSubject, syncEditorAndNotify, syncOnSave };
};
