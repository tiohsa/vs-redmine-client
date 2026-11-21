import * as vscode from "vscode";
import { refreshOfflineSyncContext } from "./commands/offlineSyncMode";
import { initializeApiKeyStore } from "./config/apiKeyStore";
import {
  getBaseUrl,
  getIgnoreSSLErrors,
  getTicketListFollowActiveEditor,
} from "./config/settings";
import { showWarning } from "./utils/notifications";
import { initializeDraftStore } from "./views/ticketDraftStore";
import { createGlobalStateDraftStorage } from "./views/draftPersistence";
import { initializeNewTicketDraftStore } from "./views/newTicketDraftStore";
import { initializeOfflineSyncStore, switchOfflineSyncStore } from "./views/offlineSyncStore";
import { observeUploadSpoolCleanup } from "./app/ticketSync/uploadSpoolCleanup";
import { DurableUploadSpoolStore, resolveUploadSpoolOwner, setDefaultUploadSpoolStore } from "./app/ticketSync/uploadSpoolStore";
import { initializeTicketListSettingsStore } from "./views/ticketListSettingsStore";
import { refreshEditorConnectionScopes } from "./views/ticketEditorRegistry";
import { registerConflictDiffProvider } from "./views/conflictDiffProvider";
import { registerViews } from "./app/viewRegistry";
import { createNotificationController } from "./app/notificationController";
import { createSyncController } from "./app/syncController";
import { createSyncEngine } from "./app/syncEngine";
import {
  buildRegisterEditorDocument,
  buildUpdateTicketStatus,
  refreshTicketEditorContexts,
  registerEditorEvents,
  resolveActiveTicketForEditor,
} from "./app/editorEventController";
import { registerCommands } from "./app/commandRegistry";
import { getConnectionScope } from "./config/connectionScope";
import { TicketCodeLensProvider } from "./views/ticketCodeLensProvider";

import { registerReferenceExample } from "./layers/extension-host/entry-points/referenceExample";

export async function activate(context: vscode.ExtensionContext) {
  registerReferenceExample(context);
  // ── ストア初期化 ─────────────────────────────────────────────────────────
  let activeBaseUrl = getConnectionScope(getBaseUrl());
  initializeDraftStore(
    createGlobalStateDraftStorage(context.globalState, activeBaseUrl),
    activeBaseUrl,
  );
  initializeNewTicketDraftStore(context.globalState);
  initializeOfflineSyncStore(context.workspaceState, activeBaseUrl);
  const spoolOwner = await resolveUploadSpoolOwner(context.workspaceState, context.storageUri?.toString());
  const uploadSpoolStore = new DurableUploadSpoolStore(context.globalStorageUri.fsPath, spoolOwner);
  setDefaultUploadSpoolStore(uploadSpoolStore);
  const spoolCleanup = observeUploadSpoolCleanup({ store: uploadSpoolStore, storage: context.workspaceState });
  context.subscriptions.push(spoolCleanup);
  void spoolCleanup.cleanup();
  initializeTicketListSettingsStore(context.workspaceState);
  await initializeApiKeyStore(context.secrets, context.subscriptions);
  registerConflictDiffProvider(context);
  const ticketCodeLensProvider = new TicketCodeLensProvider();
  context.subscriptions.push(
    ticketCodeLensProvider,
    vscode.languages.registerCodeLensProvider(
      { language: "markdown" },
      ticketCodeLensProvider,
    ),
  );

  if (getIgnoreSSLErrors()) {
    showWarning(vscode.l10n.t("ignoreSSLErrors is enabled. Do not use in production."));
  }

  // ── 同期エンジン / ビュー登録 ────────────────────────────────────────────
  const syncEngine = createSyncEngine({ uploadSpoolStore });
  const views = registerViews(context, { syncEngine });

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
    syncEngine,
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
  registerEditorEvents(context, {
    registerEditorDocument,
    updateTicketStatus,
    notifyTicketChanged: () => views.ticketsPresentation.notifyChange(),
    sync,
    onActiveTicketChanged: (ticketId, connectionScope) => {
      void views.dashboardProvider.selectTicketForEditor(ticketId, connectionScope);
    },
  });

  // ── コマンド登録 ─────────────────────────────────────────────────────────
  registerCommands(context, {
    ticketsPresentation: views.ticketsPresentation,
    commentsPresentation: views.commentsPresentation,
    unsyncedPresentation: views.unsyncedPresentation,
    settingsPresentation: views.settingsPresentation,
    dashboardProvider: views.dashboardProvider,
    sync,
    syncEngine,
  });

  // ── オフライン同期モード ─────────────────────────────────────────────────
  void refreshOfflineSyncContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("redmine-client.baseUrl")) {
        const nextBaseUrl = getConnectionScope(getBaseUrl());
        if (nextBaseUrl !== activeBaseUrl) {
          activeBaseUrl = nextBaseUrl;
          switchOfflineSyncStore(nextBaseUrl);
          refreshEditorConnectionScopes(nextBaseUrl);
          initializeDraftStore(
            createGlobalStateDraftStorage(context.globalState, nextBaseUrl),
            nextBaseUrl,
          );
          void views.dashboardProvider.resetForConnectionChange().catch((err: unknown) => {
            console.error("[vs-redmine-client] Failed to reset connection state", err);
          });
        }
      }
      const affectsDashboardSettings =
        event.affectsConfiguration("redmine-client.baseUrl") ||
        event.affectsConfiguration("redmine-client.defaultProjectId") ||
        event.affectsConfiguration("redmine-client.requestTimeoutMs") ||
        event.affectsConfiguration("redmine-client.ignoreSSLErrors") ||
        event.affectsConfiguration("redmine-client.includeChildProjects") ||
        event.affectsConfiguration("redmine-client.ticketListLimit") ||
        event.affectsConfiguration("redmine-client.editorStorageDirectory") ||
        event.affectsConfiguration("redmine-client.ticketList.showStatus") ||
        event.affectsConfiguration("redmine-client.ticketList.showDueDate") ||
        event.affectsConfiguration("redmine-client.ticketList.showTracker") ||
        event.affectsConfiguration("redmine-client.ticketList.showPriority") ||
        event.affectsConfiguration("redmine-client.ticketList.showAssignee") ||
        event.affectsConfiguration("redmine-client.ticketList.followActiveEditor");
      if (affectsDashboardSettings) {
        views.dashboardProvider.refreshSettings();
      }
      if (
        event.affectsConfiguration("redmine-client.ticketList.followActiveEditor") &&
        getTicketListFollowActiveEditor()
      ) {
        const activeTicket = resolveActiveTicketForEditor(vscode.window.activeTextEditor);
        if (activeTicket) {
          void views.dashboardProvider.selectTicketForEditor(
            activeTicket.ticketId,
            activeTicket.connectionScope,
          );
        }
      }
      if (
        event.affectsConfiguration("redmine-client.defaultProjectId") ||
        event.affectsConfiguration("redmine-client.includeChildProjects") ||
        event.affectsConfiguration("redmine-client.ticketListLimit")
      ) {
        views.dashboardProvider.refreshTickets();
      }
      if (
        event.affectsConfiguration("redmine-client.ticketList.showStatus") ||
        event.affectsConfiguration("redmine-client.ticketList.showDueDate") ||
        event.affectsConfiguration("redmine-client.ticketList.showTracker") ||
        event.affectsConfiguration("redmine-client.ticketList.showPriority") ||
        event.affectsConfiguration("redmine-client.ticketList.showAssignee")
      ) {
        views.ticketsPresentation.notifyChange();
      }
      if (event.affectsConfiguration("redmine-client.offlineSyncMode")) {
        void refreshOfflineSyncContext();
        views.settingsPresentation.refresh();
      }
      if (event.affectsConfiguration("redmine-client.ignoreSSLErrors")) {
        if (getIgnoreSSLErrors()) {
          showWarning(vscode.l10n.t("ignoreSSLErrors is enabled. Do not use in production."));
        }
      }
    }),
  );

  // ── 初期ロード ───────────────────────────────────────────────────────────
  vscode.workspace.textDocuments.forEach((document) => {
    registerEditorDocument(document);
  });

  views.unsyncedPresentation.refresh();
  views.ticketsPresentation.refresh();

  const initialEditor = vscode.window.activeTextEditor;
  refreshTicketEditorContexts(initialEditor);
  updateTicketStatus(initialEditor);
}

export function deactivate() {}
