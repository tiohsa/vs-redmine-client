import * as vscode from "vscode";
import { listIssuePriorities, listIssueStatuses, listTrackers } from "../redmine/issues";
import { onOfflineSyncQueueChanged } from "../views/offlineSyncStore";
import { DashboardProjectService } from "./services/DashboardProjectService";
import { DashboardTicketService } from "./services/DashboardTicketService";
import { DashboardCommentService } from "./services/DashboardCommentService";
import { DashboardUnsyncedService } from "./services/DashboardUnsyncedService";
import { DashboardMetadataService } from "./services/DashboardMetadataService";
import { DashboardComposerService } from "./services/DashboardComposerService";
import { Ticket } from "../redmine/types";
import { buildTicketDetail } from "./viewModels/ticketDashboardViewModel";
import { DashboardStateStore } from "./DashboardStateStore";
import { SettingsController } from "./SettingsController";
import type {
  DashboardProjectNode,
  DashboardRequest,
  DashboardMetadataOptions,
  DashboardUnsyncedKey,
  TicketMetadataPatch,
} from "./dashboardProtocol";
import type { TicketSaveResult } from "../views/ticketSaveTypes";
import type { DashboardServiceContext } from "./services/DashboardServiceContext";
import { clearTicketSummaries } from "../views/ticketSummaryStore";

export interface ComposerSyncTestHooks {
  syncFn?: (editor: vscode.TextEditor) => Promise<TicketSaveResult>;
  getTicketIdFn?: (editor: vscode.TextEditor) => number | undefined;
  findEditorFn?: (draftUri: string) => vscode.TextEditor | undefined;
  openEditorFn?: (uri: vscode.Uri) => Promise<vscode.TextEditor>;
  findDocumentFn?: (draftUri: string) => vscode.TextDocument | undefined;
  fileExistsFn?: (path: string) => boolean;
  afterCreatedFn?: (createdId: number) => Promise<void>;
}

export interface DashboardControllerOptions {
  store: DashboardStateStore;
  notifyOperationStarted: (requestId: string, label?: string) => void;
  notifySuccess: (requestId: string, msg: string) => void;
  notifyError: (requestId: string, msg: string) => void;
  notifyToast: (level: "info" | "warning" | "error" | "success", msg: string) => void;
  onTicketsRefreshed: () => void;
  _composerSyncTestHooks?: ComposerSyncTestHooks;
}

export class DashboardController {
  private tickets: Ticket[] = [];
  private projects: DashboardProjectNode[] = [];
  private metadataOptionsLoaded = false;
  private totalCount = 0;
  private readonly settingsCtrl: SettingsController;
  private readonly projectService: DashboardProjectService;
  private readonly ticketService: DashboardTicketService;
  private readonly commentService: DashboardCommentService;
  private readonly unsyncedService: DashboardUnsyncedService;
  private readonly metadataService: DashboardMetadataService;
  private readonly composerService: DashboardComposerService;
  private readonly disposables: vscode.Disposable[] = [];
  private connectionGeneration = 0;

  constructor(private readonly opts: DashboardControllerOptions) {
    this.settingsCtrl = new SettingsController(opts.store);
    const context: DashboardServiceContext = {
      store: opts.store,
      notifyOperationStarted: opts.notifyOperationStarted,
      notifySuccess: opts.notifySuccess,
      notifyError: opts.notifyError,
      notifyToast: opts.notifyToast,
      onTicketsRefreshed: opts.onTicketsRefreshed,
    };
    this.projectService = new DashboardProjectService({
      context,
      getProjects: () => this.projects,
      setProjects: (projects) => {
        this.projects = projects;
      },
      resetTickets: (project) => {
        this.tickets = [];
        this.totalCount = 0;
        this.commentService?.invalidate();
        const state = opts.store.getState();
        opts.store.update({
          selectedProject: project
            ? { id: project.id, name: project.name }
            : undefined,
          tickets: [],
          totalTicketCount: 0,
          loadedTicketCount: 0,
          ticketFilterOptions: { assignees: [], statuses: state.ticketFilterOptions.statuses },
          selectedTicketId: undefined,
          selectedTicket: undefined,
          workPanel: undefined,
          comments: {
            ...state.comments,
            ticketId: undefined,
            items: [],
            loading: false,
            error: undefined,
          },
        });
      },
      loadTickets: () => this.loadTickets(),
    });
    this.ticketService = new DashboardTicketService({
      context,
      getResolvedProject: () => this.projectService.getResolvedProject(),
      getTickets: () => this.tickets,
      setTickets: (tickets) => {
        this.tickets = tickets;
      },
      getTotalCount: () => this.totalCount,
      setTotalCount: (count) => {
        this.totalCount = count;
      },
      getSettings: () => this.settingsCtrl.getSettings(),
      loadComments: (ticketId) => this.loadComments(ticketId),
      refreshUnsynced: () => this.refreshUnsynced(),
    });
    this.commentService = new DashboardCommentService(context, {
      selectTicket: (ticketId) => this.selectTicket(ticketId),
    });
    this.unsyncedService = new DashboardUnsyncedService({
      context,
      refreshTicketPresentation: () => this.refreshTicketPresentation(),
      loadComments: (ticketId) => this.loadComments(ticketId),
    });
    this.metadataService = new DashboardMetadataService({
      context,
      getTickets: () => this.tickets,
      isMetadataOptionsLoaded: () => this.metadataOptionsLoaded,
      refreshUnsynced: () => this.refreshUnsynced(),
      pushTickets: () => this.pushTickets(),
      openEditor: (ticketId) => this.openEditor(ticketId),
    });
    this.composerService = new DashboardComposerService({
      context,
      getResolvedProject: () => this.projectService.getResolvedProject(),
      getTickets: () => this.tickets,
      refreshUnsynced: () => this.refreshUnsynced(),
      loadTickets: () => this.loadTickets(),
      selectTicket: (ticketId) => this.selectTicket(ticketId),
    });
    this.disposables.push(
      { dispose: onOfflineSyncQueueChanged(() => this.refreshUnsynced()) },
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.settingsCtrl.pushSettings();
    await Promise.all([this.loadProjects(), this.loadMetadataOptions(), this.loadTickets()]);
  }

  async handle(req: DashboardRequest): Promise<void> {
    try {
      await this.handleRequest(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.opts.notifyError(req.requestId, vscode.l10n.t("Operation failed: {0}", msg));
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  refreshTickets(): void {
    void this.loadTickets();
  }

  refreshCommentsForTicket(ticketId: number): void {
    void this.loadComments(ticketId);
  }

  refreshUnsyncedPresentation(): void {
    this.unsyncedService.refreshUnsynced();
  }

  refreshSettings(): void {
    this.settingsCtrl.pushSettings();
  }

  selectProject(projectId: number): Promise<void> {
    return this.projectService.selectProject(projectId);
  }

  updateTicketSubject(ticketId: number, subject: string): void {
    const ticket = this.tickets.find((item) => item.id === ticketId);
    if (!ticket) {
      return;
    }
    ticket.subject = subject;
    this.pushTickets();
    const state = this.opts.store.getState();
    if (state.selectedTicketId === ticketId && state.selectedTicket) {
      this.opts.store.update({
        selectedTicket: { ...state.selectedTicket, subject },
      });
    }
  }

  notifyTicketChanged(): void {
    this.pushTickets();
  }

  async resetForConnectionChange(): Promise<void> {
    const generation = ++this.connectionGeneration;
    this.ticketService.invalidate();
    this.commentService.invalidate();
    this.metadataService.invalidate();
    this.tickets = [];
    this.projects = [];
    this.totalCount = 0;
    this.metadataOptionsLoaded = false;
    clearTicketSummaries();
    this.opts.store.update({
      projects: [],
      tickets: [],
      totalTicketCount: 0,
      loadedTicketCount: 0,
      selectedProject: undefined,
      selectedTicketId: undefined,
      selectedTicket: undefined,
      workPanel: undefined,
      editOptions: undefined,
      metadataOptions: { trackers: [], priorities: [], statuses: [] },
      unsynced: { totalCount: 0, items: [] },
      ticketFilterOptions: { assignees: [], statuses: [] },
      comments: { loading: false, items: [] },
      loading: { tickets: false, comments: false },
      errors: {},
    });
    await this.projectService.resetForConnectionChange();
    if (generation !== this.connectionGeneration) {
      return;
    }
    await this.initialize();
  }

  // ── Private request handler ────────────────────────────────────────────

  private async handleRequest(req: DashboardRequest): Promise<void> {
    switch (req.type) {
      case "dashboard.ready":
      case "dashboard.refresh":
        await Promise.all([this.loadProjects(), this.loadMetadataOptions(), this.loadTickets()]);
        break;
      case "project.select":
        await this.projectService.selectProject(req.projectId);
        break;
      case "project.toggleChildren":
        await this.projectService.toggleIncludeChildren(req.includeChildProjects);
        break;
      case "tickets.refresh":
        await this.loadTickets();
        break;
      case "tickets.searchAllProjects":
        await this.ticketService.searchAllProjects(req.query);
        break;
      case "tickets.loadMore":
        await this.loadMoreTickets();
        break;
      case "ticket.select":
        await this.selectTicket(req.ticketId);
        break;
      case "ticket.openEditor":
        void this.selectTicket(req.ticketId);
        await this.openEditor(req.ticketId);
        break;
      case "ticket.openBrowser":
        void this.selectTicket(req.ticketId);
        await this.openInBrowser(req.ticketId);
        break;
      case "ticket.create":
        await this.openNewTicketComposer();
        break;
      case "ticket.createChild":
        void this.selectTicket(req.parentTicketId);
        await this.openChildTicketComposer(req.parentTicketId);
        break;
      case "ticket.cancelDetail":
        this.cancelDetail();
        break;
      case "ticket.cancelComposer":
        this.cancelComposer();
        break;
      case "ticket.syncNewTicketDraftFromComposer":
        await this.handleSyncNewTicketDraftFromComposer(req.requestId);
        break;
      case "ticket.createDraftFromComposer":
        await this.createDraftFromComposer(req.requestId, req.values);
        break;
      case "ticket.metadata.update":
        await this.updateTicketMetadata(req.requestId, req.ticketId, req.patch);
        break;
      case "ticket.syncSelected":
        await this.handleSyncSelectedTicket(req.requestId, req.ticketId);
        break;
      case "comment.add":
        await this.commentService.addComment(req.ticketId);
        break;
      case "comment.edit":
        void this.selectTicket(req.ticketId);
        await this.editTicketComment(req.ticketId, req.commentId);
        break;
      case "comment.openBrowser":
        await this.openCommentInBrowser(req.ticketId, req.commentId, req.noteIndex);
        break;
      case "comment.reload":
        await this.loadComments(req.ticketId);
        break;
      case "unsynced.openLocalFile": {
        const uri = vscode.Uri.parse(req.documentUri);
        if (uri.scheme !== "file" && uri.scheme !== "vscode-userdata") {
          this.opts.notifyError(req.requestId, vscode.l10n.t("This URI cannot be opened."));
          return;
        }
        await vscode.commands.executeCommand("vscode.open", uri);
        break;
      }
      case "unsynced.syncOne":
        await this.handleSyncOne(req.requestId, req.key);
        break;
      case "unsynced.discardOne":
        await this.handleDiscardOne(req.requestId, req.key);
        break;
      case "unsynced.syncAll":
        await this.handleSyncAll(req.requestId);
        break;
      case "settings.update":
        this.settingsCtrl.updateTicketList(req.patch);
        this.pushTickets();
        this.opts.notifySuccess(req.requestId, vscode.l10n.t("Settings updated."));
        break;
      case "settings.reset":
        this.settingsCtrl.resetTicketList();
        this.pushTickets();
        this.opts.notifySuccess(req.requestId, vscode.l10n.t("Settings reset."));
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
      case "apiKey.set":
        await vscode.commands.executeCommand("redmine-client.setApiKey");
        this.settingsCtrl.pushSettings();
        break;
      case "apiKey.clear":
        await vscode.commands.executeCommand("redmine-client.clearApiKey");
        this.settingsCtrl.pushSettings();
        break;
    }
  }

  // ── Project resolution ─────────────────────────────────────────────────

  // ── Private ────────────────────────────────────────────────────────────

  private async loadTickets(): Promise<void> {
    await this.ticketService.loadTickets();
  }

  private async loadMoreTickets(): Promise<void> {
    await this.ticketService.loadMoreTickets();
  }

  private async loadProjects(): Promise<void> {
    await this.projectService.loadProjects();
  }

  private async loadMetadataOptions(): Promise<void> {
    const generation = this.connectionGeneration;
    try {
      const [trackers, priorities, statuses] = await Promise.all([
        listTrackers(),
        listIssuePriorities(),
        listIssueStatuses(),
      ]);
      if (generation !== this.connectionGeneration) {
        return;
      }
      const options: DashboardMetadataOptions = {
        trackers,
        priorities,
        statuses,
      };
      this.metadataOptionsLoaded = true;
      this.opts.store.update({ metadataOptions: options });
    } catch {
      if (generation !== this.connectionGeneration) {
        return;
      }
      this.metadataOptionsLoaded = false;
      this.opts.store.update({ metadataOptions: { trackers: [], priorities: [], statuses: [] } });
    }
  }

  private async selectTicket(ticketId: number): Promise<void> {
    await this.ticketService.selectTicket(ticketId);
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (ticket?.projectId) {
      void this.metadataService.loadEditOptions(ticketId, ticket.projectId);
    }
  }

  private async updateTicketMetadata(
    requestId: string,
    ticketId: number,
    patch: TicketMetadataPatch,
  ): Promise<void> {
    await this.metadataService.updateTicketMetadata(requestId, ticketId, patch);
  }

  private async loadComments(ticketId: number): Promise<void> {
    await this.commentService.loadComments(ticketId);
  }

  private async openEditor(ticketId: number): Promise<void> {
    await this.ticketService.openEditor(ticketId);
  }

  private async openInBrowser(ticketId: number): Promise<void> {
    await this.ticketService.openInBrowser(ticketId);
  }

  private async openCommentInBrowser(
    ticketId: number,
    commentId: number,
    noteIndex?: number,
  ): Promise<void> {
    await this.commentService.openCommentInBrowser(ticketId, commentId, noteIndex);
  }

  private async editTicketComment(ticketId: number, commentId: number): Promise<void> {
    await this.commentService.editTicketComment(ticketId, commentId);
  }

  private async handleSyncOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    await this.unsyncedService.handleSyncOne(requestId, key);
  }

  private async handleSyncSelectedTicket(requestId: string, ticketId: number): Promise<void> {
    await this.unsyncedService.handleSyncSelectedTicket(requestId, ticketId);
  }

  private async handleSyncNewTicketDraftFromComposer(requestId: string): Promise<void> {
    await this.composerService.handleSyncNewTicketDraftFromComposer(
      requestId,
      this.opts._composerSyncTestHooks,
    );
  }

  private async handleDiscardOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    await this.unsyncedService.handleDiscardOne(requestId, key);
  }

  private async handleSyncAll(requestId: string): Promise<void> {
    await this.unsyncedService.handleSyncAll(requestId);
  }

  private async openNewTicketComposer(): Promise<void> {
    await this.composerService.openNewTicketComposer();
  }

  private async openChildTicketComposer(parentTicketId: number): Promise<void> {
    await this.composerService.openChildTicketComposer(parentTicketId);
  }

  private cancelDetail(): void {
    const state = this.opts.store.getState();
    this.opts.store.update({
      selectedTicketId: undefined,
      selectedTicket: undefined,
      workPanel: undefined,
      comments: {
        ...state.comments,
        ticketId: undefined,
        items: [],
        loading: false,
        error: undefined,
      },
    });
  }

  private cancelComposer(): void {
    this.composerService.cancelComposer();
  }

  private async createDraftFromComposer(
    requestId: string,
    values: {
      tracker: string;
      priority: string;
      status: string;
      start_date?: string;
      due_date?: string;
      description?: string;
    },
  ): Promise<void> {
    await this.composerService.createDraftFromComposer(requestId, values);
  }

  private refreshUnsynced(): void {
    this.unsyncedService.refreshUnsynced();
  }

  private refreshTicketPresentation(): void {
    this.pushTickets();
    const selectedTicketId = this.opts.store.getState().selectedTicketId;
    if (selectedTicketId === undefined) {
      return;
    }
    const selectedTicket = this.tickets.find((ticket) => ticket.id === selectedTicketId);
    if (selectedTicket) {
      this.opts.store.update({ selectedTicket: buildTicketDetail(selectedTicket, this.tickets) });
    }
  }

  private pushTickets(): void {
    this.ticketService.pushTickets();
    const state = this.opts.store.getState();
    if (state.selectedTicketId === undefined) {
      return;
    }
    const visibleIds = new Set<number>();
    const stack = [...state.tickets];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      visibleIds.add(node.id);
      if (node.children.length > 0) {
        stack.push(...node.children);
      }
    }
    if (!visibleIds.has(state.selectedTicketId)) {
      this.opts.store.update({
        selectedTicketId: undefined,
        selectedTicket: undefined,
        workPanel: undefined,
        comments: { ...state.comments, ticketId: undefined, items: [], error: undefined },
      });
    }
  }
}
