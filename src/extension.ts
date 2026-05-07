import * as vscode from "vscode";
import { refreshOfflineSyncContext } from "./commands/offlineSyncMode";
import { getProjectSelection } from "./config/projectSelection";
import { initializeApiKeyStore } from "./config/apiKeyStore";
import { getIgnoreSSLErrors } from "./config/settings";
import { showWarning } from "./utils/notifications";
import { initializeDraftStore } from "./views/ticketDraftStore";
import { createGlobalStateDraftStorage } from "./views/draftPersistence";
import { initializeNewTicketDraftStore } from "./views/newTicketDraftStore";
import { initializeOfflineSyncStore } from "./views/offlineSyncStore";
import { initializeTicketListSettingsStore } from "./views/ticketListSettingsStore";
import { isTicketEditor } from "./views/ticketEditorRegistry";
import { setViewContext } from "./views/viewContext";
import { registerConflictDiffProvider } from "./views/conflictDiffProvider";
import { registerViews } from "./app/viewRegistry";
import { createNotificationController } from "./app/notificationController";
import { createSyncController } from "./app/syncController";
import {
  buildRegisterEditorDocument,
  buildUpdateTicketStatus,
  TICKET_EDITOR_CONTEXT_KEY,
  registerEditorEvents,
} from "./app/editorEventController";
import { registerCommands } from "./app/commandRegistry";

export async function activate(context: vscode.ExtensionContext) {
  // ── ストア初期化 ─────────────────────────────────────────────────────────
  initializeDraftStore(createGlobalStateDraftStorage(context.globalState));
  initializeNewTicketDraftStore(context.globalState);
  initializeOfflineSyncStore(context.workspaceState);
  initializeTicketListSettingsStore(context.workspaceState);
  await initializeApiKeyStore(context.secrets, context.subscriptions);
  registerConflictDiffProvider(context);

  if (getIgnoreSSLErrors()) {
    showWarning(vscode.l10n.t("ignoreSSLErrors is enabled. Do not use in production."));
  }

  // ── ビュー登録 ───────────────────────────────────────────────────────────
  const views = registerViews(context);

  // ── 通知コントローラー ───────────────────────────────────────────────────
  const notifications = createNotificationController({
    unsyncedPresentation: views.unsyncedPresentation,
  });

  // ── エディタドキュメント登録関数 ─────────────────────────────────────────
  const registerEditorDocument = buildRegisterEditorDocument();

  // ── 同期コントローラー ───────────────────────────────────────────────────
  const sync = createSyncController({
    ticketsPresentation: views.ticketsPresentation,
    commentsPresentation: views.commentsPresentation,
    unsyncedPresentation: views.unsyncedPresentation,
    notifications,
    registerEditorDocument,
  });

  // ── ステータスバー ───────────────────────────────────────────────────────
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.name = "Redmine Ticket";
  context.subscriptions.push(statusBarItem);
  const updateTicketStatus = buildUpdateTicketStatus(statusBarItem);

  // ── エディタイベント登録 ─────────────────────────────────────────────────
  registerEditorEvents(context, { registerEditorDocument, updateTicketStatus, sync });

  // ── コマンド登録 ─────────────────────────────────────────────────────────
  registerCommands(context, {
    ticketsPresentation: views.ticketsPresentation,
    commentsPresentation: views.commentsPresentation,
    unsyncedPresentation: views.unsyncedPresentation,
    settingsPresentation: views.settingsPresentation,
    dashboardProvider: views.dashboardProvider,
    sync,
  });

  // ── オフライン同期モード ─────────────────────────────────────────────────
  void refreshOfflineSyncContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("redmine-client.offlineSyncMode")) {
        void refreshOfflineSyncContext();
        views.settingsPresentation.refresh();
      }
      if (event.affectsConfiguration("redmine-client.ignoreSSLErrors")) {
        if (getIgnoreSSLErrors()) {
          showWarning(vscode.l10n.t("ignoreSSLErrors is enabled. Do not use in production."));
        }
      }
      if (
        event.affectsConfiguration("redmine-client.ticketList.showStatus") ||
        event.affectsConfiguration("redmine-client.ticketList.showDueDate")
      ) {
        views.settingsPresentation.refresh();
      }
    }),
  );

  // ── 初期ロード ───────────────────────────────────────────────────────────
  const initialSelection = getProjectSelection();
  if (initialSelection.id) {
    views.ticketsPresentation.setSelectedProjectId(initialSelection.id);
  }

  vscode.workspace.textDocuments.forEach((document) => {
    registerEditorDocument(document);
  });

  views.unsyncedPresentation.refresh();
  views.ticketsPresentation.refresh();

  const initialEditor = vscode.window.activeTextEditor;
  void setViewContext(
    TICKET_EDITOR_CONTEXT_KEY,
    !!initialEditor && isTicketEditor(initialEditor),
  );
  updateTicketStatus(initialEditor);
}

export function deactivate() {}
