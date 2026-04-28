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
import { rewriteDocumentWithRegisteredFields, RewriteDocumentDeps } from "../views/editorDocumentRewrite";
import { removeTicketEditorByUri } from "../views/ticketEditorRegistry";

export type SyncUnsyncedFileResult =
  | { status: "success"; kind: "ticket" | "newTicket" | "comment"; id?: number }
  | { status: "no_change"; kind: "ticket" | "newTicket" | "comment"; id?: number }
  | { status: "conflict"; kind: "ticket" | "newTicket" | "comment"; id?: number }
  | { status: "failed"; kind: "ticket" | "newTicket" | "comment"; message?: string };

export const syncUnsyncedFile = async (
  item: UnsyncedFileTreeItem,
  options: { onTicketCreated?: () => void; onSubjectUpdated?: (ticketId: number, subject: string) => void } = {},
  rewriteDeps: RewriteDocumentDeps = {},
): Promise<SyncUnsyncedFileResult> => {
  const { syncKey } = item;
  const queue = getOfflineSyncQueue();

  if (syncKey.kind === "ticket") {
    const update = queue.tickets.get(syncKey.ticketId);
    if (!update) {
      showWarning("対象のチケット更新がキューに見つかりません。");
      return { status: "failed", kind: "ticket", message: "対象のチケット更新がキューに見つかりません。" };
    }
    const result = await applyQueuedTicketUpdate({ update });
    if (result.status === "success") {
      removeOfflineTicketUpdate(syncKey.ticketId);
      options.onSubjectUpdated?.(syncKey.ticketId, update.subject);
      showInfo("チケット更新を同期しました。");
      return { status: "success", kind: "ticket", id: syncKey.ticketId };
    } else if (result.status === "no_change") {
      removeOfflineTicketUpdate(syncKey.ticketId);
      showInfo("チケット更新を同期しました。");
      return { status: "no_change", kind: "ticket", id: syncKey.ticketId };
    } else if (result.status === "conflict") {
      showWarning("リモートの変更と競合しています。ファイルを開いて確認してください。");
      return { status: "conflict", kind: "ticket", id: syncKey.ticketId };
    } else {
      showWarning(`同期に失敗しました: ${result.message ?? "不明なエラー"}`);
      return { status: "failed", kind: "ticket", message: result.message };
    }
  }

  if (syncKey.kind === "newTicket") {
    const entry = syncKey.documentUri
      ? queue.newTickets.find((t) => t.documentUri === syncKey.documentUri)
      : queue.newTickets[0];
    if (!entry) {
      showWarning("対象の新規チケットがキューに見つかりません。");
      return { status: "failed", kind: "newTicket", message: "対象の新規チケットがキューに見つかりません。" };
    }
    const { result, createdId } = await createTicketFromQueuedContent({
      content: entry.content,
      projectId: entry.projectId,
      baseDir: entry.baseDir,
    });
    if (result.status === "created" && createdId) {
      if (entry.documentUri) {
        const docUri = vscode.Uri.parse(entry.documentUri);
        removeTicketEditorByUri(docUri);
        const rewriteSuccess = await rewriteDocumentWithRegisteredFields(
          entry.documentUri,
          createdId,
          rewriteDeps,
        );
        const document = vscode.workspace.textDocuments.find(
          (doc) => doc.uri.toString() === entry.documentUri,
        );
        if (document) {
          registerTicketDocument(createdId, document, "ticket", entry.projectId);
        }
        if (rewriteSuccess) {
          removeOfflineNewTicket(entry.documentUri);
          options.onTicketCreated?.();
          showInfo("新規チケットを作成しました。");
          return { status: "success", kind: "newTicket", id: createdId };
        } else {
          showWarning("チケットは作成されましたが、ファイルの書き換えに失敗しました。再度同期してください。");
          return { status: "failed", kind: "newTicket", message: "ファイルの書き換えに失敗しました。" };
        }
      } else {
        options.onTicketCreated?.();
        showInfo("新規チケットを作成しました。");
        return { status: "success", kind: "newTicket", id: createdId };
      }
    } else {
      showWarning(`同期に失敗しました: ${result.message ?? "不明なエラー"}`);
      return { status: "failed", kind: "newTicket", message: result.message };
    }
  }

  if (syncKey.kind === "comment") {
    const update = syncKey.commentId !== undefined
      ? queue.comments.find((c) => c.commentId === syncKey.commentId)
      : queue.comments.find((c) => c.documentUri === syncKey.documentUri && c.commentId === undefined);
    if (!update) {
      showWarning("対象のコメント更新がキューに見つかりません。");
      return { status: "failed", kind: "comment", message: "対象のコメント更新がキューに見つかりません。" };
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
      const retStatus = result.status === "no_change" ? "no_change" : "success";
      return { status: retStatus, kind: "comment", id: result.commentId };
    } else if (result.status === "conflict") {
      showWarning("リモートの変更と競合しています。ファイルを開いて確認してください。");
      return { status: "conflict", kind: "comment", id: syncKey.commentId };
    } else {
      showWarning(`同期に失敗しました: ${result.message ?? "不明なエラー"}`);
      return { status: "failed", kind: "comment", message: result.message };
    }
  }

  return { status: "failed", kind: "ticket", message: "未知の同期キー種別" };
};
