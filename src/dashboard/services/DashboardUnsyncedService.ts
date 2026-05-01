import type { DashboardServiceContext } from "./DashboardServiceContext";
import * as vscode from "vscode";
import { runOfflineSync } from "../../commands/offlineSync";
import type { OfflineSyncRunResult } from "../../commands/offlineSync";
import { syncUnsyncedFile } from "../../commands/syncUnsyncedFile";
import type { SyncUnsyncedFileResult } from "../../commands/syncUnsyncedFile";
import {
  getOfflineSyncQueue,
  removeOfflineCommentEntry,
  removeOfflineNewTicket,
  removeOfflineTicketUpdate,
} from "../../views/offlineSyncStore";
import { buildUnsyncedDashboardItems } from "../viewModels/unsyncedDashboardViewModel";
import type { DashboardUnsyncedKey } from "../dashboardProtocol";
import type { UnsyncedFileSyncKey } from "../../views/unsyncedFilesView";
import { getTicketEditors } from "../../views/ticketEditorRegistry";
import type { SyncStatus } from "../../app/syncController";

export class DashboardUnsyncedService {
  constructor(private readonly deps: {
    context: DashboardServiceContext;
    refreshTicketPresentation: () => void;
  }) {}

  refreshUnsynced(): void {
    const items = buildUnsyncedDashboardItems();
    this.deps.context.store.updateNested("unsynced", {
      totalCount: items.length,
      items,
    });
  }

  async handleSyncOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    if (key.kind === "comment" && key.ticketId === undefined) {
      this.deps.context.notifyError(requestId, "コメント同期キーが不正です。");
      return;
    }
    this.deps.context.notifyOperationStarted(requestId, "同期中...");
    const result = await this.syncOne(key);
    this.notifySyncOneResult(requestId, result);
  }

  async handleSyncSelectedTicket(requestId: string, ticketId: number): Promise<void> {
    const keys = this.buildSelectedTicketSyncKeys(ticketId);
    if (keys.length === 0) {
      const openTicketRecord = getTicketEditors(ticketId)
        .filter((record) => record.contentType === "ticket")
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
      if (!openTicketRecord) {
        this.deps.context.notifySuccess(requestId, "同期する未同期変更はありません。");
        return;
      }
      this.deps.context.notifyOperationStarted(requestId, "同期中...");
      const status = await vscode.commands.executeCommand<SyncStatus | undefined>(
        "redmine-client.syncOpenEditor",
        { uri: openTicketRecord.uri },
      );
      this.notifySyncStatusResult(requestId, status);
      return;
    }

    this.deps.context.notifyOperationStarted(requestId, "同期中...");
    const results: Array<SyncUnsyncedFileResult | undefined> = [];
    for (const key of keys) {
      results.push(await this.syncOne(key));
    }

    const failures = results.filter(
      (result) => !result || result.status === "failed" || result.status === "conflict",
    );
    if (failures.length > 0) {
      this.deps.context.notifyError(
        requestId,
        `一部の同期に失敗しました。成功: ${results.length - failures.length}件 / 失敗: ${failures.length}件`,
      );
      return;
    }

    const synced = results.filter((result) => result?.status === "success").length;
    if (synced === 0) {
      this.deps.context.notifySuccess(requestId, "変更はありませんでした。");
      return;
    }
    this.deps.context.onTicketsRefreshed();
    this.deps.context.notifySuccess(requestId, `同期が完了しました。同期: ${synced}件`);
  }

  async handleDiscardOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      "この未同期のローカル変更を破棄します。Redmineサーバ上のチケットは削除されません。",
      { modal: true },
      "破棄",
    );
    if (confirmed !== "破棄") {
      return;
    }

    if (key.kind === "ticket") {
      removeOfflineTicketUpdate(key.ticketId);
    } else if (key.kind === "newTicket") {
      if (!key.documentUri) {
        this.deps.context.notifyError(requestId, "対象の新規チケット下書きを特定できません。");
        return;
      }
      removeOfflineNewTicket(key.documentUri);
    } else if (key.kind === "comment") {
      removeOfflineCommentEntry({ commentId: key.commentId, documentUri: key.documentUri });
    }

    this.refreshUnsynced();
    this.deps.refreshTicketPresentation();
    this.deps.context.notifySuccess(requestId, "未同期のローカル変更を破棄しました。");
  }

  async handleSyncAll(requestId: string): Promise<void> {
    this.deps.context.notifyOperationStarted(requestId, "全件同期中...");
    const result = await runOfflineSync();
    this.deps.context.onTicketsRefreshed();
    this.refreshUnsynced();
    this.deps.refreshTicketPresentation();
    this.notifySyncAllResult(requestId, result);
  }

  private notifySyncStatusResult(requestId: string, status: SyncStatus | undefined): void {
    switch (status) {
      case "uploaded":
        this.deps.context.onTicketsRefreshed();
        this.deps.context.notifySuccess(requestId, "同期が完了しました。");
        break;
      case "noChange":
        this.deps.context.notifySuccess(requestId, "変更はありませんでした。");
        break;
      case "conflict":
        this.deps.context.notifyError(requestId, "リモートの変更と競合しています。ファイルを開いて確認してください。");
        break;
      case "failed":
      default:
        this.deps.context.notifyError(requestId, "同期に失敗しました。VS Code の通知をご確認ください。");
        break;
    }
  }

  private buildSelectedTicketSyncKeys(ticketId: number): DashboardUnsyncedKey[] {
    const queue = getOfflineSyncQueue();
    const keys: DashboardUnsyncedKey[] = [];
    if (queue.tickets.has(ticketId)) {
      keys.push({ kind: "ticket", ticketId });
    }
    for (const comment of queue.comments) {
      if (comment.ticketId !== ticketId) {
        continue;
      }
      keys.push({
        kind: "comment",
        ticketId,
        commentId: comment.commentId,
        documentUri: comment.documentUri,
      });
    }
    return keys;
  }

  private notifySyncOneResult(requestId: string, result: SyncUnsyncedFileResult | undefined): void {
    if (!result) {
      this.deps.context.notifyError(requestId, "同期に失敗しました。VS Code の通知をご確認ください。");
      return;
    }
    switch (result.status) {
      case "success":
        this.deps.context.onTicketsRefreshed();
        this.deps.context.notifySuccess(requestId, "同期が完了しました。");
        break;
      case "no_change":
        this.deps.context.notifySuccess(requestId, "変更はありませんでした。");
        break;
      case "conflict":
        this.deps.context.notifyError(requestId, "リモートの変更と競合しています。ファイルを開いて確認してください。");
        break;
      case "failed":
        this.deps.context.notifyError(requestId, "同期に失敗しました。VS Code の通知をご確認ください。");
        break;
    }
  }

  private notifySyncAllResult(requestId: string, result: OfflineSyncRunResult): void {
    switch (result.status) {
      case "nothing_to_sync":
        this.deps.context.notifySuccess(requestId, "同期するものはありません。");
        break;
      case "success":
        this.deps.context.notifySuccess(requestId, `全件同期が完了しました。同期: ${result.synced}件`);
        break;
      case "partial_failure":
        this.deps.context.notifyError(
          requestId,
          `一部の同期に失敗しました。成功: ${result.synced}件 / 失敗: ${result.failed}件 / 競合: ${result.conflicts}件`,
        );
        break;
      case "cancelled":
        this.deps.context.notifyError(
          requestId,
          `同期をキャンセルしました。成功: ${result.synced}件 / 未完了: ${result.failed}件`,
        );
        break;
      case "failed":
        this.deps.context.notifyError(requestId, "同期に失敗しました。VS Code の通知をご確認ください。");
        break;
    }
  }

  private async syncOne(key: DashboardUnsyncedKey): Promise<SyncUnsyncedFileResult | undefined> {
    let syncKey: UnsyncedFileSyncKey | undefined;

    if (key.kind === "ticket" && key.ticketId !== undefined) {
      syncKey = { kind: "ticket", ticketId: key.ticketId };
    } else if (key.kind === "newTicket") {
      syncKey = { kind: "newTicket", documentUri: key.documentUri };
    } else if (key.kind === "comment" && key.ticketId !== undefined) {
      syncKey = {
        kind: "comment",
        ticketId: key.ticketId,
        commentId: key.commentId,
        documentUri: key.documentUri,
      };
    }

    if (!syncKey) {
      return undefined;
    }

    const result = await syncUnsyncedFile(
      { syncKey },
      { onTicketCreated: () => this.deps.context.onTicketsRefreshed() },
    );
    this.refreshUnsynced();
    this.deps.refreshTicketPresentation();
    return result;
  }
}
