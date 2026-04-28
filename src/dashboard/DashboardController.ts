import * as vscode from "vscode";
import { listProjects } from "../redmine/projects";
import { listIssues, getIssueDetail } from "../redmine/issues";
import { listComments } from "../redmine/comments";
import { getOfflineSyncQueue, onOfflineSyncQueueChanged } from "../views/offlineSyncStore";
import { getProjectSelection, setProjectSelection } from "../config/projectSelection";
import { getDefaultProjectId, getIncludeChildProjects, getTicketListLimit } from "../config/settings";
import { runOfflineSync } from "../commands/offlineSync";
import { syncUnsyncedFile } from "../commands/syncUnsyncedFile";
import { UnsyncedFileTreeItem, UnsyncedFileSyncKey } from "../views/unsyncedFilesView";
import { formatTicketLabel } from "../views/ticketLabel";
import {
  DashboardState,
  DashboardMessage,
  DashboardPushMessage,
  UnsyncedEntry,
} from "./dashboardTypes";
import { SettingsController } from "./SettingsController";

const ALLOWED_OPEN_SCHEMES = ["file", "vscode-userdata"];

export interface DashboardControllerOptions {
  pushMessage: (msg: DashboardPushMessage) => void;
  openTicketInEditor?: (ticketId: number) => Promise<void>;
  openTicketInBrowser?: (ticketId: number) => Promise<void>;
  createTicket?: () => Promise<void>;
  createChildTicket?: (parentTicketId: number) => Promise<void>;
  addComment?: (ticketId: number) => Promise<void>;
  editComment?: (ticketId: number, commentId: number) => Promise<void>;
  openProjectInBrowser?: (projectId: number, identifier: string) => Promise<void>;
}

const DEFAULT_STATE: DashboardState = {
  projects: [],
  selectedProjectId: null,
  tickets: [],
  ticketsTotalCount: 0,
  ticketsOffset: 0,
  selectedTicketId: null,
  ticketDetail: null,
  comments: [],
  unsynced: [],
  expandedTicketIds: [],
  settings: {
    offlineSyncMode: "auto",
    includeChildProjects: false,
    ticketListLimit: 50,
    titleFilter: "",
    sortField: "id",
    sortOrder: "desc",
    showDueDateIndicator: true,
  },
  activeTab: "tickets",
  loading: false,
  error: null,
};

export class DashboardController implements vscode.Disposable {
  private state: DashboardState = { ...DEFAULT_STATE };
  private readonly opts: DashboardControllerOptions;
  private readonly settingsCtrl: SettingsController;
  private readonly disposeQueueChange: () => void;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(opts: DashboardControllerOptions) {
    this.opts = opts;
    this.settingsCtrl = new SettingsController((patch) => {
      this.patchState(patch);
    });

    this.disposeQueueChange = onOfflineSyncQueueChanged(() => {
      this.refreshUnsynced();
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.settingsCtrl.pushSettings();
    await Promise.all([this.loadProjects(), this.refreshUnsynced()]);
  }

  dispose(): void {
    this.disposeQueueChange();
    this.settingsCtrl.dispose();
    for (const d of this.disposables) {d.dispose();}
  }

  // ── Message handler ────────────────────────────────────────────────────────

  async handleMessage(msg: DashboardMessage): Promise<void> {
    switch (msg.type) {
      case "dashboard.ready":
        await this.initialize();
        break;

      case "project.select":
        await this.selectProject(msg.projectId);
        break;

      case "project.refresh":
        await this.loadProjects();
        break;

      case "project.openInBrowser": {
        const proj = this.state.projects.find(p => p.id === msg.projectId);
        if (proj) {
          await this.opts.openProjectInBrowser?.(msg.projectId, proj.identifier);
        }
        break;
      }

      case "tickets.loadMore":
        await this.loadMoreTickets();
        break;

      case "ticket.select":
        await this.selectTicket(msg.ticketId);
        break;

      case "ticket.toggleExpand":
        this.toggleExpand(msg.ticketId);
        break;

      case "ticket.openInEditor":
        await this.opts.openTicketInEditor?.(msg.ticketId);
        break;

      case "ticket.openInBrowser":
        await this.opts.openTicketInBrowser?.(msg.ticketId);
        break;

      case "ticket.createNew":
        await this.opts.createTicket?.();
        break;

      case "ticket.createChild":
        await this.opts.createChildTicket?.(msg.parentTicketId);
        break;

      case "comment.add":
        await this.opts.addComment?.(msg.ticketId);
        break;

      case "comment.edit":
        await this.opts.editComment?.(msg.ticketId, msg.commentId);
        break;

      case "unsynced.syncOne":
        await this.handleSyncOne(msg);
        break;

      case "unsynced.syncAll":
        await this.handleSyncAll();
        break;

      case "unsynced.openLocalFile":
        await this.handleOpenLocalFile(msg.documentUri, msg.requestId);
        break;

      case "settings.update":
        await this.settingsCtrl.applySettings(msg.settings);
        break;

      case "tab.switch":
        this.patchState({ activeTab: msg.tab });
        if (msg.tab === "comments" && this.state.selectedTicketId) {
          await this.loadComments(this.state.selectedTicketId);
        }
        break;
    }
  }

  // ── Projects ───────────────────────────────────────────────────────────────

  private async loadProjects(): Promise<void> {
    try {
      const projects = await listProjects(true);
      const sel = getProjectSelection();
      const defaultId = getDefaultProjectId();
      const selectedId = sel.id ?? (defaultId ? parseInt(defaultId, 10) : null) ?? null;

      this.patchState({ projects, selectedProjectId: selectedId });

      if (selectedId) {
        await this.loadTickets(selectedId);
      }
    } catch (e) {
      this.patchState({ error: String(e) });
    }
  }

  private async selectProject(projectId: number): Promise<void> {
    const proj = this.state.projects.find(p => p.id === projectId);
    if (proj) {await setProjectSelection(projectId, proj.name);}
    this.patchState({
      selectedProjectId: projectId,
      tickets: [],
      ticketsTotalCount: 0,
      ticketsOffset: 0,
      selectedTicketId: null,
      ticketDetail: null,
      comments: [],
    });
    await this.loadTickets(projectId);
  }

  // ── Tickets ────────────────────────────────────────────────────────────────

  private async loadTickets(projectId: number): Promise<void> {
    const limit = getTicketListLimit();
    this.patchState({ loading: true });
    try {
      const result = await listIssues({
        projectId,
        includeChildProjects: getIncludeChildProjects(),
        limit,
        offset: 0,
      });
      this.patchState({
        tickets: result.tickets,
        ticketsTotalCount: result.totalCount,
        ticketsOffset: 0,
        loading: false,
      });
    } catch (e) {
      this.patchState({ loading: false, error: String(e) });
    }
  }

  private async loadMoreTickets(): Promise<void> {
    if (!this.state.selectedProjectId) {return;}
    const limit = getTicketListLimit();
    const offset = this.state.ticketsOffset + limit;
    this.patchState({ loading: true });
    try {
      const result = await listIssues({
        projectId: this.state.selectedProjectId,
        includeChildProjects: getIncludeChildProjects(),
        limit,
        offset,
      });
      this.patchState({
        tickets: [...this.state.tickets, ...result.tickets],
        ticketsOffset: offset,
        loading: false,
      });
    } catch (e) {
      this.patchState({ loading: false, error: String(e) });
    }
  }

  private async selectTicket(ticketId: number): Promise<void> {
    this.patchState({ selectedTicketId: ticketId, ticketDetail: null });
    try {
      const detail = await getIssueDetail(ticketId);
      this.patchState({ ticketDetail: detail.ticket });
      await this.loadComments(ticketId);
    } catch (e) {
      this.patchState({ error: String(e) });
    }
  }

  private toggleExpand(ticketId: number): void {
    const expanded = this.state.expandedTicketIds;
    const newExpanded = expanded.includes(ticketId)
      ? expanded.filter(id => id !== ticketId)
      : [...expanded, ticketId];
    this.patchState({ expandedTicketIds: newExpanded });
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  private async loadComments(ticketId: number): Promise<void> {
    try {
      const comments = await listComments(ticketId);
      this.patchState({ comments });
    } catch (e) {
      this.patchState({ error: String(e) });
    }
  }

  // ── Unsynced ───────────────────────────────────────────────────────────────

  private refreshUnsynced(): void {
    const queue = getOfflineSyncQueue();
    const entries: UnsyncedEntry[] = [];

    queue.tickets.forEach((_update, ticketId) => {
      entries.push({
        kind: "ticket",
        label: `${formatTicketLabel(ticketId)} チケット更新`,
        ticketId,
      });
    });

    for (const c of queue.comments) {
      const base = formatTicketLabel(c.ticketId);
      entries.push({
        kind: "comment",
        label: c.commentId !== undefined ? `${base} コメント#${c.commentId} 更新` : `${base} 新規コメント`,
        ticketId: c.ticketId,
        commentId: c.commentId,
        documentUri: c.documentUri,
      });
    }

    for (const nt of queue.newTickets) {
      entries.push({
        kind: "newTicket",
        label: "新規チケット",
        documentUri: nt.documentUri,
      });
    }

    this.patchState({ unsynced: entries });
  }

  private async handleSyncOne(msg: Extract<DashboardMessage, { type: "unsynced.syncOne" }>): Promise<void> {
    let syncKey: UnsyncedFileSyncKey;
    if (msg.kind === "ticket" && msg.ticketId !== undefined) {
      syncKey = { kind: "ticket", ticketId: msg.ticketId };
    } else if (msg.kind === "newTicket") {
      syncKey = { kind: "newTicket", documentUri: msg.documentUri };
    } else if (msg.kind === "comment" && msg.ticketId !== undefined) {
      syncKey = { kind: "comment", ticketId: msg.ticketId, commentId: msg.commentId, documentUri: msg.documentUri };
    } else {
      return;
    }

    const item = new UnsyncedFileTreeItem("", "sync", syncKey);
    const result = await syncUnsyncedFile(item, {
      onTicketCreated: () => {
        if (this.state.selectedProjectId) {
          void this.loadTickets(this.state.selectedProjectId);
        }
      },
    });

    switch (result.status) {
      case "success":
        this.pushToast("info", "同期しました。");
        break;
      case "no_change":
        this.pushToast("info", "変更なし。");
        break;
      case "conflict":
        this.pushToast("warning", "競合が発生しています。ファイルを確認してください。");
        break;
      case "failed":
        this.pushToast("error", `同期に失敗しました: ${result.message ?? ""}`);
        break;
    }
  }

  private async handleSyncAll(): Promise<void> {
    const result = await runOfflineSync();

    switch (result.status) {
      case "nothing_to_sync":
        this.pushToast("info", "同期するものはありません。");
        break;
      case "success":
        this.pushToast("info", `全件同期が完了しました。同期: ${result.synced}件`);
        break;
      case "partial_failure":
        this.pushToast("warning", `一部の同期に失敗しました。成功: ${result.synced}件 / 失敗: ${result.failed}件 / 競合: ${result.conflicts}件`);
        break;
      case "cancelled":
        this.pushToast("warning", `同期をキャンセルしました。成功: ${result.synced}件 / 未完了: ${result.failed}件`);
        break;
      case "failed":
        this.pushToast("error", "同期に失敗しました。VS Code の通知をご確認ください。");
        break;
    }
  }

  private async handleOpenLocalFile(documentUri: string, requestId: string): Promise<void> {
    try {
      const uri = vscode.Uri.parse(documentUri);
      if (!ALLOWED_OPEN_SCHEMES.includes(uri.scheme)) {
        this.opts.pushMessage({ type: "error.response", requestId, message: "この URI は開けません。" });
        return;
      }
      await vscode.commands.executeCommand("vscode.open", uri);
    } catch (e) {
      this.opts.pushMessage({ type: "error.response", requestId, message: String(e) });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private patchState(patch: Partial<DashboardState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.pushMessage({ type: "state.patch", patch });
  }

  private pushToast(kind: "info" | "warning" | "error", message: string): void {
    if (kind === "info") {this.opts.pushMessage({ type: "toast.info", message });}
    else if (kind === "warning") {this.opts.pushMessage({ type: "toast.warning", message });}
    else {this.opts.pushMessage({ type: "toast.error", message });}
  }
}
