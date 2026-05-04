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
import { setApiKey, clearApiKey, getApiKeyStatus } from "../config/apiKeyStore";
import { showError, showSuccess } from "../utils/notifications";
import {
  configureEditorDefaultField,
  resetEditorDefaults,
} from "../views/editorDefaultCommands";
import { EDITOR_DEFAULT_COMMANDS, TICKET_SETTINGS_COMMANDS } from "./commandIds";
import {
  getAllEditorRecords,
  getTicketIdForEditor,
  isTicketEditor,
  NEW_TICKET_DRAFT_ID,
} from "../views/ticketEditorRegistry";
import { showTicketPreview } from "../views/ticketPreview";
import type { Comment, Project, Ticket } from "../redmine/types";
import type {
  CommentPresentationPort,
  SettingsPresentationPort,
  TicketPresentationPort,
  UnsyncedPresentationPort,
} from "./presentationPorts";
import type { SyncController, SyncStatus } from "./syncController";
import type { DashboardWebviewProvider } from "../dashboard/DashboardWebviewProvider";
import type { DashboardState, DashboardUnsyncedKey } from "../dashboard/dashboardProtocol";

export interface CommandDeps {
  ticketsPresentation: TicketPresentationPort;
  commentsPresentation: CommentPresentationPort;
  unsyncedPresentation: UnsyncedPresentationPort;
  settingsPresentation: SettingsPresentationPort;
  dashboardProvider: DashboardWebviewProvider;
  sync: Pick<SyncController, "syncEditorAndNotify">;
}

const toSelectedTicket = (state: DashboardState): Ticket | undefined => {
  const id = state.selectedTicketId;
  if (!id) {
    return undefined;
  }
  const fromList = state.tickets.find((t) => t.id === id);
  if (fromList?.projectId) {
    return {
      id: fromList.id,
      subject: fromList.subject,
      description: state.selectedTicket?.description,
      statusName: fromList.statusName,
      priorityName: fromList.priorityName,
      trackerName: fromList.trackerName,
      assigneeName: fromList.assigneeName,
      dueDate: fromList.dueDate,
      startDate: fromList.startDate,
      projectId: fromList.projectId,
      projectName: fromList.projectName,
      parentId: fromList.parentId,
      updatedAt: state.selectedTicket?.lastSyncedAt,
    };
  }
  const detail = state.selectedTicket;
  if (!detail?.projectId) {
    return undefined;
  }
  return {
    id: detail.id,
    subject: detail.subject,
    description: detail.description,
    statusName: detail.statusName,
    priorityName: detail.priorityName,
    trackerName: detail.trackerName,
    assigneeName: detail.assigneeName,
    dueDate: detail.dueDate,
    startDate: detail.startDate,
    projectId: detail.projectId,
    projectName: detail.projectName,
    parentId: detail.parentId,
    updatedAt: detail.lastSyncedAt,
  };
};

const pickDashboardComment = async (state: DashboardState): Promise<Comment | undefined> => {
  const ticketId = state.comments.ticketId;
  if (!ticketId || state.comments.items.length === 0) {
    return undefined;
  }
  const items = state.comments.items.map((comment) => ({
    label: `#${comment.id} ${comment.authorName}`,
    description: comment.updatedAt ?? comment.createdAt ?? "",
    detail: comment.body.slice(0, 80),
    comment,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: "コメントを選択",
    placeHolder: "編集またはブラウザ表示するコメントを選択してください",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) {
    return undefined;
  }
  return {
    id: picked.comment.id,
    ticketId,
    authorId: 0,
    authorName: picked.comment.authorName,
    body: picked.comment.body,
    createdAt: picked.comment.createdAt,
    updatedAt: picked.comment.updatedAt,
    editableByCurrentUser: picked.comment.editableByCurrentUser,
  };
};

const isDashboardUnsyncedKey = (value: unknown): value is DashboardUnsyncedKey => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { kind?: unknown };
  return candidate.kind === "ticket" || candidate.kind === "newTicket" || candidate.kind === "comment";
};

const registerStubMessage = (
  commandId: string,
  message: string,
): vscode.Disposable =>
  vscode.commands.registerCommand(commandId, () => {
    vscode.window.showErrorMessage(message);
  });

const openEditorForUri = async (uriStr: string): Promise<vscode.TextEditor> => {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriStr));
  return (
    vscode.window.visibleTextEditors.find((e: vscode.TextEditor) => e.document === document) ??
    (await vscode.window.showTextDocument(document, { preview: false }))
  );
};

const requireSelectedTicket = (
  state: DashboardState,
  errorMessage: string,
): Ticket | undefined => {
  const selected = toSelectedTicket(state);
  if (!selected) {
    vscode.window.showErrorMessage(errorMessage);
    return undefined;
  }
  return selected;
};

const SETTINGS_FILTER_STUB_MESSAGE =
  "Dashboard の Settings タブでフィルタを設定してください。";
const SETTINGS_FILTER_STUB_COMMANDS: ReadonlyArray<readonly [string, string]> = [
  [TICKET_SETTINGS_COMMANDS.titleFilter, SETTINGS_FILTER_STUB_MESSAGE],
  [TICKET_SETTINGS_COMMANDS.priorityFilter, SETTINGS_FILTER_STUB_MESSAGE],
  [TICKET_SETTINGS_COMMANDS.statusFilter, SETTINGS_FILTER_STUB_MESSAGE],
  [TICKET_SETTINGS_COMMANDS.trackerFilter, SETTINGS_FILTER_STUB_MESSAGE],
  [TICKET_SETTINGS_COMMANDS.assigneeFilter, SETTINGS_FILTER_STUB_MESSAGE],
  [TICKET_SETTINGS_COMMANDS.sort, "Dashboard の Settings タブで並び順を設定してください。"],
  [TICKET_SETTINGS_COMMANDS.dueDate, "Dashboard の Settings タブで期限表示を設定してください。"],
  [TICKET_SETTINGS_COMMANDS.reset, "Dashboard の Settings タブから設定をリセットしてください。"],
];

const EDITOR_DEFAULT_FIELD_COMMANDS: ReadonlyArray<readonly [string, "subject" | "description" | "tracker" | "priority" | "status" | "due_date"]> = [
  [EDITOR_DEFAULT_COMMANDS.subject, "subject"],
  [EDITOR_DEFAULT_COMMANDS.description, "description"],
  [EDITOR_DEFAULT_COMMANDS.tracker, "tracker"],
  [EDITOR_DEFAULT_COMMANDS.priority, "priority"],
  [EDITOR_DEFAULT_COMMANDS.status, "status"],
  [EDITOR_DEFAULT_COMMANDS.dueDate, "due_date"],
];

export const registerCommands = (
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): void => {
  const {
    ticketsPresentation,
    commentsPresentation,
    unsyncedPresentation,
    settingsPresentation,
    dashboardProvider,
    sync,
  } = deps;

  const getState = (): DashboardState => dashboardProvider.getStateSnapshot();

  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.refreshProjects", () =>
      ticketsPresentation.refresh(),
    ),
    vscode.commands.registerCommand("redmine-client.refreshTickets", () =>
      ticketsPresentation.refresh(),
    ),
    vscode.commands.registerCommand("redmine-client.refreshComments", () =>
      commentsPresentation.refresh(),
    ),
    registerStubMessage(
      "redmine-client.loadMoreTickets",
      "Dashboard の「もっと読み込む」を使用してください。",
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.runOfflineSync", async () => {
      await runOfflineSync();
      ticketsPresentation.refresh();
      commentsPresentation.refresh();
      unsyncedPresentation.refresh();
    }),
    vscode.commands.registerCommand("redmine-client.syncUnsyncedFile", async (item: unknown) => {
      const withKey = item as { syncKey?: unknown } | undefined;
      if (!isDashboardUnsyncedKey(withKey?.syncKey)) {
        vscode.window.showErrorMessage("Dashboard の未同期一覧から同期対象を選択してください。");
        return;
      }
      await syncUnsyncedFile(
        { syncKey: withKey.syncKey },
        { onTicketCreated: () => ticketsPresentation.refresh() },
      );
      unsyncedPresentation.refresh();
    }),
  );

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

      const editor = await openEditorForUri(fallbackRecord.uri);
      return sync.syncEditorAndNotify(editor);
    }),
    vscode.commands.registerCommand(
      "redmine-client.syncOpenEditor",
      async (item: { uri?: string } & { record?: { uri?: string } }) => {
        const uriStr = item?.uri ?? item?.record?.uri;
        if (!uriStr) {
          return undefined;
        }
        const editor = await openEditorForUri(uriStr);
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
          const editor = await openEditorForUri(record.uri);
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
      unsyncedPresentation.refresh();
    }),
  );

  context.subscriptions.push(
    registerStubMessage(
      "redmine-client.searchTickets",
      "Dashboard からチケットを検索・選択してください。",
    ),
    vscode.commands.registerCommand("redmine-client.focusTicketEditor", async (input: unknown) => {
      const payload = input as { ticketId?: number; uri?: string } | number | undefined;
      const ticketId = typeof payload === "number" ? payload : payload?.ticketId;
      if (!payload || (!ticketId && !(payload as { uri?: string })?.uri)) {
        showError("Select an open ticket to focus.");
        return;
      }
      await focusTicketEditor(payload);
      if (ticketId && ticketId !== NEW_TICKET_DRAFT_ID) {
        commentsPresentation.refreshForTicket(ticketId);
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
      showSuccess(`Ticket #${ticketId} is active in the editor.`);
    }),
    vscode.commands.registerCommand("redmine-client.reloadTicket", async () => {
      await reloadTicketFromEditor();
    }),
    registerStubMessage(
      "redmine-client.toggleRelevantTickets",
      "Dashboard のフィルタ設定を使用してください。",
    ),
    vscode.commands.registerCommand("redmine-client.createTicket", async () => {
      await createTicketFromEditor();
    }),
    vscode.commands.registerCommand("redmine-client.createTicketFromList", async () => {
      await createTicketFromList();
    }),
    vscode.commands.registerCommand("redmine-client.createChildTicketFromList", async () => {
      const selected = requireSelectedTicket(getState(), "Dashboard から親チケットを選択してください。");
      if (!selected) { return; }
      await createChildTicketFromList(selected);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.reloadProject", async () => {
      ticketsPresentation.refresh();
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
      ticketsPresentation.setSelectedProjectId(numericId);
      ticketsPresentation.refresh();
    }),
    vscode.commands.registerCommand("redmine-client.toggleChildProjects", async () => {
      const config = vscode.workspace.getConfiguration("redmine-client");
      const current = config.get<boolean>("includeChildProjects", false);
      await config.update("includeChildProjects", !current, vscode.ConfigurationTarget.Global);
      ticketsPresentation.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.reloadComment", async () => {
      await reloadCommentFromEditor();
    }),
    vscode.commands.registerCommand("redmine-client.editComment", async () => {
      const comment = await pickDashboardComment(getState());
      if (!comment) {
        vscode.window.showErrorMessage("Dashboard からコメントを選択してから実行してください。");
        return;
      }
      await editComment(comment);
    }),
    registerStubMessage(
      "redmine-client.addComment",
      "Dashboard からチケットを選択してコメントを追加してください。",
    ),
    vscode.commands.registerCommand("redmine-client.addCommentFromComments", async () => {
      const ticketId = getState().selectedTicketId;
      await addCommentFromList(ticketId);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.openTicketPreview", async () => {
      const selected = requireSelectedTicket(getState(), "Dashboard からチケットを選択してください。");
      if (!selected) { return; }
      await showTicketPreview(selected);
      commentsPresentation.refreshForTicket(selected.id);
    }),
    vscode.commands.registerCommand("redmine-client.openExtraTicketEditor", async () => {
      const selected = requireSelectedTicket(getState(), "Dashboard からチケットを選択してください。");
      if (!selected) { return; }
      await showTicketPreview(selected, { kind: "extra" });
      commentsPresentation.refreshForTicket(selected.id);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.openProjectInBrowser", async () => {
      const selected = getState().selectedProject;
      if (!selected?.id || !selected.name || !selected.identifier) {
        vscode.window.showErrorMessage("Dashboard でプロジェクトを選択してください。");
        return;
      }
      const project: Project = { id: selected.id, name: selected.name, identifier: selected.identifier };
      await openProjectInBrowser({ project });
    }),
    vscode.commands.registerCommand("redmine-client.openTicketInBrowser", async () => {
      const selected = requireSelectedTicket(getState(), "Dashboard でチケットを選択してください。");
      if (!selected) { return; }
      await openTicketInBrowser({ ticket: selected });
    }),
    vscode.commands.registerCommand("redmine-client.openCommentInBrowser", async () => {
      const comment = await pickDashboardComment(getState());
      if (!comment) {
        vscode.window.showErrorMessage("Dashboard でコメントを選択してください。");
        return;
      }
      await openCommentInBrowser({ comment });
    }),
  );

  context.subscriptions.push(
    ...SETTINGS_FILTER_STUB_COMMANDS.map(([id, message]) => registerStubMessage(id, message)),
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.offlineSyncMode, async () => {
      await configureOfflineSyncMode();
      settingsPresentation.refresh();
    }),
  );

  context.subscriptions.push(
    ...EDITOR_DEFAULT_FIELD_COMMANDS.map(([id, field]) =>
      vscode.commands.registerCommand(id, async () => {
        await configureEditorDefaultField(field);
        settingsPresentation.refresh();
      }),
    ),
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.reset, async () => {
      await resetEditorDefaults();
      settingsPresentation.refresh();
    }),
  );

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
