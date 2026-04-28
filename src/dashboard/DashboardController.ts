import * as vscode from "vscode";
import { getProjectSelection, setProjectSelection } from "../config/projectSelection";
import { getDefaultProjectId, getIncludeChildProjects, getTicketListLimit } from "../config/settings";
import { listProjects } from "../redmine/projects";
import { getIssueDetail, listIssues } from "../redmine/issues";
import { applyTicketFilters, applyTicketSort } from "../views/projectListSettings";
import { onOfflineSyncQueueChanged } from "../views/offlineSyncStore";
import { runOfflineSync } from "../commands/offlineSync";
import type { OfflineSyncRunResult } from "../commands/offlineSync";
import { syncUnsyncedFile } from "../commands/syncUnsyncedFile";
import type { SyncUnsyncedFileResult } from "../commands/syncUnsyncedFile";
import { openTicketInBrowser } from "../commands/openInBrowser";
import { addCommentFromList } from "../commands/addCommentFromList";
import { editComment } from "../commands/editComment";
import { rememberTicketSummaries } from "../views/ticketSummaryStore";
import { showTicketPreview } from "../views/ticketPreview";
import { resolveNewTicketDraftContent } from "../views/ticketPreview";
import { buildNewChildTicketDraftContent, buildNewTicketDraftContent } from "../views/ticketDraftStore";
import { openNewTicketDraft } from "../commands/createTicketFromList";
import { showError } from "../utils/notifications";
import { Ticket } from "../redmine/types";
import type { UnsyncedFileSyncKey } from "../views/unsyncedFilesView";
import { buildTicketDashboardNodes, buildTicketDetail } from "./viewModels/ticketDashboardViewModel";
import { buildUnsyncedDashboardItems } from "./viewModels/unsyncedDashboardViewModel";
import { buildCommentDashboardItems } from "./viewModels/commentsDashboardViewModel";
import { DashboardStateStore } from "./DashboardStateStore";
import { SettingsController } from "./SettingsController";
import type { DashboardProjectNode, DashboardRequest, DashboardUnsyncedKey } from "./dashboardProtocol";
import { resolveCurrentProject, type ResolvedProject } from "./resolveProject";

export interface DashboardControllerOptions {
  store: DashboardStateStore;
  notifyOperationStarted: (requestId: string, label?: string) => void;
  notifySuccess: (requestId: string, msg: string) => void;
  notifyError: (requestId: string, msg: string) => void;
  notifyToast: (level: "info" | "warning" | "error" | "success", msg: string) => void;
  onTicketsRefreshed: () => void;
}

export class DashboardController {
  private tickets: Ticket[] = [];
  private projects: DashboardProjectNode[] = [];
  private totalCount = 0;
  private readonly settingsCtrl: SettingsController;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly opts: DashboardControllerOptions) {
    this.settingsCtrl = new SettingsController(opts.store);
    this.disposables.push(
      { dispose: onOfflineSyncQueueChanged(() => this.refreshUnsynced()) },
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.settingsCtrl.pushSettings();
    await Promise.all([this.loadProjects(), this.loadTickets()]);
  }

  async handle(req: DashboardRequest): Promise<void> {
    try {
      await this.handleRequest(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.opts.notifyError(req.requestId, `操作に失敗しました: ${msg}`);
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  // ── Private request handler ────────────────────────────────────────────

  private async handleRequest(req: DashboardRequest): Promise<void> {
    switch (req.type) {
      case "dashboard.ready":
      case "dashboard.refresh":
        await Promise.all([this.loadProjects(), this.loadTickets()]);
        break;
      case "project.select":
        await this.selectProject(req.projectId);
        break;
      case "project.toggleChildren":
        await this.toggleIncludeChildren(req.includeChildProjects);
        break;
      case "tickets.refresh":
        await this.loadTickets();
        break;
      case "tickets.loadMore":
        await this.loadMoreTickets();
        break;
      case "ticket.select":
        await this.selectTicket(req.ticketId);
        break;
      case "ticket.openEditor":
        await this.openEditor(req.ticketId);
        break;
      case "ticket.openBrowser":
        await this.openInBrowser(req.ticketId);
        break;
      case "ticket.create":
        await this.createTicketFromDashboard();
        break;
      case "ticket.createChild":
        await this.createChildTicketFromDashboard(req.parentTicketId);
        break;
      case "comment.add":
        await addCommentFromList(req.ticketId);
        break;
      case "comment.edit":
        await this.editTicketComment(req.ticketId, req.commentId);
        break;
      case "comment.reload":
        await this.loadComments(req.ticketId);
        break;
      case "unsynced.openLocalFile": {
        const uri = vscode.Uri.parse(req.documentUri);
        if (uri.scheme !== "file" && uri.scheme !== "vscode-userdata") {
          this.opts.notifyError(req.requestId, "この URI は開けません。");
          return;
        }
        await vscode.commands.executeCommand("vscode.open", uri);
        break;
      }
      case "unsynced.syncOne":
        await this.handleSyncOne(req.requestId, req.key);
        break;
      case "unsynced.syncAll":
        await this.handleSyncAll(req.requestId);
        break;
      case "settings.update":
        this.settingsCtrl.updateTicketList(req.patch);
        this.pushTickets();
        this.opts.notifySuccess(req.requestId, "設定を更新しました。");
        break;
      case "settings.reset":
        this.settingsCtrl.resetTicketList();
        this.pushTickets();
        this.opts.notifySuccess(req.requestId, "設定をリセットしました。");
        break;
      case "settings.updateEditorDefault":
        this.settingsCtrl.updateEditorDefault(req.field, req.value);
        break;
      case "settings.resetEditorDefaults":
        this.settingsCtrl.resetEditorDefaults(req.fields);
        break;
      case "settings.updateGeneral":
        await this.settingsCtrl.updateGeneral(req.patch);
        await this.loadTickets();
        break;
    }
  }

  // ── Project resolution ─────────────────────────────────────────────────

  private getResolvedProject(): ResolvedProject | undefined {
    const selection = getProjectSelection();
    return resolveCurrentProject({
      selectionId: selection.id,
      selectionName: selection.name,
      defaultProjectId: getDefaultProjectId(),
      projects: this.projects,
    });
  }

  // ── Private ────────────────────────────────────────────────────────────

  private async loadTickets(): Promise<void> {
    const { store } = this.opts;
    const project = this.getResolvedProject();

    store.update({
      selectedProject: project ? { id: project.id, name: project.name } : undefined,
      includeChildProjects: getIncludeChildProjects(),
      loading: { ...store.getState().loading, tickets: true },
      errors: { ...store.getState().errors, tickets: undefined },
    });

    if (!project) {
      this.tickets = [];
      this.totalCount = 0;
      this.pushTickets();
      store.updateNested("loading", { tickets: false });
      return;
    }

    try {
      const result = await listIssues({
        projectId: project.id,
        includeChildProjects: getIncludeChildProjects(),
        limit: getTicketListLimit(),
        offset: 0,
      });
      this.tickets = result.tickets;
      this.totalCount = result.totalCount;
      rememberTicketSummaries(this.tickets);
      this.refreshUnsynced();
      this.pushTickets();
      store.updateNested("loading", { tickets: false });
    } catch (err) {
      const msg = (err as Error).message;
      store.update({
        loading: { ...store.getState().loading, tickets: false },
        errors: { ...store.getState().errors, tickets: `Failed to load tickets: ${msg}` },
      });
    }
  }

  private async loadMoreTickets(): Promise<void> {
    if (this.tickets.length >= this.totalCount) {
      return;
    }
    const { store } = this.opts;
    const project = this.getResolvedProject();
    if (!project) {
      return;
    }
    try {
      const result = await listIssues({
        projectId: project.id,
        includeChildProjects: getIncludeChildProjects(),
        limit: getTicketListLimit(),
        offset: this.tickets.length,
      });
      this.tickets = [...this.tickets, ...result.tickets];
      this.totalCount = result.totalCount;
      rememberTicketSummaries(result.tickets);
      this.pushTickets();
    } catch (err) {
      const msg = (err as Error).message;
      store.updateNested("errors", { tickets: `Failed to load more: ${msg}` });
    }
  }

  private async loadProjects(): Promise<void> {
    try {
      const raw = await listProjects(true);
      this.projects = this.buildProjectNodes(raw);
      this.opts.store.update({ projects: this.projects });
    } catch {
      // プロジェクト読み込み失敗時は既存リストを維持する
    }
  }

  private buildProjectNodes(
    projects: Array<{ id: number; name: string; identifier: string; parentId?: number }>,
  ): DashboardProjectNode[] {
    const byId = new Map(projects.map((p) => [p.id, p]));
    const computeLevel = (id: number, visited = new Set<number>()): number => {
      if (visited.has(id)) { return 0; }
      visited.add(id);
      const p = byId.get(id);
      if (!p?.parentId) { return 0; }
      return 1 + computeLevel(p.parentId, visited);
    };
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      identifier: p.identifier,
      parentId: p.parentId,
      level: computeLevel(p.id),
    }));
  }

  private async selectProject(projectId: number): Promise<void> {
    const project = this.projects.find((p) => p.id === projectId);
    await setProjectSelection(projectId, project?.name ?? "");
    this.tickets = [];
    this.totalCount = 0;
    await this.loadTickets();
  }

  private async toggleIncludeChildren(include: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration("redmine-client")
      .update("includeChildProjects", include, vscode.ConfigurationTarget.Global);
    await this.loadTickets();
  }

  private async selectTicket(ticketId: number): Promise<void> {
    const { store } = this.opts;
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      return;
    }
    store.update({
      selectedTicketId: ticketId,
      selectedTicket: buildTicketDetail(ticket),
    });
    await this.loadComments(ticketId);
  }

  private async loadComments(ticketId: number): Promise<void> {
    const { store } = this.opts;
    store.updateNested("comments", { ticketId, loading: true, error: undefined });
    try {
      const detail = await getIssueDetail(ticketId);
      store.updateNested("comments", {
        loading: false,
        items: buildCommentDashboardItems(detail.comments),
      });
    } catch (err) {
      const msg = (err as Error).message;
      store.updateNested("comments", {
        loading: false,
        error: `Failed to load comments: ${msg}`,
      });
    }
  }

  private async openEditor(ticketId: number): Promise<void> {
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (ticket) {
      await showTicketPreview(ticket);
    }
  }

  private async openInBrowser(ticketId: number): Promise<void> {
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      return;
    }
    await openTicketInBrowser({ ticket });
  }

  private async editTicketComment(ticketId: number, commentId: number): Promise<void> {
    try {
      const detail = await getIssueDetail(ticketId);
      const comment = detail.comments.find((c) => c.id === commentId);
      if (comment) {
        await editComment(comment);
      }
    } catch {
      // コメント編集準備に失敗した場合は無視する
    }
  }

  private async handleSyncOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    if (key.kind === "comment" && key.ticketId === undefined) {
      this.opts.notifyError(requestId, "コメント同期キーが不正です。");
      return;
    }
    this.opts.notifyOperationStarted(requestId, "同期中...");
    const result = await this.syncOne(key);
    this.notifySyncOneResult(requestId, result);
  }

  private notifySyncOneResult(requestId: string, result: SyncUnsyncedFileResult | undefined): void {
    if (!result) {
      this.opts.notifyError(requestId, "同期に失敗しました。VS Code の通知をご確認ください。");
      return;
    }
    switch (result.status) {
      case "success":
        this.opts.notifySuccess(requestId, "同期が完了しました。");
        break;
      case "no_change":
        this.opts.notifySuccess(requestId, "変更はありませんでした。");
        break;
      case "conflict":
        this.opts.notifyError(requestId, "リモートの変更と競合しています。ファイルを開いて確認してください。");
        break;
      case "failed":
        this.opts.notifyError(requestId, "同期に失敗しました。VS Code の通知をご確認ください。");
        break;
    }
  }

  private async handleSyncAll(requestId: string): Promise<void> {
    this.opts.notifyOperationStarted(requestId, "全件同期中...");
    const result = await runOfflineSync();
    this.opts.onTicketsRefreshed();
    this.refreshUnsynced();
    this.notifySyncAllResult(requestId, result);
  }

  private notifySyncAllResult(requestId: string, result: OfflineSyncRunResult): void {
    switch (result.status) {
      case "nothing_to_sync":
        this.opts.notifySuccess(requestId, "同期するものはありません。");
        break;
      case "success":
        this.opts.notifySuccess(requestId, `全件同期が完了しました。同期: ${result.synced}件`);
        break;
      case "partial_failure":
        this.opts.notifyError(
          requestId,
          `一部の同期に失敗しました。成功: ${result.synced}件 / 失敗: ${result.failed}件 / 競合: ${result.conflicts}件`,
        );
        break;
      case "cancelled":
        this.opts.notifyError(
          requestId,
          `同期をキャンセルしました。成功: ${result.synced}件 / 未完了: ${result.failed}件`,
        );
        break;
      case "failed":
        this.opts.notifyError(requestId, "同期に失敗しました。VS Code の通知をご確認ください。");
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
      { onTicketCreated: () => this.opts.onTicketsRefreshed() },
    );
    this.refreshUnsynced();
    return result;
  }

  private async createTicketFromDashboard(): Promise<void> {
    const project = this.getResolvedProject();
    if (!project) {
      showError("プロジェクトを選択してからチケットを作成してください。");
      return;
    }
    const templateResolution = resolveNewTicketDraftContent({
      projectName: project.name,
    });
    if (templateResolution.isTemplateConfigured && templateResolution.errorMessage) {
      showError(templateResolution.errorMessage);
    }
    await openNewTicketDraft({
      content: templateResolution.content ?? buildNewTicketDraftContent({ projectId: project.id }),
      projectId: project.id,
    });
  }

  private async createChildTicketFromDashboard(parentTicketId: number): Promise<void> {
    const parent = this.tickets.find((t) => t.id === parentTicketId);
    if (!parent) {
      showError("親チケットが見つかりません。");
      return;
    }
    if (!parent.projectId) {
      showError("親チケットのプロジェクト情報が不足しています。");
      return;
    }

    const project = this.getResolvedProject();
    const templateResolution = resolveNewTicketDraftContent({
      projectName: project?.name,
    });
    if (templateResolution.isTemplateConfigured && templateResolution.errorMessage) {
      showError(templateResolution.errorMessage);
    }

    const baseContent = templateResolution.content ?? buildNewTicketDraftContent({ projectId: parent.projectId });
    await openNewTicketDraft({
      content: buildNewChildTicketDraftContent(parent, baseContent),
      projectId: parent.projectId,
    });
  }

  private refreshUnsynced(): void {
    const items = buildUnsyncedDashboardItems();
    this.opts.store.updateNested("unsynced", {
      totalCount: items.length,
      items,
    });
  }

  private pushTickets(): void {
    const settings = this.settingsCtrl.getSettings();
    const filtered = applyTicketFilters(this.tickets, settings.filters);
    const sorted = applyTicketSort(filtered, settings.sort);
    const nodes = buildTicketDashboardNodes(sorted);
    this.opts.store.update({
      tickets: nodes,
      totalTicketCount: this.totalCount,
      loadedTicketCount: this.tickets.length,
    });
  }
}
