import * as vscode from "vscode";
import {
  getOfflineSyncQueue,
  removeOfflineTicketUpdate,
  removeOfflineNewTicket,
  updateOfflineNewTicket,
  removeOfflineCommentEntry,
} from "../views/offlineSyncStore";
import { applyQueuedTicketUpdate, createTicketFromQueuedContent } from "../views/ticketSaveSync";
import { applyQueuedCommentUpdate, finalizeNewCommentDraftDocument } from "../views/commentSaveSync";
import { updateCommentUpdateFileAfterSync } from "../views/commentUpdateFile";
import { registerTicketDocument } from "../views/ticketEditorRegistry";
import { UnsyncedFileSyncKey } from "../app/unsyncedTypes";
import { showInfo, showWarning } from "../utils/notifications";
import { rewriteDocumentWithRegisteredFields, RewriteDocumentDeps } from "../views/editorDocumentRewrite";
import { removeTicketEditorByUri } from "../views/ticketEditorRegistry";

export type SyncFailureReason =
  | "parse_error"
  | "api_error"
  | "validation_error"
  | "permission_denied"
  | "conflict"
  | "file_rewrite_failed"
  | "unknown";

export type SyncUnsyncedFileResult =
  | { status: "success"; kind: "ticket" | "newTicket" | "comment"; id?: number }
  | { status: "no_change"; kind: "ticket" | "newTicket" | "comment"; id?: number }
  | { status: "conflict"; kind: "ticket" | "newTicket" | "comment"; id?: number }
  | { status: "failed"; kind: "ticket" | "newTicket" | "comment"; message?: string; reason?: SyncFailureReason };

const normalizeNewTicketSyncFailureMessage = (message?: string): string => {
  if (message === "Ticket subject is required.") {
    return "件名が未入力です。Markdownファイルの「# 」行に件名を入力して保存してから同期してください。";
  }
  return message ?? "不明なエラー";
};

export const syncUnsyncedFile = async (
  item: { syncKey: UnsyncedFileSyncKey },
  options: { onTicketCreated?: () => void; onSubjectUpdated?: (ticketId: number, subject: string) => void } = {},
  rewriteDeps: RewriteDocumentDeps = {},
): Promise<SyncUnsyncedFileResult | undefined> => {
  const { syncKey } = item;
  const queue = getOfflineSyncQueue();

  if (syncKey.kind === "ticket") {
    const update = queue.tickets.get(syncKey.ticketId);
    if (!update) {
      showWarning("対象のチケット更新がキューに見つかりません。");
      return undefined;
    }
    const result = await applyQueuedTicketUpdate({ update });
    if (result.status === "success" || result.status === "no_change") {
      removeOfflineTicketUpdate(syncKey.ticketId);
      if (options.onSubjectUpdated && result.status === "success") {
        options.onSubjectUpdated(syncKey.ticketId, update.subject);
      }
      showInfo("チケット更新を同期しました。");
      return { status: result.status, kind: "ticket", id: syncKey.ticketId };
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
      return undefined;
    }

    // createdIssueId が既にある場合は作成済み → ファイル書き換えのみ再試行
    let resolvedId = entry.createdIssueId;

    if (!resolvedId) {
      const { result, createdId } = await createTicketFromQueuedContent({
        content: entry.content,
        projectId: entry.projectId,
        baseDir: entry.baseDir,
      });
      if (result.status !== "created" || !createdId) {
        const message = normalizeNewTicketSyncFailureMessage(result.message);
        showWarning(`同期に失敗しました: ${message}`);
        return { status: "failed", kind: "newTicket", message, reason: "api_error" };
      }
      resolvedId = createdId;
      // 作成成功を即座にキューに記録してから書き換えへ（重複作成防止）
      if (entry.documentUri) {
        updateOfflineNewTicket(entry.documentUri, { createdIssueId: resolvedId });
      }
    }

    if (entry.documentUri) {
      const docUri = vscode.Uri.parse(entry.documentUri);
      removeTicketEditorByUri(docUri);
      const rewriteSuccess = await rewriteDocumentWithRegisteredFields(
        entry.documentUri,
        resolvedId,
        rewriteDeps,
        entry.projectId,
      );
      const document = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.toString() === entry.documentUri,
      );
      if (document) {
        registerTicketDocument(resolvedId, document, "ticket", entry.projectId);
      }
      if (rewriteSuccess) {
        removeOfflineNewTicket(entry.documentUri);
        options.onTicketCreated?.();
        showInfo("新規チケットを作成しました。");
        return { status: "success", kind: "newTicket", id: resolvedId };
      } else {
        updateOfflineNewTicket(entry.documentUri, { status: "created_rewrite_failed" });
        showWarning(
          `Redmineチケットは作成済みです（#${resolvedId}）。` +
          "ファイルの書き換えに失敗しました。再度同期するとローカルファイルの変換のみ再試行します。",
        );
        return {
          status: "failed",
          kind: "newTicket",
          message: `ファイルの書き換えに失敗しました（チケット #${resolvedId} は作成済み）`,
          reason: "file_rewrite_failed",
        };
      }
    } else {
      options.onTicketCreated?.();
      showInfo("新規チケットを作成しました。");
      return { status: "success", kind: "newTicket", id: resolvedId };
    }
  }

  if (syncKey.kind === "comment") {
    const update = syncKey.commentId !== undefined
      ? queue.comments.find((c) => c.commentId === syncKey.commentId)
      : queue.comments.find((c) => c.documentUri === syncKey.documentUri && c.commentId === undefined);
    if (!update) {
      showWarning("対象のコメント更新がキューに見つかりません。");
      return undefined;
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
    if (result.status === "success" && update.sourceNotesHash && update.documentUri) {
      await updateCommentUpdateFileAfterSync(update.documentUri, update.body);
    }
    if (result.status === "success" || result.status === "no_change" || result.status === "created" || result.status === "created_unresolved") {
      removeOfflineCommentEntry({ commentId: syncKey.commentId, documentUri: syncKey.documentUri });
      showInfo("コメントを同期しました。");
      if (result.status === "no_change") {
        return { status: "no_change", kind: "comment" };
      }
      return { status: "success", kind: "comment", id: result.status === "created" ? result.commentId : undefined };
    } else if (result.status === "conflict") {
      showWarning("リモートの変更と競合しています。ファイルを開いて確認してください。");
      return { status: "conflict", kind: "comment" };
    } else {
      showWarning(`同期に失敗しました: ${result.message ?? "不明なエラー"}`);
      return { status: "failed", kind: "comment", message: result.message };
    }
  }

  return undefined;
};
