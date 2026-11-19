import * as fs from "fs";
import * as vscode from "vscode";
import { listIssuePriorities, listIssueStatuses, listTrackers } from "../redmine/issues";
import { getCurrentUserId } from "../redmine/users";
import {
  addOfflineNewTicketAsync,
  getOfflineSyncQueue,
  isAbandoned,
  onOfflineSyncQueueChanged,
  sameDocumentIdentity,
} from "../views/offlineSyncStore";
import { DashboardProjectService } from "./services/DashboardProjectService";
import { DashboardTicketService } from "./services/DashboardTicketService";
import { DashboardCommentService } from "./services/DashboardCommentService";
import { DashboardUnsyncedService } from "./services/DashboardUnsyncedService";
import { DashboardMetadataService } from "./services/DashboardMetadataService";
import { DashboardComposerService } from "./services/DashboardComposerService";
import { Ticket } from "../redmine/types";
import {
  buildDraftTicketDashboardNodes,
  buildTicketDetail,
} from "./viewModels/ticketDashboardViewModel";
import { DashboardStateStore } from "./DashboardStateStore";
import { SettingsController } from "./SettingsController";
import type {
  DashboardDraftTicketNode,
  DashboardProjectNode,
  DashboardRequest,
  DashboardMetadataOptions,
  DashboardState,
  DashboardUnsyncedKey,
  TicketMetadataPatch,
} from "./dashboardProtocol";
import type { TicketSaveResult } from "../views/ticketSaveTypes";
import type { DashboardServiceContext } from "./services/DashboardServiceContext";
import {
  clearTicketSummaries,
  rememberTicketSummaries,
  restoreTicketSummaries,
  snapshotTicketSummaries,
} from "../views/ticketSummaryStore";
import type { SyncEngine } from "../app/syncEngine";
import {
  getConnectionScopeHash,
  getCurrentConnectionScope,
} from "../config/connectionScope";
import { getDefaultProjectId } from "../config/settings";
import { parseConfiguredProjectId } from "../config/projectSelection";
import { getTicketEditorDefaults } from "../views/ticketEditorDefaultsStore";
import {
  buildTicketEditorContent,
  parseTicketEditorContent,
} from "../views/ticketEditorContent";
import {
  applyEditorContent,
  findSubjectTextRange,
  resolveEditorStorageDir,
  withTrailingEditLines,
} from "../views/ticketPreview";
import { buildNewTicketDraftFilename } from "../views/editorFilename";
import {
  NEW_TICKET_DRAFT_ID,
  registerTicketEditor,
} from "../views/ticketEditorRegistry";
import { resolveEditorBaseDir } from "../utils/editorBaseDir";
import { refreshTicketEditorContexts } from "../app/editorEventController";
import { releaseSaveSync, suppressSaveSync } from "../views/saveSyncSuppression";

const isKnownUnsyncedDocumentUri = (documentUri: string): boolean => {
  const queue = getOfflineSyncQueue(getCurrentConnectionScope());
  return Array.from(queue.tickets.values()).some((ticket) =>
    sameDocumentIdentity(ticket.documentUri, documentUri),
  ) || queue.comments.some((comment) =>
    sameDocumentIdentity(comment.documentUri, documentUri),
  ) || queue.newTickets.some((ticket) =>
    sameDocumentIdentity(ticket.documentUri, documentUri),
  );
};

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
  notifySuccess: (requestId: string, msg: string, level?: "success" | "info" | "warning") => void;
  notifyError: (requestId: string, msg: string) => void;
  notifyToast: (level: "info" | "warning" | "error" | "success", msg: string) => void;
  onTicketsRefreshed: () => void;
  syncEngine?: SyncEngine;
  _composerSyncTestHooks?: ComposerSyncTestHooks;
  _metadataTestHooks?: {
    listTrackers?: typeof listTrackers;
    listIssuePriorities?: typeof listIssuePriorities;
    listIssueStatuses?: typeof listIssueStatuses;
    getCurrentUserId?: typeof getCurrentUserId;
  };
  _maintenanceTestHooks?: {
    confirmDashboardCacheReset?: () => Promise<boolean>;
  };
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
  private metadataLoadGeneration = 0;
  private quickDraftSeq = 0;

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
        this.ticketService?.invalidate(false);
        this.tickets = [];
        this.totalCount = 0;
        this.commentService?.invalidate();
        const state = opts.store.getState();
        opts.store.update({
          selectedProject: project
            ? { id: project.id, name: project.name }
            : undefined,
          tickets: [],
          draftTickets: this.buildCurrentDraftTickets(project ? project.id : null),
          totalTicketCount: 0,
          loadedTicketCount: 0,
          hasMoreTickets: false,
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
      loadComments: (ticketId, throwOnError) => this.loadComments(ticketId, throwOnError),
      refreshUnsynced: () => this.refreshUnsynced(),
      onSearchAccepted: () => {
        this.commentService.invalidate();
        this.metadataService.invalidate();
      },
    });
    this.commentService = new DashboardCommentService(context, {
      selectTicket: (ticketId) => this.selectTicket(ticketId),
    });
    this.unsyncedService = new DashboardUnsyncedService({
      context,
      refreshTicketPresentation: () => this.refreshTicketPresentation(),
      loadComments: (ticketId) => this.loadComments(ticketId),
      openTicketEditor: (ticketId) => this.ticketService.openEditor(ticketId),
      syncEngine: opts.syncEngine,
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
      syncEngine: opts.syncEngine,
    });
    this.disposables.push(
      { dispose: onOfflineSyncQueueChanged(() => this.refreshUnsynced()) },
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.settingsCtrl.pushSettings();
    await this.loadProjects();
    await Promise.all([this.loadMetadataOptions(), this.loadTickets()]);
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
    this.refreshUnsynced();
  }

  refreshSettings(): void {
    this.settingsCtrl.pushSettings();
  }

  selectProject(projectId: number): Promise<void> {
    this.ticketService.prepareSearch();
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
    this.refreshTicketPresentation();
    this.refreshUnsynced();
  }

  async resetForConnectionChange(): Promise<void> {
    const generation = ++this.connectionGeneration;
    this.metadataLoadGeneration++;
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
      draftTickets: [],
      totalTicketCount: 0,
      loadedTicketCount: 0,
      hasMoreTickets: false,
      selectedProject: undefined,
      ticketSearch: undefined,
      currentUserId: undefined,
      quickFilterCapabilities: { mine: "loading", open: "loading" },
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

  private async resetDashboardCache(requestId: string): Promise<void> {
    const confirmed = await this.confirmDashboardCacheReset();
    if (!confirmed) {
      return;
    }

    this.opts.notifyOperationStarted(requestId, vscode.l10n.t("Resetting Dashboard cache…"));
    const previous = this.opts.store.getState();
    const previousState = structuredClone(previous);
    const previousMetadataOptionsLoaded = this.metadataOptionsLoaded;
    const previousTickets = this.tickets;
    const previousProjects = this.projects;
    const previousTotalCount = this.totalCount;
    const previousPagination = this.ticketService.snapshotPagination();
    const previousTicketSummaries = snapshotTicketSummaries();
    const selectedDetailId = previous.workPanel?.mode === "detail"
      ? previous.workPanel.ticketId
      : undefined;

    this.projectService.invalidate();
    this.ticketService.invalidate(false);
    this.commentService.invalidate();
    this.metadataService.invalidate();
    // 同じ接続のメタデータと進行中の取得は、新しい取得を開始するまで有効。
    let outcome: { level: "success" | "info" | "error"; message: string } = {
      level: "info",
      message: vscode.l10n.t("Dashboard cache reset canceled because the view changed."),
    };

    try {
      await this.loadProjects(true);
      if (!this.ticketService.isPaginationSnapshotCurrent(previousPagination)) { return; }
      const results = await Promise.allSettled([
        this.loadMetadataOptions(true, true),
        this.loadTickets(true),
      ]);
      if (!this.ticketService.isPaginationSnapshotCurrent(previousPagination)) { return; }
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
      if (failures.length > 0) {
        throw new Error(failures.join("; "));
      }

      // Ticket filter options depend on both the refreshed ticket list and status metadata.
      this.pushTickets();
      if (selectedDetailId !== undefined && this.tickets.some((ticket) => ticket.id === selectedDetailId)) {
        await this.selectTicket(selectedDetailId, true);
      }
      if (!this.ticketService.isPaginationSnapshotCurrent(previousPagination)) { return; }
      this.refreshUnsynced();
      clearTicketSummaries();
      rememberTicketSummaries(this.tickets);
      outcome = { level: "success", message: vscode.l10n.t("Dashboard cache reset.") };
    } catch (err) {
      if (!this.ticketService.isPaginationSnapshotCurrent(previousPagination)) { return; }
      const reason = err instanceof Error ? err.message : String(err);
      const current = this.opts.store.getState();
      this.tickets = previousTickets;
      this.projects = previousProjects;
      this.totalCount = previousTotalCount;
      this.metadataOptionsLoaded = previousMetadataOptionsLoaded;
      this.ticketService.restorePagination(previousPagination);
      restoreTicketSummaries(previousTicketSummaries);
      this.opts.store.update({
        projects: previousState.projects,
        tickets: previousState.tickets,
        totalTicketCount: previousState.totalTicketCount,
        loadedTicketCount: previousState.loadedTicketCount,
        hasMoreTickets: previousState.hasMoreTickets,
        ticketSearch: previousState.ticketSearch,
        selectedProject: previousState.selectedProject,
        currentUserId: previousState.currentUserId,
        quickFilterCapabilities: previousState.quickFilterCapabilities,
        ticketFilterOptions: previousState.ticketFilterOptions,
        selectedTicketId: previousState.selectedTicketId,
        selectedTicket: previousState.selectedTicket,
        workPanel: previousState.workPanel,
        editOptions: previousState.editOptions,
        metadataOptions: previousState.metadataOptions,
        comments: previousState.comments,
        loading: { ...current.loading, tickets: false, moreTickets: false },
        errors: { ...current.errors, tickets: previousState.errors.tickets, moreTickets: previousState.errors.moreTickets },
      });
      outcome = { level: "error", message: vscode.l10n.t("Dashboard cache reset failed: {0}", reason) };
    } finally {
      // 中断を含む全経路で started に対応する終了通知を一度だけ送る。
      if (outcome.level === "error") {
        this.opts.notifyError(requestId, outcome.message);
      } else {
        this.opts.notifySuccess(requestId, outcome.message, outcome.level);
      }
      // RefreshUnsynced only rebuilds presentation from the existing stores.
      this.refreshUnsynced();
    }
  }

  private async confirmDashboardCacheReset(): Promise<boolean> {
    const testConfirmation = this.opts._maintenanceTestHooks?.confirmDashboardCacheReset;
    if (testConfirmation) {
      return testConfirmation();
    }
    const resetLabel = vscode.l10n.t("Reset Dashboard Cache");
    const result = await vscode.window.showWarningMessage(
      vscode.l10n.t("Reset Dashboard Cache?"),
      {
        modal: true,
        detail: vscode.l10n.t(
          "Projects, tickets, and Dashboard metadata will be reloaded from Redmine.\nLocal drafts, unsynced changes, recovery data, API keys, and settings will not be deleted.",
        ),
      },
      resetLabel,
      vscode.l10n.t("Cancel"),
    );
    return result === resetLabel;
  }

  // ── Private request handler ────────────────────────────────────────────

  private async handleRequest(req: DashboardRequest): Promise<void> {
    switch (req.type) {
      case "dashboard.ready":
        await Promise.all([this.loadProjects(), this.loadMetadataOptions(), this.loadTickets()]);
        break;
      case "dashboard.refresh":
        this.opts.notifyOperationStarted(req.requestId, vscode.l10n.t("Refreshing…"));
        try {
          await Promise.all([this.loadProjects(), this.loadMetadataOptions(), this.loadTickets()]);
          this.refreshUnsynced();
          this.opts.notifySuccess(req.requestId, vscode.l10n.t("Dashboard refreshed."), "info");
        } catch (error) {
          this.opts.notifyError(req.requestId, error instanceof Error ? error.message : String(error));
        }
        break;
      case "dashboard.resetCache":
        await this.resetDashboardCache(req.requestId);
        break;
      case "project.select":
        this.ticketService.prepareSearch(req.query);
        await this.projectService.selectProject(req.projectId);
        break;
      case "project.selectAll":
        this.ticketService.prepareSearch(req.query);
        await this.projectService.selectProject();
        break;
      case "project.toggleChildren":
        this.ticketService.prepareSearch();
        await this.projectService.toggleIncludeChildren(req.includeChildProjects);
        break;
      case "tickets.refresh":
        await this.loadTickets();
        break;
      case "tickets.searchAllProjects":
        await this.ticketService.searchAllProjects(req.query);
        break;
      case "tickets.search":
        await this.ticketService.searchTickets(req.query, req.scope);
        break;
      case "tickets.loadMore":
        await this.loadMoreTickets();
        break;
      case "ticket.select":
        await this.selectTicket(req.ticketId);
        await this.openEditor(req.ticketId, req.preserveFocus);
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
        await this.createQuickNewTicketDraft(req.requestId, req.projectId);
        break;
      case "ticket.openDraft":
        await this.openDraftTicket(req.requestId, req.queueId, req.documentUri, req.preserveFocus);
        break;
      case "ticket.syncDraft":
        await this.syncDraftTicket(req.requestId, req.queueId, req.documentUri);
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
      case "ticket.reviewConflict":
        await this.handleReviewTicketConflict(req.requestId, req.ticketId);
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
        if (uri.scheme !== "file" && uri.scheme !== "vscode-userdata" && uri.scheme !== "untitled") {
          this.opts.notifyError(req.requestId, vscode.l10n.t("This URI cannot be opened."));
          return;
        }
        if (!isKnownUnsyncedDocumentUri(req.documentUri)) {
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
      case "unsynced.abandonOne":
        await this.unsyncedService.handleAbandonOne(req.requestId, req.key);
        break;
      case "unsynced.forgetAbandoned":
        await this.unsyncedService.handleForgetAbandoned(req.requestId, req.key);
        break;
      case "unsynced.forgetAllAbandoned":
        await this.unsyncedService.handleForgetAllAbandoned(req.requestId);
        break;
      case "unsynced.startNewTicketEdit":
        await this.unsyncedService.handleStartNewTicketEdit(req.requestId, req.ticketId);
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
        await this.settingsCtrl.resetDisplaySettings();
        this.pushTickets();
        this.opts.notifySuccess(req.requestId, vscode.l10n.t("Settings reset."));
        break;
      case "settings.updateEditorDefault":
        this.settingsCtrl.updateEditorDefault(req.field, req.value);
        break;
      case "settings.resetEditorDefaults":
        this.settingsCtrl.resetEditorDefaults(req.fields);
        break;
      case "settings.updateConnection":
        await this.settingsCtrl.updateConnection(req.patch);
        break;
      case "settings.updateEditor":
        await this.settingsCtrl.updateEditor(req.patch);
        break;
      case "settings.updateGeneral":
        await this.settingsCtrl.updateGeneral(req.patch);
        break;
      case "settings.openJson":
        await vscode.commands.executeCommand("workbench.action.openSettingsJson");
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

  private async loadTickets(throwOnError = false): Promise<void> {
    await this.ticketService.loadTickets(throwOnError);
  }

  private async loadMoreTickets(): Promise<void> {
    await this.ticketService.loadMoreTickets();
  }

  private async loadProjects(throwOnError = false): Promise<void> {
    await this.projectService.loadProjects(throwOnError);
  }

  private async loadMetadataOptions(throwOnError = false, preserveExisting = false): Promise<void> {
    const connectionGeneration = this.connectionGeneration;
    const metadataGeneration = ++this.metadataLoadGeneration;
    const previous = this.opts.store.getState();
    const retainMetadata = preserveExisting && this.metadataOptionsLoaded;
    const isCurrent = () =>
      connectionGeneration === this.connectionGeneration &&
      metadataGeneration === this.metadataLoadGeneration;
    this.opts.store.update({
      currentUserId: undefined,
      quickFilterCapabilities: { mine: "loading", open: "loading" },
    });
    const resolveCurrentUserId = this.opts._metadataTestHooks?.getCurrentUserId ?? getCurrentUserId;
    const currentUserTask = Promise.resolve().then(resolveCurrentUserId).then((id) =>
      Number.isSafeInteger(id) && id > 0 ? id : undefined,
    );
    const metadataTask = Promise.all([
      (this.opts._metadataTestHooks?.listTrackers ?? listTrackers)(),
      (this.opts._metadataTestHooks?.listIssuePriorities ?? listIssuePriorities)(),
      (this.opts._metadataTestHooks?.listIssueStatuses ?? listIssueStatuses)(),
    ]);
    try {
      let options: DashboardMetadataOptions;
      let currentUserId: number | undefined;
      if (throwOnError) {
        const [metadata, refreshedUserId] = await Promise.all([metadataTask, currentUserTask]);
        options = { trackers: metadata[0], priorities: metadata[1], statuses: metadata[2] };
        currentUserId = refreshedUserId;
      } else {
        void currentUserTask.then(
          (id) => {
            if (isCurrent()) {
              this.opts.store.update({
                currentUserId: id,
                quickFilterCapabilities: {
                  ...this.opts.store.getState().quickFilterCapabilities,
                  mine: id === undefined ? "unavailable" : "available",
                },
              });
            }
          },
          () => {
            if (isCurrent()) {
              this.opts.store.update({
                currentUserId: undefined,
                quickFilterCapabilities: {
                  ...this.opts.store.getState().quickFilterCapabilities,
                  mine: "unavailable",
                },
              });
            }
          },
        );
        const [trackers, priorities, statuses] = await metadataTask;
        options = { trackers, priorities, statuses };
      }
      if (!isCurrent()) {
        return;
      }
      this.metadataOptionsLoaded = true;
      const quickFilterCapabilities: DashboardState["quickFilterCapabilities"] = {
        mine: throwOnError
          ? currentUserId === undefined
            ? "unavailable"
            : "available"
          : this.opts.store.getState().quickFilterCapabilities.mine,
        open: options.statuses.some((status) => typeof status.isClosed === "boolean")
          ? "available"
          : "unavailable",
      };
      this.opts.store.update({
        metadataOptions: options,
        quickFilterCapabilities,
        ...(throwOnError ? { currentUserId } : {}),
      });
    } catch (err) {
      if (!isCurrent()) {
        return;
      }
      if (retainMetadata) {
        this.opts.store.update({
          currentUserId: previous.currentUserId,
          quickFilterCapabilities: previous.quickFilterCapabilities,
        });
      } else {
        this.metadataOptionsLoaded = false;
        this.opts.store.update({
          metadataOptions: { trackers: [], priorities: [], statuses: [] },
          quickFilterCapabilities: {
            mine: throwOnError ? "unavailable" : this.opts.store.getState().quickFilterCapabilities.mine,
            open: "unavailable",
          },
        });
      }
      if (throwOnError) {
        throw err;
      }
    }
  }

  private async selectTicket(ticketId: number, throwOnLoadError = false): Promise<void> {
    await this.ticketService.selectTicket(ticketId, throwOnLoadError);
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (ticket?.projectId) {
      const editOptions = this.metadataService.loadEditOptions(ticketId, ticket.projectId, throwOnLoadError);
      if (throwOnLoadError) {
        await editOptions;
      } else {
        void editOptions;
      }
    }
  }

  private async updateTicketMetadata(
    requestId: string,
    ticketId: number,
    patch: TicketMetadataPatch,
  ): Promise<void> {
    await this.metadataService.updateTicketMetadata(requestId, ticketId, patch);
  }

  private async loadComments(ticketId: number, throwOnError = false): Promise<void> {
    await this.commentService.loadComments(ticketId, throwOnError);
  }

  private async openEditor(ticketId: number, preserveFocus?: boolean): Promise<void> {
    await this.ticketService.openEditor(ticketId, preserveFocus);
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

  private async handleReviewTicketConflict(requestId: string, ticketId: number): Promise<void> {
    await this.unsyncedService.handleReviewConflict(requestId, ticketId);
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

  private buildCurrentDraftTickets(
    projectIdOverride?: number | null,
  ): DashboardDraftTicketNode[] {
    const state = this.opts.store.getState();
    const selectedProjectId =
      projectIdOverride === undefined
        ? state.selectedProject?.id
        : (projectIdOverride ?? undefined);
    return buildDraftTicketDashboardNodes({
      selectedProjectId,
      includeChildProjects: state.includeChildProjects,
      projects: this.projects,
    });
  }

  public async createNewTicketDraft(): Promise<void> {
    await this.createQuickNewTicketDraft("command-create-ticket");
  }

  private async createQuickNewTicketDraft(
    requestId: string,
    requestedProjectId?: number,
  ): Promise<void> {
    try {
      const state = this.opts.store.getState();
      const projectId =
        requestedProjectId ??
        state.selectedProject?.id ??
        parseConfiguredProjectId(getDefaultProjectId());
      const connectionScope = getCurrentConnectionScope();
      const scopeHash = getConnectionScopeHash(connectionScope);
      const defaults = getTicketEditorDefaults();
      const metadata = {
        tracker:
          defaults.metadata.tracker ||
          state.metadataOptions.trackers[0]?.name ||
          "",
        priority:
          defaults.metadata.priority ||
          state.metadataOptions.priorities[0]?.name ||
          "",
        status:
          defaults.metadata.status ||
          state.metadataOptions.statuses[0]?.name ||
          "",
        assignee: defaults.metadata.assignee || undefined,
        due_date: defaults.metadata.due_date || "",
        start_date: defaults.metadata.start_date || "",
        done_ratio: defaults.metadata.done_ratio ?? 0,
      };
      const subject =
        defaults.subject?.trim() || vscode.l10n.t("Enter new ticket subject");
      const description =
        defaults.description || vscode.l10n.t("Describe the ticket details here.");
      const content = withTrailingEditLines(
        buildTicketEditorContent({
          subject,
          description,
          metadata,
          controlFields: {
            mode: "ticket-create",
            ...(projectId !== undefined ? { project_id: projectId } : {}),
          },
        }),
      );
      const draftId = `draft-${Date.now()}-${++this.quickDraftSeq}`;
      const storageDir = resolveEditorStorageDir({ connectionScope }).uri;
      let fileUri: vscode.Uri;
      if (storageDir) {
        await vscode.workspace.fs.createDirectory(storageDir);
        fileUri = vscode.Uri.joinPath(
          storageDir,
          buildNewTicketDraftFilename(undefined, draftId),
        );
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf8"));
      } else {
        fileUri = vscode.Uri.parse(
          `untitled:${buildNewTicketDraftFilename(scopeHash, draftId)}`,
        );
      }
      const document = await vscode.workspace.openTextDocument(fileUri);
      const editor = await vscode.window.showTextDocument(document, { preview: false });
      if (fileUri.scheme === "untitled") {
        await applyEditorContent(editor, content);
      }
      registerTicketEditor(
        NEW_TICKET_DRAFT_ID,
        editor,
        "primary",
        "ticket",
        projectId,
        connectionScope,
      );
      refreshTicketEditorContexts(editor);
      const subjectRange = findSubjectTextRange(editor.document.getText());
      if (subjectRange) {
        const start = new vscode.Position(subjectRange.line, subjectRange.startChar);
        const end = new vscode.Position(subjectRange.line, subjectRange.endChar);
        editor.selection = new vscode.Selection(start, end);
        editor.revealRange(new vscode.Range(start, end));
      }
      await addOfflineNewTicketAsync(
        {
          content: editor.document.getText(),
          projectId,
          documentUri: editor.document.uri.toString(),
          baseDir: resolveEditorBaseDir({ editor }),
        },
        connectionScope,
      );
      this.refreshUnsynced();
      this.pushTickets();
    } catch (error) {
      this.opts.notifyError(
        requestId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async openDraftTicket(
    requestId: string,
    queueId: string,
    documentUri: string,
    preserveFocus = false,
  ): Promise<void> {
    const scope = getCurrentConnectionScope();
    const entry = getOfflineSyncQueue(scope).newTickets.find(
      (candidate) =>
        candidate.queueId === queueId &&
        sameDocumentIdentity(candidate.documentUri, documentUri) &&
        !isAbandoned(candidate),
    );
    if (!entry || !entry.documentUri) {
      this.opts.notifyError(requestId, vscode.l10n.t("This URI cannot be opened."));
      return;
    }
    const openDoc = vscode.workspace.textDocuments.find((doc) =>
      sameDocumentIdentity(doc.uri.toString(), entry.documentUri),
    );
    let document: vscode.TextDocument;
    let shouldApplyStoredContent = false;
    if (openDoc) {
      document = openDoc;
    } else {
      const uri = vscode.Uri.parse(entry.documentUri);
      if (uri.scheme !== "file" && uri.scheme !== "vscode-userdata" && uri.scheme !== "untitled") {
        this.opts.notifyError(requestId, vscode.l10n.t("This URI cannot be opened."));
        return;
      }
      if (uri.scheme === "file" && !fs.existsSync(uri.fsPath)) {
        this.opts.notifyError(requestId, vscode.l10n.t("This URI cannot be opened."));
        return;
      }
      document = await vscode.workspace.openTextDocument(uri);
      shouldApplyStoredContent = uri.scheme === "untitled";
    }
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus,
    });
    if (
      shouldApplyStoredContent &&
      editor.document.getText().length === 0 &&
      entry.content.length > 0
    ) {
      await applyEditorContent(editor, entry.content);
    }
    registerTicketEditor(
      NEW_TICKET_DRAFT_ID,
      editor,
      "primary",
      "ticket",
      entry.projectId,
      scope,
    );
    refreshTicketEditorContexts(editor);
  }

  private async syncDraftTicket(
    requestId: string,
    queueId: string,
    documentUri: string,
  ): Promise<void> {
    const scope = getCurrentConnectionScope();
    const entry = getOfflineSyncQueue(scope).newTickets.find(
      (candidate) =>
        candidate.queueId === queueId &&
        sameDocumentIdentity(candidate.documentUri, documentUri) &&
        !isAbandoned(candidate),
    );
    if (!entry || !entry.documentUri) {
      this.opts.notifyError(
        requestId,
        vscode.l10n.t("Queue entry for this new ticket not found."),
      );
      return;
    }
    if (
      (entry.phase ?? "queued") === "queued" &&
      !entry.createdIssueId &&
      !entry.disposition &&
      (!entry.effects || entry.effects.length === 0)
    ) {
      const openDoc = vscode.workspace.textDocuments.find((doc) =>
        sameDocumentIdentity(doc.uri.toString(), entry.documentUri),
      );
      if (openDoc) {
        const liveContent = openDoc.getText();
        let latestProjectId = entry.projectId;
        try {
          const parsed = parseTicketEditorContent(liveContent, {
            allowEmptyStatus: true,
            allowMissingMetadata: true,
            allowMissingSubject: true,
            fallbackMetadata: { tracker: "", priority: "", status: "", due_date: "", start_date: "" },
          });
          latestProjectId = parsed.controlFields?.project_id ?? entry.projectId;
        } catch {
          latestProjectId = entry.projectId;
        }
        if (liveContent !== entry.content || latestProjectId !== entry.projectId) {
          await addOfflineNewTicketAsync(
            {
              content: liveContent,
              projectId: latestProjectId,
              documentUri: entry.documentUri,
              baseDir: entry.baseDir,
              preparationFailure: undefined,
            },
            scope,
          );
        }
        if (openDoc.isDirty && openDoc.uri.scheme === "file") {
          const docUriStr = openDoc.uri.toString();
          suppressSaveSync(docUriStr);
          try {
            await openDoc.save();
          } finally {
            releaseSaveSync(docUriStr);
          }
        }
      }
    }
    await this.unsyncedService.handleSyncOne(requestId, {
      kind: "newTicket",
      queueId: entry.queueId,
      documentUri: entry.documentUri,
    });
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
      assigned_to?: string;
      start_date?: string;
      due_date?: string;
      description?: string;
    },
  ): Promise<void> {
    await this.composerService.createDraftFromComposer(requestId, values);
  }

  private refreshUnsynced(): void {
    this.unsyncedService.refreshUnsynced();
    this.opts.store.update({ draftTickets: this.buildCurrentDraftTickets() });
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
    this.opts.store.update({ draftTickets: this.buildCurrentDraftTickets() });
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
