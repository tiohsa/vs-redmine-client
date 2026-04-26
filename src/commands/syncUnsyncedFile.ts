import * as vscode from "vscode";
import {
  getOfflineSyncQueue,
  removeOfflineTicketUpdate,
  removeOfflineNewTicket,
  removeOfflineCommentEntry,
} from "../views/offlineSyncStore";
import { applyQueuedTicketUpdate, createTicketFromQueuedContent } from "../views/ticketSaveSync";
import { applyQueuedCommentUpdate, finalizeNewCommentDraftDocument } from "../views/commentSaveSync";
import { registerTicketDocument } from "../views/ticketEditorRegistry";
import { UnsyncedFileTreeItem } from "../views/unsyncedFilesView";
import { showInfo, showWarning } from "../utils/notifications";

export const syncUnsyncedFile = async (
  item: UnsyncedFileTreeItem,
  options: { onTicketCreated?: () => void; onSubjectUpdated?: (ticketId: number, subject: string) => void } = {},
): Promise<void> => {
  const { syncKey } = item;
  const queue = getOfflineSyncQueue();

  if (syncKey.kind === "ticket") {
    const update = queue.tickets.get(syncKey.ticketId);
    if (!update) {
      showWarning("対象のチケット更新がキューに見つかりません。");
      return;
    }
    const result = await applyQueuedTicketUpdate({ update });
    if (result.status === "success" || result.status === "no_change") {
      removeOfflineTicketUpdate(syncKey.ticketId);
      if (options.onSubjectUpdated && result.status === "success") {
        options.onSubjectUpdated(syncKey.ticketId, update.subject);
      }
      showInfo("チケット更新を同期しました。");
    } else if (result.status === "conflict") {
      showWarning("リモートの変更と競合しています。ファイルを開いて確認してください。");
    } else {
      showWarning(`同期に失敗しました: ${result.message ?? "不明なエラー"}`);
    }
    return;
  }

  if (syncKey.kind === "newTicket") {
    const entry = syncKey.documentUri
      ? queue.newTickets.find((t) => t.documentUri === syncKey.documentUri)
      : queue.newTickets[0];
    if (!entry) {
      showWarning("対象の新規チケットがキューに見つかりません。");
      return;
    }
    const { result, createdId } = await createTicketFromQueuedContent({
      content: entry.content,
      projectId: entry.projectId,
      baseDir: entry.baseDir,
    });
    if (result.status === "created" && createdId && entry.documentUri) {
      const document = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.toString() === entry.documentUri,
      );
      if (document) {
        registerTicketDocument(createdId, document, "ticket", entry.projectId);
      }
      removeOfflineNewTicket(entry.documentUri);
      options.onTicketCreated?.();
      showInfo("新規チケットを作成しました。");
    } else if (result.status === "created" && createdId) {
      if (entry.documentUri) {
        removeOfflineNewTicket(entry.documentUri);
      }
      options.onTicketCreated?.();
      showInfo("新規チケットを作成しました。");
    } else {
      showWarning(`同期に失敗しました: ${result.message ?? "不明なエラー"}`);
    }
    return;
  }

  if (syncKey.kind === "comment") {
    const update = syncKey.commentId !== undefined
      ? queue.comments.find((c) => c.commentId === syncKey.commentId)
      : queue.comments.find((c) => c.documentUri === syncKey.documentUri && c.commentId === undefined);
    if (!update) {
      showWarning("対象のコメント更新がキューに見つかりません。");
      return;
    }
    const result = await applyQueuedCommentUpdate({ update });
    if (
      result.status === "created" &&
      update.documentUri &&
      result.commentId &&
      result.projectId
    ) {
      const document = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.toString() === update.documentUri,
      );
      if (document) {
        finalizeNewCommentDraftDocument({
          document,
          ticketId: update.ticketId,
          projectId: result.projectId,
          commentId: result.commentId,
        });
      }
    }
    if (result.status === "success" || result.status === "no_change" || result.status === "created" || result.status === "created_unresolved") {
      removeOfflineCommentEntry({ commentId: syncKey.commentId, documentUri: syncKey.documentUri });
      showInfo("コメントを同期しました。");
    } else if (result.status === "conflict") {
      showWarning("リモートの変更と競合しています。ファイルを開いて確認してください。");
    } else {
      showWarning(`同期に失敗しました: ${result.message ?? "不明なエラー"}`);
    }
  }
};
