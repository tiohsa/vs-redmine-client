import * as vscode from "vscode";
import { getProjectSelection, setProjectSelection } from "../config/projectSelection";
import { getDefaultProjectId, getIncludeChildProjects } from "../config/settings";
import { listProjects } from "../redmine/projects";
import { getIssueDetail, listIssues } from "../redmine/issues";
import { applyTicketFilters, applyTicketSort, DEFAULT_TICKET_LIST_SETTINGS, TicketListSettings } from "../views/projectListSettings";
import { getOfflineSyncQueue, onOfflineSyncQueueChanged } from "../views/offlineSyncStore";
import { runOfflineSync } from "../commands/offlineSync";
import { syncUnsyncedFile } from "../commands/syncUnsyncedFile";
import { UnsyncedFileTreeItem } from "../views/unsyncedFilesView";
import { openTicketInBrowser } from "../commands/openInBrowser";
import { addCommentFromList } from "../commands/addCommentFromList";
import { editComment } from "../commands/editComment";
import { rememberTicketSummaries } from "../views/ticketSummaryStore";
import { showTicketPreview } from "../views/ticketPreview";
import { createTicketFromList } from "../commands/createTicketFromList";
import { createChildTicketFromList } from "../commands/createChildTicketFromList";
import { Ticket } from "../redmine/types";
import { buildTicketDashboardNodes, buildTicketDetail } from "./viewModels/ticketDashboardViewModel";
import { buildUnsyncedDashboardItems } from "./viewModels/unsyncedDashboardViewModel";
import { buildCommentDashboardItems } from "./viewModels/commentsDashboardViewModel";
import { buildSettingsDashboardViewModel } from "./viewModels/settingsDashboardViewModel";
import { DashboardStateStore } from "./DashboardStateStore";
import type { DashboardProjectNode, DashboardRequest, DashboardSettingsPatch, DashboardUnsyncedKey } from "./dashboardProtocol";

export interface DashboardControllerOptions {
  store: DashboardStateStore;
  notifySuccess: (requestId: string, msg: string) => void;
  notifyError: (requestId: string, msg: string) => void;
  notifyToast: (level: "info" | "warning" | "error" | "success", msg: string) => void;
  onTicketsRefreshed: () => void;
}

export class DashboardController {
  private tickets: Ticket[] = [];
  private projects: DashboardProjectNode[] = [];
  private totalCount = 0;
  private settings: TicketListSettings = { ...DEFAULT_TICKET_LIST_SETTINGS };
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly opts: DashboardControllerOptions) {
    this.disposables.push(
      { dispose: onOfflineSyncQueueChanged(() => this.refreshUnsynced()) },
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    await Promise.all([this.loadProjects(), this.loadTickets()]);
  }

  async handle(req: DashboardRequest): Promise<void> {
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
        await createTicketFromList();
        break;
      case "ticket.createChild": {
        const item = this.getTicketItem(req.parentTicketId);
        await createChildTicketFromList(item);
        break;
      }
      case "comment.add":
        await addCommentFromList(req.ticketId);
        break;
      case "comment.edit":
        await this.editTicketComment(req.ticketId, req.commentId);
        break;
      case "comment.reload":
        await this.loadComments(req.ticketId);
        break;
      case "unsynced.openLocalFile":
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(req.documentUri));
        break;
      case "unsynced.syncOne":
        await this.syncOne(req.key);
        this.opts.notifySuccess(req.requestId, "Sync complete.");
        break;
      case "unsynced.syncAll":
        await runOfflineSync();
        this.opts.notifySuccess(req.requestId, "Sync all complete.");
        this.opts.onTicketsRefreshed();
        break;
      case "settings.update":
        this.updateSettings(req.patch);
        break;
      case "settings.reset":
        this.settings = { ...DEFAULT_TICKET_LIST_SETTINGS };
        this.pushTickets();
        this.pushSettings();
        break;
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  // ── Private ────────────────────────────────────────────────────────────

  private async loadTickets(): Promise<void> {
    const { store } = this.opts;
    const selection = getProjectSelection();
    const fallback = Number(getDefaultProjectId());
    const projectId = selection.id ?? (Number.isNaN(fallback) ? undefined : fallback);

    store.update({
      selectedProject: selection.id
        ? { id: selection.id, name: selection.name }
        : undefined,
      includeChildProjects: getIncludeChildProjects(),
      loading: { ...store.getState().loading, tickets: true },
      errors: { ...store.getState().errors, tickets: undefined },
    });

    if (!projectId) {
      this.tickets = [];
      this.totalCount = 0;
      this.pushTickets();
      store.updateNested("loading", { tickets: false });
      return;
    }

    try {
      const result = await listIssues({
        projectId,
        includeChildProjects: getIncludeChildProjects(),
        limit: 50,
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
    const selection = getProjectSelection();
    if (!selection.id) {
      return;
    }
    try {
      const result = await listIssues({
        projectId: selection.id,
        includeChildProjects: getIncludeChildProjects(),
        limit: 50,
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
    // TicketTreeItem 相当のオブジェクトとして渡す
    await openTicketInBrowser({ ticket } as Parameters<typeof openTicketInBrowser>[0]);
  }

  private async editTicketComment(ticketId: number, commentId: number): Promise<void> {
    try {
      const detail = await getIssueDetail(ticketId);
      const comment = detail.comments.find((c) => c.id === commentId);
      if (comment) {
        await editComment(comment);
      }
    } catch {
      // ignore
    }
  }

  private async syncOne(key: DashboardUnsyncedKey): Promise<void> {
    const queue = getOfflineSyncQueue();
    let syncKey: UnsyncedFileTreeItem["syncKey"] | undefined;

    if (key.kind === "ticket" && key.ticketId !== undefined) {
      syncKey = { kind: "ticket", ticketId: key.ticketId };
    } else if (key.kind === "newTicket") {
      syncKey = { kind: "newTicket", documentUri: key.documentUri };
    } else if (key.kind === "comment") {
      syncKey = {
        kind: "comment",
        ticketId: key.ticketId ?? 0,
        commentId: key.commentId,
        documentUri: key.documentUri,
      };
    }

    if (!syncKey) {
      return;
    }

    void queue;
    await syncUnsyncedFile(
      { syncKey } as UnsyncedFileTreeItem,
      { onTicketCreated: () => this.opts.onTicketsRefreshed() },
    );
    this.refreshUnsynced();
  }

  private updateSettings(patch: DashboardSettingsPatch): void {
    if (patch.filters) {
      this.settings = { ...this.settings, filters: { ...this.settings.filters, ...patch.filters } };
    }
    if (patch.sort) {
      this.settings = { ...this.settings, sort: { ...this.settings.sort, ...patch.sort } };
    }
    if (patch.dueDate) {
      this.settings = { ...this.settings, dueDate: { ...this.settings.dueDate, ...patch.dueDate } };
    }
    this.pushTickets();
    this.pushSettings();
  }

  private refreshUnsynced(): void {
    const items = buildUnsyncedDashboardItems();
    this.opts.store.updateNested("unsynced", {
      totalCount: items.length,
      items,
    });
  }

  private pushTickets(): void {
    const filtered = applyTicketFilters(this.tickets, this.settings.filters);
    const sorted = applyTicketSort(filtered, this.settings.sort);
    const nodes = buildTicketDashboardNodes(sorted);
    this.opts.store.update({
      tickets: nodes,
      totalTicketCount: this.totalCount,
      loadedTicketCount: this.tickets.length,
    });
  }

  private pushSettings(): void {
    this.opts.store.update({
      settings: buildSettingsDashboardViewModel(this.settings),
    });
  }

  private getTicketItem(_ticketId: number): undefined {
    return undefined;
  }
}
