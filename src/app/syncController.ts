import * as vscode from "vscode";
import { syncEditorToRedmine } from "../commands/syncToRedmine";
import { handleConflict, handleCommentConflict } from "../views/conflictResolver";
import { shouldRefreshComments } from "../views/commentSaveSync";
import { isSaveSyncSuppressed } from "../views/saveSyncSuppression";
import type { CommentsTreeProvider } from "../views/commentsView";
import type { TicketsTreeProvider } from "../views/ticketsView";
import type { UnsyncedFilesTreeProvider } from "../views/unsyncedFilesView";
import type { NotificationController } from "./notificationController";
import { performSyncOnSave } from "./saveSyncExecutor";
import { scheduleSave } from "./saveSyncQueue";

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
  ticketsProvider: TicketsTreeProvider;
  commentsProvider: CommentsTreeProvider;
  unsyncedFilesProvider: UnsyncedFilesTreeProvider;
  notifications: NotificationController;
  registerEditorDocument: (document: vscode.TextDocument) => void;
}

export interface SyncController {
  updateTicketListSubject: (ticketId: number, subject: string) => void;
  syncEditorAndNotify: (editor: vscode.TextEditor) => Promise<SyncStatus>;
  syncOnSave: (document: vscode.TextDocument) => void;
}

export const createSyncController = (deps: SyncControllerDeps): SyncController => {
  const { ticketsProvider, commentsProvider, unsyncedFilesProvider, notifications } = deps;

  const updateTicketListSubject = (ticketId: number, subject: string): void => {
    ticketsProvider.updateTicketSubject(ticketId, subject);
  };

  const syncEditorAndNotify = async (editor: vscode.TextEditor): Promise<SyncStatus> => {
    try {
      const syncResult = await syncEditorToRedmine(editor, {
        onSubjectUpdated: updateTicketListSubject,
        onTicketCreated: () => ticketsProvider.refresh(),
        onCommentsRefresh: (ticketId) => commentsProvider.refreshForTicket(ticketId),
      });
      if (!syncResult) {
        return "failed";
      }
      if (syncResult.kind === "ticket") {
        let result = syncResult.result;
        if (result.status === "conflict" && result.conflictContext) {
          result = await handleConflict(result, editor);
        }
        notifications.notifyTicketSaveResult(result);
        if (result.status === "created") {
          ticketsProvider.refresh();
        } else {
          ticketsProvider.notifyChange();
        }
        return toSyncStatus(result.status);
      } else {
        let result = syncResult.result;
        if (result.status === "conflict" && result.conflictContext) {
          result = await handleCommentConflict(result, editor);
        }
        notifications.notifyCommentSaveResult(result);
        if (shouldRefreshComments(result.status)) {
          commentsProvider.refreshForTicket(syncResult.ticketId);
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
      ticketsProvider,
      commentsProvider,
      unsyncedFilesProvider,
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
