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
import { initializeTreeExpansionState } from "./views/treeState";
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
  initializeTreeExpansionState(context.workspaceState);
  initializeOfflineSyncStore(context.workspaceState);
  await initializeApiKeyStore(context.secrets, context.subscriptions);
  registerConflictDiffProvider(context);

  if (getIgnoreSSLErrors()) {
    showWarning("ignoreSSLErrors が有効です。本番環境では使用しないでください。");
  }

  // ── ビュー登録 ───────────────────────────────────────────────────────────
  const views = registerViews(context);

  // ── 通知コントローラー ───────────────────────────────────────────────────
  const notifications = createNotificationController({
    refreshUnsyncedFiles: () => views.unsyncedFilesProvider.refresh(),
  });

  // ── エディタドキュメント登録関数 ─────────────────────────────────────────
  const registerEditorDocument = buildRegisterEditorDocument();

  // ── 同期コントローラー ───────────────────────────────────────────────────
  const sync = createSyncController({
    ticketsProvider: views.ticketsProvider,
    commentsProvider: views.commentsProvider,
    unsyncedFilesProvider: views.unsyncedFilesProvider,
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
  registerCommands(context, { ...views, sync });

  // ── オフライン同期モード ─────────────────────────────────────────────────
  void refreshOfflineSyncContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("redmine-client.offlineSyncMode")) {
        void refreshOfflineSyncContext();
        views.settingsProvider.refresh();
      }
      if (event.affectsConfiguration("redmine-client.ignoreSSLErrors")) {
        if (getIgnoreSSLErrors()) {
          showWarning("ignoreSSLErrors が有効です。本番環境では使用しないでください。");
        }
      }
    }),
  );

  // ── 初期ロード ───────────────────────────────────────────────────────────
  const initialSelection = getProjectSelection();
  await views.projectsProvider.loadProjects();
  if (initialSelection.id) {
    const projectItem = views.projectsProvider.getProjectItemById(initialSelection.id);
    if (projectItem) {
      await views.activityProjectsView.reveal(projectItem, {
        select: true,
        focus: false,
      });
    }
    views.ticketsProvider.setSelectedProjectId(initialSelection.id);
  }

  vscode.workspace.textDocuments.forEach((document) => {
    registerEditorDocument(document);
  });

  views.unsyncedFilesProvider.refresh();
  views.ticketsProvider.refresh();

  const initialEditor = vscode.window.activeTextEditor;
  void setViewContext(
    TICKET_EDITOR_CONTEXT_KEY,
    !!initialEditor && isTicketEditor(initialEditor),
  );
  updateTicketStatus(initialEditor);
}

export function deactivate() {}
