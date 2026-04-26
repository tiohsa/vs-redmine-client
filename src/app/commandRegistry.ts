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
import { setProjectSelection } from "../config/projectSelection";
import { setApiKey, clearApiKey, getApiKeyStatus } from "../config/apiKeyStore";
import { getIssueDetail } from "../redmine/issues";
import { showError, showSuccess } from "../utils/notifications";
import { setCommentDraft } from "../views/commentDraftStore";
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
import { showTicketComment, showTicketPreview } from "../views/ticketPreview";
import { ProjectTreeItem, ProjectsTreeProvider } from "../views/projectsView";
import { UnsyncedFileTreeItem, UnsyncedFilesTreeProvider } from "../views/unsyncedFilesView";
import {
  VIEW_ID_ACTIVITY_PROJECTS,
  VIEW_ID_ACTIVITY_TICKETS,
} from "../views/viewIds";
import type { SyncController, SyncStatus } from "./syncController";

export interface CommandDeps {
  projectsProvider: ProjectsTreeProvider;
  ticketsProvider: TicketsTreeProvider;
  commentsProvider: CommentsTreeProvider;
  unsyncedFilesProvider: UnsyncedFilesTreeProvider;
  settingsProvider: TicketSettingsTreeProvider;
  activityProjectsView: vscode.TreeView<vscode.TreeItem>;
  activityTicketsView: vscode.TreeView<vscode.TreeItem>;
  activityCommentsView: vscode.TreeView<vscode.TreeItem>;
  sync: Pick<SyncController, "syncEditorAndNotify">;
}

const runTreeCollapseCommand = async (viewId: string): Promise<boolean> => {
  await vscode.commands.executeCommand(`${viewId}.focus`);
  const commandId = "list.collapseAll";
  const available = await vscode.commands.getCommands(true);
  if (!available.includes(commandId)) {
    return false;
  }
  await vscode.commands.executeCommand(commandId);
  return true;
};

const restoreTreeScroll = async (
  view: vscode.TreeView<vscode.TreeItem>,
  item?: vscode.TreeItem,
): Promise<void> => {
  if (!item) {
    return;
  }
  await view.reveal(item, { focus: false, select: false });
};

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
    activityProjectsView,
    activityTicketsView,
    activityCommentsView,
    sync,
  } = deps;

  let lastProjectSelection: ProjectTreeItem | undefined;
  let lastTicketSelection: TicketTreeItem | undefined;
  let selectedComment: CommentTreeItem | undefined;
  let selectedCommentDocumentUri: string | undefined;

  const getSelectedComment = (item?: CommentTreeItem): CommentTreeItem | undefined =>
    item ??
    (activityCommentsView.selection[0] as CommentTreeItem | undefined) ??
    selectedComment;

  const handleTicketSelection = (item?: TicketTreeItem): void => {
    const selected = item ?? (activityTicketsView.selection[0] as TicketTreeItem | undefined);
    if (!selected || !(selected instanceof TicketTreeItem)) {
      return;
    }
    commentsProvider.setTicketId(selected.ticket.id);
  };

  const handleCommentSelection = async (item?: CommentTreeItem): Promise<void> => {
    const selected = getSelectedComment(item);
    if (!selected || !(selected instanceof CommentTreeItem)) {
      return;
    }
    selectedComment = selected;
    try {
      const detail = await getIssueDetail(selected.comment.ticketId);
      commentsProvider.setTicketId(detail.ticket.id, selected.comment.id);
      setCommentDraft(detail.ticket.id, selected.comment.body);
      const editor = await showTicketComment(
        detail.ticket,
        selected.comment.body,
        selected.comment.id,
        selected.comment.updatedAt,
      );
      selectedCommentDocumentUri = editor.document.uri.toString();
    } catch (error) {
      vscode.window.showErrorMessage((error as Error).message);
    }
  };

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
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      await sync.syncEditorAndNotify(editor);
    }),
    vscode.commands.registerCommand(
      "redmine-client.syncOpenEditor",
      async (item: { uri?: string } & { record?: { uri?: string } }) => {
        const uriStr = item?.uri ?? item?.record?.uri;
        if (!uriStr) {
          return;
        }
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriStr));
        const editor =
          vscode.window.visibleTextEditors.find((e) => e.document === document) ??
          (await vscode.window.showTextDocument(document, { preview: false }));
        await sync.syncEditorAndNotify(editor);
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
      await ticketsProvider.loadTickets();
      if (!ticketsProvider.getSelectedProjectId()) {
        showError("Select a project to focus tickets.");
        return;
      }
      ticketsProvider.getViewItems();
      const item = ticketsProvider.getTicketItemById(ticketId);
      if (!item) {
        showError("Ticket is not visible in the current ticket list.");
        return;
      }
      ticketsProvider.setSelectedTicketId(ticketId);
      await activityTicketsView.reveal(item, { focus: true, select: true, expand: true });
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
        const selected =
          item ?? (activityProjectsView.selection[0] as ProjectTreeItem | undefined);
        if (!selected || !(selected instanceof ProjectTreeItem)) {
          return;
        }
        projectsProvider.refresh();
      },
    ),
    vscode.commands.registerCommand("redmine-client.collapseAllProjects", async () => {
      projectsProvider.collapseAllVisible();
      const selected =
        activityProjectsView.selection[0] ??
        lastProjectSelection ??
        projectsProvider
          .getViewItems()
          .find((i): i is ProjectTreeItem => i instanceof ProjectTreeItem);
      const usedListCommand = await runTreeCollapseCommand(VIEW_ID_ACTIVITY_PROJECTS);
      if (usedListCommand) {
        await restoreTreeScroll(activityProjectsView, selected);
      }
    }),
    vscode.commands.registerCommand("redmine-client.collapseAllTickets", async () => {
      ticketsProvider.collapseAllVisible();
      const usedListCommand = await runTreeCollapseCommand(VIEW_ID_ACTIVITY_TICKETS);
      if (usedListCommand) {
        const selected =
          activityTicketsView.selection[0] ??
          lastTicketSelection ??
          ticketsProvider
            .getViewItems()
            .find((i): i is TicketTreeItem => i instanceof TicketTreeItem);
        await restoreTreeScroll(activityTicketsView, selected);
      }
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
      await setProjectSelection(numericId, "");
      projectsProvider.setSelectedProjectId(numericId);
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
        const selected = getSelectedComment(item);
        if (!selected || !(selected instanceof CommentTreeItem)) {
          vscode.window.showErrorMessage("Select a comment to edit.");
          return;
        }
        if (
          selectedCommentDocumentUri &&
          vscode.window.activeTextEditor?.document?.uri.toString() !==
            selectedCommentDocumentUri
        ) {
          vscode.window.showErrorMessage("Open the comment editor before updating.");
          return;
        }
        await editComment(selected.comment);
      },
    ),
    vscode.commands.registerCommand("redmine-client.addComment", async () => {
      const selected = activityTicketsView.selection[0] as TicketTreeItem | undefined;
      if (!selected) {
        vscode.window.showErrorMessage("Select a ticket before adding a comment.");
        return;
      }
      await addCommentFromList(selected.ticket.id);
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
        const selected =
          item ?? (activityTicketsView.selection[0] as TicketTreeItem | undefined);
        if (!selected || !(selected instanceof TicketTreeItem)) {
          vscode.window.showErrorMessage("Select a ticket to preview.");
          return;
        }
        commentsProvider.setTicketId(selected.ticket.id);
        await showTicketPreview(selected.ticket);
      },
    ),
    vscode.commands.registerCommand(
      "redmine-client.openExtraTicketEditor",
      async (item?: TicketTreeItem) => {
        const selected =
          item ?? (activityTicketsView.selection[0] as TicketTreeItem | undefined);
        if (!selected || !(selected instanceof TicketTreeItem)) {
          vscode.window.showErrorMessage("Select a ticket to preview.");
          return;
        }
        commentsProvider.setTicketId(selected.ticket.id);
        await showTicketPreview(selected.ticket, { kind: "extra" });
      },
    ),
  );

  // ── ブラウザで開く ────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "redmine-client.openProjectInBrowser",
      async (item?: ProjectTreeItem) => {
        const selected =
          item ?? (activityProjectsView.selection[0] as ProjectTreeItem | undefined);
        await openProjectInBrowser(selected);
      },
    ),
    vscode.commands.registerCommand(
      "redmine-client.openTicketInBrowser",
      async (item?: TicketTreeItem) => {
        const selected =
          item ?? (activityTicketsView.selection[0] as TicketTreeItem | undefined);
        await openTicketInBrowser(selected);
      },
    ),
    vscode.commands.registerCommand(
      "redmine-client.openCommentInBrowser",
      async (item?: CommentTreeItem) => {
        const selected =
          item ?? (activityCommentsView.selection[0] as CommentTreeItem | undefined);
        await openCommentInBrowser(selected);
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

  // ── View 選択イベント ─────────────────────────────────────────────────────
  context.subscriptions.push(
    activityTicketsView.onDidChangeSelection((event) => {
      const selected = event.selection[0] as TicketTreeItem | undefined;
      ticketsProvider.setSelectedTicketId(selected?.ticket.id);
      handleTicketSelection(selected);
      if (selected) {
        lastTicketSelection = selected;
      }
    }),
    activityProjectsView.onDidChangeSelection(async (event) => {
      const selected = event.selection[0] as ProjectTreeItem | undefined;
      if (!selected) {
        return;
      }
      lastProjectSelection = selected;
      await setProjectSelection(selected.project.id, selected.project.name);
      projectsProvider.setSelectedProjectId(selected.project.id);
      ticketsProvider.setSelectedProjectId(selected.project.id);
      ticketsProvider.refresh();
    }),
    activityCommentsView.onDidChangeSelection((event) => {
      const selected = event.selection[0] as CommentTreeItem | undefined;
      commentsProvider.setSelectedCommentId(selected?.comment.id);
      void handleCommentSelection(selected);
    }),
  );
};
