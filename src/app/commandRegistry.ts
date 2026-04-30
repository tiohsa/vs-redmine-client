import * as vscode from "vscode";
import { addCommentFromList } from "../commands/addCommentFromList";
import { createTicketFromEditor } from "../commands/createTicket";
import { createChildTicketFromList } from "../commands/createChildTicketFromList";
import { createTicketFromList } from "../commands/createTicketFromList";
import { editComment } from "../commands/editComment";
import { focusTicketEditor } from "../commands/focusTicketEditor";
import { runOfflineSync } from "../commands/offlineSync";
import { syncUnsyncedFile } from "../commands/syncUnsyncedFile";
import { configureOfflineSyncMode } from "../commands/offlineSyncMode";
import {
  openCommentInBrowser,
  openProjectInBrowser,
  openTicketInBrowser,
} from "../commands/openInBrowser";
import { reloadCommentFromEditor } from "../commands/reloadComment";
import { reloadTicketFromEditor } from "../commands/reloadTicket";
import { searchTickets } from "../commands/searchTickets";
import { setApiKey, clearApiKey, getApiKeyStatus } from "../config/apiKeyStore";
import { showError, showSuccess } from "../utils/notifications";
import { CommentTreeItem, CommentsTreeProvider } from "../views/commentsView";
import {
  configureEditorDefaultField,
  EDITOR_DEFAULT_COMMANDS,
  resetEditorDefaults,
  TicketSettingsTreeProvider,
} from "../views/ticketSettingsView";
import {
  TicketTreeItem,
  TicketsTreeProvider,
  TICKET_SETTINGS_COMMANDS,
} from "../views/ticketsView";
import { getAllEditorRecords, isTicketEditor, getTicketIdForEditor, NEW_TICKET_DRAFT_ID } from "../views/ticketEditorRegistry";
import { showTicketPreview } from "../views/ticketPreview";
import { ProjectTreeItem, ProjectsTreeProvider } from "../views/projectsView";
import { UnsyncedFileTreeItem, UnsyncedFilesTreeProvider } from "../views/unsyncedFilesView";
import type { SyncController, SyncStatus } from "./syncController";

export interface CommandDeps {
  projectsProvider: ProjectsTreeProvider;
  ticketsProvider: TicketsTreeProvider;
  commentsProvider: CommentsTreeProvider;
  unsyncedFilesProvider: UnsyncedFilesTreeProvider;
  settingsProvider: TicketSettingsTreeProvider;
  sync: Pick<SyncController, "syncEditorAndNotify">;
}

export const registerCommands = (
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): void => {
  const {
    projectsProvider,
    ticketsProvider,
    commentsProvider,
    unsyncedFilesProvider,
    settingsProvider,
    sync,
  } = deps;

  // ── 基本コマンド ──────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.refreshProjects", () =>
      projectsProvider.refresh(),
    ),
    vscode.commands.registerCommand("redmine-client.refreshTickets", () =>
      ticketsProvider.refresh(),
    ),
    vscode.commands.registerCommand("redmine-client.refreshComments", () =>
      commentsProvider.refresh(),
    ),
    vscode.commands.registerCommand("redmine-client.loadMoreTickets", async () => {
      await ticketsProvider.loadMoreTickets();
    }),
  );

  // ── Offline Sync ──────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.runOfflineSync", async () => {
      await runOfflineSync();
      ticketsProvider.refresh();
      commentsProvider.refresh();
      unsyncedFilesProvider.refresh();
    }),
    vscode.commands.registerCommand("redmine-client.syncUnsyncedFile", async (item) => {
      if (!(item instanceof UnsyncedFileTreeItem)) {
        return;
      }
      await syncUnsyncedFile(item, { onTicketCreated: () => ticketsProvider.refresh() });
    }),
  );

  // ── 明示同期コマンド ──────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.syncToRedmine", async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && isTicketEditor(activeEditor)) {
        return sync.syncEditorAndNotify(activeEditor);
      }

      const fallbackRecord = getAllEditorRecords()
        .filter(
          (record) =>
            record.contentType === "ticket" ||
            record.contentType === "comment" ||
            record.contentType === "commentDraft",
        )
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
      if (!fallbackRecord) {
        return undefined;
      }

      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(fallbackRecord.uri));
      const editor =
        vscode.window.visibleTextEditors.find((e) => e.document === document) ??
        (await vscode.window.showTextDocument(document, { preview: false }));
      return sync.syncEditorAndNotify(editor);
    }),
    vscode.commands.registerCommand(
      "redmine-client.syncOpenEditor",
      async (item: { uri?: string } & { record?: { uri?: string } }) => {
        const uriStr = item?.uri ?? item?.record?.uri;
        if (!uriStr) {
          return undefined;
        }
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriStr));
        const editor =
          vscode.window.visibleTextEditors.find((e) => e.document === document) ??
          (await vscode.window.showTextDocument(document, { preview: false }));
        return sync.syncEditorAndNotify(editor);
      },
    ),
    vscode.commands.registerCommand("redmine-client.syncAllOpenEditors", async () => {
      const records = getAllEditorRecords().filter(
        (r) =>
          r.contentType === "ticket" ||
          r.contentType === "comment" ||
          r.contentType === "commentDraft",
      );
      if (records.length === 0) {
        return;
      }
      const counts: Record<SyncStatus, number> = {
        uploaded: 0,
        noChange: 0,
        conflict: 0,
        failed: 0,
      };
      for (const record of records) {
        try {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(record.uri));
          const editor =
            vscode.window.visibleTextEditors.find((e) => e.document === document) ??
            (await vscode.window.showTextDocument(document, { preview: false }));
          const status = await sync.syncEditorAndNotify(editor);
          counts[status]++;
        } catch {
          counts.failed++;
        }
      }
      const parts: string[] = [];
      if (counts.uploaded > 0) { parts.push(`Uploaded ${counts.uploaded}`); }
      if (counts.noChange > 0) { parts.push(`No change: ${counts.noChange}`); }
      if (counts.failed > 0) { parts.push(`Failed: ${counts.failed}`); }
      if (counts.conflict > 0) { parts.push(`Conflict: ${counts.conflict}`); }
      showSuccess(parts.join(". ") + ".");
      unsyncedFilesProvider.refresh();
    }),
  );

  // ── チケット操作 ──────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.searchTickets", async () => {
      await searchTickets(ticketsProvider, commentsProvider);
    }),
    vscode.commands.registerCommand("redmine-client.focusTicketEditor", async (input) => {
      const payload = input as { ticketId?: number; uri?: string } | number | undefined;
      const ticketId = typeof payload === "number" ? payload : payload?.ticketId;
      if (!payload || (!ticketId && !(payload as { uri?: string })?.uri)) {
        showError("Select an open ticket to focus.");
        return;
      }
      await focusTicketEditor(payload);
      if (ticketId && ticketId !== NEW_TICKET_DRAFT_ID) {
        commentsProvider.setTicketId(ticketId);
      }
    }),
    vscode.commands.registerCommand("redmine-client.revealActiveTicket", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isTicketEditor(editor)) {
        showError("Open a ticket editor to focus its ticket.");
        return;
      }
      const ticketId = getTicketIdForEditor(editor);
      if (!ticketId || ticketId === NEW_TICKET_DRAFT_ID) {
        showError("New ticket drafts are not listed in the ticket tree.");
        return;
      }
      // Dashboard 移行後: チケットIDを通知するのみ（TreeView reveal は不要）
      showSuccess(`Ticket #${ticketId} is active in the editor.`);
    }),
    vscode.commands.registerCommand("redmine-client.reloadTicket", async () => {
      await reloadTicketFromEditor();
    }),
    vscode.commands.registerCommand("redmine-client.toggleRelevantTickets", () => {
      ticketsProvider.toggleRelevantView();
    }),
    vscode.commands.registerCommand("redmine-client.createTicket", async () => {
      await createTicketFromEditor();
    }),
    vscode.commands.registerCommand("redmine-client.createTicketFromList", async () => {
      await createTicketFromList();
    }),
    vscode.commands.registerCommand(
      "redmine-client.createChildTicketFromList",
      async (item) => {
        await createChildTicketFromList(item as TicketTreeItem | undefined);
      },
    ),
  );

  // ── プロジェクト操作 ──────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "redmine-client.reloadProject",
      async (item?: ProjectTreeItem) => {
        if (item instanceof ProjectTreeItem) {
          projectsProvider.refresh();
        }
      },
    ),
    vscode.commands.registerCommand("redmine-client.collapseAllProjects", () => {
      // Dashboard 移行後: TreeView は存在しないため no-op
    }),
    vscode.commands.registerCommand("redmine-client.collapseAllTickets", () => {
      // Dashboard 移行後: TreeView は存在しないため no-op
    }),
    vscode.commands.registerCommand("redmine-client.selectProject", async () => {
      const projectId = await vscode.window.showInputBox({
        prompt: "Enter Redmine project ID",
        placeHolder: "e.g. 123",
      });
      if (!projectId) {
        return;
      }
      const numericId = Number(projectId);
      if (Number.isNaN(numericId)) {
        vscode.window.showErrorMessage("Project ID must be a number.");
        return;
      }
      ticketsProvider.setSelectedProjectId(numericId);
      ticketsProvider.refresh();
    }),
    vscode.commands.registerCommand("redmine-client.toggleChildProjects", async () => {
      const config = vscode.workspace.getConfiguration("redmine-client");
      const current = config.get<boolean>("includeChildProjects", false);
      await config.update("includeChildProjects", !current, vscode.ConfigurationTarget.Global);
      ticketsProvider.refresh();
    }),
  );

  // ── コメント操作 ──────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.reloadComment", async () => {
      await reloadCommentFromEditor();
    }),
    vscode.commands.registerCommand(
      "redmine-client.editComment",
      async (item?: CommentTreeItem) => {
        if (!(item instanceof CommentTreeItem)) {
          vscode.window.showErrorMessage("Dashboard からコメントを選択して編集してください。");
          return;
        }
        await editComment(item.comment);
      },
    ),
    vscode.commands.registerCommand("redmine-client.addComment", async () => {
      vscode.window.showErrorMessage("Dashboard からチケットを選択してコメントを追加してください。");
    }),
    vscode.commands.registerCommand("redmine-client.addCommentFromComments", async () => {
      const ticketId = commentsProvider.getTicketId();
      await addCommentFromList(ticketId);
    }),
  );

  // ── チケット/コメントプレビュー ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "redmine-client.openTicketPreview",
      async (item?: TicketTreeItem) => {
        if (!(item instanceof TicketTreeItem)) {
          vscode.window.showErrorMessage("Dashboard からチケットを選択してください。");
          return;
        }
        commentsProvider.setTicketId(item.ticket.id);
        await showTicketPreview(item.ticket);
      },
    ),
    vscode.commands.registerCommand(
      "redmine-client.openExtraTicketEditor",
      async (item?: TicketTreeItem) => {
        if (!(item instanceof TicketTreeItem)) {
          vscode.window.showErrorMessage("Dashboard からチケットを選択してください。");
          return;
        }
        commentsProvider.setTicketId(item.ticket.id);
        await showTicketPreview(item.ticket, { kind: "extra" });
      },
    ),
  );

  // ── ブラウザで開く ────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "redmine-client.openProjectInBrowser",
      async (item?: ProjectTreeItem) => {
        await openProjectInBrowser(item instanceof ProjectTreeItem ? item : undefined);
      },
    ),
    vscode.commands.registerCommand(
      "redmine-client.openTicketInBrowser",
      async (item?: TicketTreeItem) => {
        await openTicketInBrowser(item instanceof TicketTreeItem ? item : undefined);
      },
    ),
    vscode.commands.registerCommand(
      "redmine-client.openCommentInBrowser",
      async (item?: CommentTreeItem) => {
        await openCommentInBrowser(item instanceof CommentTreeItem ? item : undefined);
      },
    ),
  );

  // ── Ticket Settings ───────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.titleFilter, async () => {
      await ticketsProvider.configureTitleFilter();
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.priorityFilter, async () => {
      await ticketsProvider.configurePriorityFilter();
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.statusFilter, async () => {
      await ticketsProvider.configureStatusFilter();
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.trackerFilter, async () => {
      await ticketsProvider.configureTrackerFilter();
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.assigneeFilter, async () => {
      await ticketsProvider.configureAssigneeFilter();
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.sort, async () => {
      await ticketsProvider.configureSort();
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.dueDate, async () => {
      await ticketsProvider.configureDueDateDisplay();
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.offlineSyncMode, async () => {
      await configureOfflineSyncMode();
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.reset, () => {
      ticketsProvider.resetTicketSettings();
      settingsProvider.refresh();
    }),
  );

  // ── Editor Defaults ───────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.subject, async () => {
      await configureEditorDefaultField("subject");
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.description, async () => {
      await configureEditorDefaultField("description");
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.tracker, async () => {
      await configureEditorDefaultField("tracker");
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.priority, async () => {
      await configureEditorDefaultField("priority");
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.status, async () => {
      await configureEditorDefaultField("status");
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.dueDate, async () => {
      await configureEditorDefaultField("due_date");
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.reset, async () => {
      await resetEditorDefaults();
      settingsProvider.refresh();
    }),
  );

  // ── API キー管理 ──────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Redmine APIキーを入力してください",
        password: true,
        placeHolder: "Redmine API key",
      });
      if (key === undefined) {
        return;
      }
      await setApiKey(key);
      showSuccess("APIキーをセキュアストレージに保存しました。");
    }),
    vscode.commands.registerCommand("redmine-client.clearApiKey", async () => {
      await clearApiKey();
      showSuccess("APIキーを削除しました。");
    }),
    vscode.commands.registerCommand("redmine-client.showApiKeyStatus", async () => {
      const status = await getApiKeyStatus();
      const messages: Record<typeof status, string> = {
        secret: "APIキーはセキュアストレージに保存されています。",
        settings:
          "APIキーは settings.json に保存されています。セキュアストレージへの移行を推奨します（Redmine: Set API Key）。",
        none: "APIキーが設定されていません。",
      };
      vscode.window.showInformationMessage(messages[status]);
    }),
  );
};
