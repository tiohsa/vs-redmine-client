import * as vscode from "vscode";
import {
  getOfflineSyncQueue,
  onOfflineSyncQueueChanged,
  sameDocumentIdentity,
} from "../views/offlineSyncStore";
import {
  onTicketDraftSaved,
  type TicketDraftSavedEvent,
} from "../views/ticketDraftStore";
import { DashboardProjectService } from "./services/DashboardProjectService";
import { DashboardTicketService } from "./services/DashboardTicketService";
import { DashboardCommentService } from "./services/DashboardCommentService";
import { DashboardUnsyncedService } from "./services/DashboardUnsyncedService";
import { DashboardMetadataService } from "./services/DashboardMetadataService";
import { DashboardComposerService } from "./services/DashboardComposerService";
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
} from "./dashboardProtocol";
import type { TicketSaveResult } from "../views/ticketSaveTypes";
import type { DashboardServiceContext } from "./services/DashboardServiceContext";
import type { SyncEngine } from "../app/syncEngine";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { runWithConnectionScope } from "../redmine/client";
import { deleteIssue, getIssueDetail } from "../redmine/issues";
import { updateComment } from "../redmine/comments";
import { RedmineHttpError } from "../redmine/httpError";
import {
  assertCanDelete,
  getTicketIdsWithPendingChanges,
  runProtectedDelete,
} from "./services/dashboardDeletionProtection";
import { getPendingChangeReview } from "./services/dashboardPendingDeletionChanges";
import { browserTargetForUri } from "../app/browserCommandTarget";
import { scheduleTask } from "../packages/framework-core";
import { onActiveSyncChanged } from "../app/ticketSync/syncDeletionGuard";
import { DashboardDataService, type DashboardDataCache, type DashboardMetadataTestHooks } from "./services/DashboardDataService";
import { DashboardDraftService } from "./services/DashboardDraftService";
import { collectTicketNodeIds, DashboardSelectionService } from "./services/DashboardSelectionService";
import { confirmPendingChangeReview, DashboardDeletionService } from "../layers/extension-host/features/delete-redmine-items";

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
  revealUnsyncedView?: () => void;
  syncEngine?: SyncEngine;
  _composerSyncTestHooks?: ComposerSyncTestHooks;
  _metadataTestHooks?: DashboardMetadataTestHooks;
  _maintenanceTestHooks?: {
    confirmDashboardCacheReset?: () => Promise<boolean>;
  };
}

export class DashboardController {
  private readonly cache: DashboardDataCache = { tickets: [], projects: [], totalCount: 0 };
  private boundConnectionScope = getCurrentConnectionScope();
  private readonly settingsCtrl: SettingsController;
  private readonly projectService: DashboardProjectService;
  private readonly ticketService: DashboardTicketService;
  private readonly commentService: DashboardCommentService;
  private readonly unsyncedService: DashboardUnsyncedService;
  private readonly metadataService: DashboardMetadataService;
  private readonly composerService: DashboardComposerService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly dataService: DashboardDataService;
  private readonly draftService: DashboardDraftService;
  private readonly selectionService: DashboardSelectionService;
  private readonly deletionService: DashboardDeletionService;

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
      getProjects: () => this.cache.projects,
      setProjects: (projects) => {
        this.cache.projects = projects;
      },
      resetTickets: (project) => {
        this.ticketService?.invalidate(false);
        this.cache.tickets = [];
        this.cache.totalCount = 0;
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
            selectedCommentId: undefined,
            selectedCommentUri: undefined,
            items: [],
            loading: false,
            error: undefined,
          },
        });
      },
      loadTickets: () => this.ticketService.loadTickets(),
    });
    this.ticketService = new DashboardTicketService({
      context,
      getResolvedProject: () => this.projectService.getResolvedProject(),
      getTickets: () => this.cache.tickets,
      setTickets: (tickets) => {
        this.cache.tickets = tickets;
      },
      getTotalCount: () => this.cache.totalCount,
      setTotalCount: (count) => {
        this.cache.totalCount = count;
      },
      getSettings: () => this.settingsCtrl.getSettings(),
      loadComments: (ticketId, throwOnError, selection) =>
        this.commentService.loadComments(ticketId, throwOnError, selection),
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
      loadComments: (ticketId) => this.commentService.loadComments(ticketId),
      openTicketEditor: (ticketId) => this.ticketService.openEditor(ticketId),
      revealCreatedTickets: (ticketIds) => this.revealCreatedTickets(ticketIds),
      revealCreatedComment: (ticketId, commentId, options) =>
        this.revealCreatedComment(ticketId, commentId, options),
      syncEngine: opts.syncEngine,
    });
    this.metadataService = new DashboardMetadataService({
      context,
      getTickets: () => this.cache.tickets,
      isMetadataOptionsLoaded: () => this.dataService.hasMetadataOptions,
      refreshUnsynced: () => this.refreshUnsynced(),
      pushTickets: () => this.pushTickets(),
      openEditor: (ticketId) => this.ticketService.openEditor(ticketId),
    });
    this.composerService = new DashboardComposerService({
      context,
      getResolvedProject: () => this.projectService.getResolvedProject(),
      getTickets: () => this.cache.tickets,
      refreshUnsynced: () => this.refreshUnsynced(),
      loadTickets: () => this.ticketService.loadTickets(),
      selectTicket: (ticketId) => this.selectTicket(ticketId),
      revealCreatedTickets: (ticketIds, options) => this.revealCreatedTickets(ticketIds, options),
      syncEngine: opts.syncEngine,
    });
    this.dataService = new DashboardDataService({
      context,
      cache: this.cache,
      projectService: this.projectService,
      ticketService: this.ticketService,
      commentService: this.commentService,
      metadataService: this.metadataService,
      metadataHooks: opts._metadataTestHooks,
      confirmCacheReset: opts._maintenanceTestHooks?.confirmDashboardCacheReset,
      pushTickets: () => this.pushTickets(),
      selectTicket: (ticketId, throwOnLoadError) => this.selectTicket(ticketId, throwOnLoadError),
      refreshUnsynced: () => this.refreshUnsynced(),
    });
    this.draftService = new DashboardDraftService({
      context,
      onDraftCreated: () => {
        this.refreshUnsynced();
        this.pushTickets();
      },
      syncDraft: (requestId, key) => this.unsyncedService.handleSyncOne(requestId, key),
    });
    this.selectionService = new DashboardSelectionService({
      store: opts.store,
      cache: this.cache,
      dataService: this.dataService,
      projectService: this.projectService,
      ticketService: this.ticketService,
      commentService: this.commentService,
      metadataService: this.metadataService,
    });
    this.deletionService = new DashboardDeletionService({
      getIssueDetail,
      deleteIssue,
      clearJournalNotes: (journalId) => updateComment(journalId, ""),
      getConnectionScope: getCurrentConnectionScope,
      withConnectionScope: runWithConnectionScope,
      getHttpStatusCode: (error) => error instanceof RedmineHttpError ? error.statusCode : undefined,
      getConnectionGeneration: () => getCurrentConnectionScope() === this.boundConnectionScope
        ? opts.store.getState().connectionGeneration
        : -1,
      assertCanDelete,
      runProtectedDelete,
      getPendingTicketIds: getTicketIdsWithPendingChanges,
      getPendingChangeReview,
      reviewPendingChanges: confirmPendingChangeReview,
      openUnsynced: (ids) => {
        this.unsyncedService.revealPendingChanges(ids);
        opts.revealUnsyncedView?.();
      },
      refreshTickets: async (ticketIds) => {
        this.ticketService.removeDeletedTickets(ticketIds);
        await this.ticketService.loadTickets();
      },
      refreshComments: async (ticketId, commentId) => {
        this.commentService.removeDeletedComment(ticketId, commentId);
        await this.commentService.loadComments(ticketId);
      },
      clearSelectedTicket: (ticketId) => {
        if (opts.store.getState().selectedTicketId === ticketId) { this.cancelDetail(); }
      },
      clearSelectedComment: (ticketId, commentId) => {
        const state = opts.store.getState();
        if (state.selectedTicketId === ticketId && state.comments.selectedCommentId === commentId) {
          this.commentService.selectComment(ticketId, {});
        }
      },
      notifyError: opts.notifyError,
      notifySuccess: opts.notifySuccess,
    });
    let cancelPendingRefresh: (() => void) | undefined;
    const schedulePendingRefresh = (): void => {
      cancelPendingRefresh?.();
      cancelPendingRefresh = scheduleTask(() => {
        cancelPendingRefresh = undefined;
        this.unsyncedService.refreshUnsynced();
      }, 100);
    };
    const refreshDocumentChanges = (document: vscode.TextDocument): void => {
      const scope = getCurrentConnectionScope();
      if (browserTargetForUri(document.uri, scope)?.connectionScope === scope) { schedulePendingRefresh(); }
    };
    this.disposables.push(
      { dispose: () => cancelPendingRefresh?.() },
      vscode.workspace.onDidOpenTextDocument(refreshDocumentChanges),
      vscode.workspace.onDidChangeTextDocument(event => refreshDocumentChanges(event.document)),
      vscode.workspace.onDidSaveTextDocument(refreshDocumentChanges),
      vscode.workspace.onDidCloseTextDocument(refreshDocumentChanges),
      vscode.window.onDidChangeActiveTextEditor(() => schedulePendingRefresh()),
      onActiveSyncChanged((scope) => { if (scope === getCurrentConnectionScope()) { schedulePendingRefresh(); } }),
      { dispose: onOfflineSyncQueueChanged(() => this.refreshUnsynced()) },
      { dispose: onTicketDraftSaved((event) => this.handleTicketDraftSaved(event)) },
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.settingsCtrl.pushSettings();
    this.refreshUnsynced();
    await this.projectService.loadProjects();
    await Promise.all([this.dataService.loadMetadataOptions(), this.ticketService.loadTickets()]);
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
    void this.ticketService.loadTickets();
  }

  revealCreatedTickets(ticketIds: readonly number[], options?: { connectionScope?: string }): Promise<void> {
    return this.selectionService.revealCreatedTickets(ticketIds, options);
  }

  revealCreatedComment(ticketId: number, commentId: number, options?: { connectionScope?: string }): Promise<void> {
    return this.selectionService.revealCreatedComment(ticketId, commentId, options);
  }

  refreshCommentsForTicket(ticketId: number): void {
    void this.commentService.loadComments(ticketId);
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
    const ticket = this.cache.tickets.find((item) => item.id === ticketId);
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

  resetForConnectionChange(): Promise<void> {
    this.boundConnectionScope = getCurrentConnectionScope();
    return this.dataService.resetForConnectionChange(() => this.initialize());
  }

  // ── Private request handler ────────────────────────────────────────────

  private async handleRequest(req: DashboardRequest): Promise<void> {
    switch (req.type) {
      case "dashboard.ready":
        await this.dataService.loadAll();
        break;
      case "dashboard.refresh":
        await this.dataService.refresh(req.requestId);
        break;
      case "dashboard.resetCache":
        await this.dataService.resetDashboardCache(req.requestId);
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
        await this.ticketService.loadTickets();
        break;
      case "tickets.searchAllProjects":
        await this.ticketService.searchAllProjects(req.query);
        break;
      case "tickets.search":
        await this.ticketService.searchTickets(req.query, req.scope);
        break;
      case "tickets.loadMore":
        await this.ticketService.loadMoreTickets();
        break;
      case "ticket.select":
        await this.selectTicket(req.ticketId);
        await this.ticketService.openEditor(req.ticketId, req.preserveFocus);
        break;
      case "ticket.openEditor":
        void this.selectTicket(req.ticketId);
        await this.ticketService.openEditor(req.ticketId);
        break;
      case "ticket.openBrowser":
        void this.selectTicket(req.ticketId);
        await this.ticketService.openInBrowser(req.ticketId);
        break;
      case "deleteTicket":
        await this.deletionService.deleteTicket(req);
        break;
      case "deleteComment":
        await this.deletionService.deleteComment(req);
        break;
      case "ticket.create":
        await this.draftService.createQuickNewTicketDraft(req.requestId, req.projectId);
        break;
      case "ticket.openDraft":
        await this.draftService.openDraftTicket(req.requestId, req.queueId, req.documentUri, req.preserveFocus);
        break;
      case "ticket.syncDraft":
        await this.draftService.syncDraftTicket(req.requestId, req.queueId, req.documentUri);
        break;
      case "ticket.createChild":
        void this.selectTicket(req.parentTicketId);
        await this.composerService.openChildTicketComposer(req.parentTicketId);
        break;
      case "ticket.cancelDetail":
        this.cancelDetail();
        break;
      case "ticket.cancelComposer":
        this.composerService.cancelComposer();
        break;
      case "ticket.syncNewTicketDraftFromComposer":
        await this.composerService.handleSyncNewTicketDraftFromComposer(req.requestId, this.opts._composerSyncTestHooks);
        break;
      case "ticket.createDraftFromComposer":
        await this.composerService.createDraftFromComposer(req.requestId, req.values);
        break;
      case "ticket.metadata.update":
        await this.metadataService.updateTicketMetadata(req.requestId, req.ticketId, req.patch);
        break;
      case "ticket.syncSelected":
        await this.unsyncedService.handleSyncSelectedTicket(req.requestId, req.ticketId);
        break;
      case "ticket.reviewConflict":
        await this.unsyncedService.handleReviewConflict(req.requestId, req.ticketId);
        break;
      case "comment.add":
        await this.commentService.addComment(req.ticketId);
        break;
      case "comment.edit":
        if (this.opts.store.getState().selectedTicketId === req.ticketId) {
          this.commentService.selectComment(req.ticketId, { commentId: req.commentId });
        } else {
          void this.selectTicket(req.ticketId, false, { commentId: req.commentId });
        }
        await this.commentService.editTicketComment(req.ticketId, req.commentId);
        break;
      case "comment.openBrowser":
        await this.commentService.openCommentInBrowser(req.ticketId, req.commentId);
        break;
      case "comment.syncSelected":
        await this.unsyncedService.handleSyncSelectedComment(req.requestId, {
          ticketId: req.ticketId,
          commentId: req.commentId,
          documentUri: req.documentUri,
        });
        break;
      case "comment.reload":
        await this.commentService.loadComments(req.ticketId);
        break;
      case "unsynced.openPendingChange": {
        if (this.boundConnectionScope !== getCurrentConnectionScope()) {
          throw new Error(vscode.l10n.t("This pending change is no longer available. Refresh Unsynced and try again."));
        }
        await this.unsyncedService.openPendingChange(req.itemId);
        break;
      }
      case "unsynced.discardPendingChange": {
        const scope = getCurrentConnectionScope();
        if (this.boundConnectionScope !== scope) {
          throw new Error(vscode.l10n.t("This pending change is no longer available. Refresh Unsynced and try again."));
        }
        const result = await this.unsyncedService.discardPendingChange(req.itemId);
        if (result === "discarded") {
          if (getCurrentConnectionScope() === scope) { this.notifyTicketChanged(); }
          this.opts.notifySuccess(req.requestId, vscode.l10n.t("Draft discarded."));
        } else {
          this.opts.notifySuccess(req.requestId, vscode.l10n.t("Operation cancelled. Saved changes were retained."), "info");
        }
        break;
      }
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
        await this.unsyncedService.handleSyncOne(req.requestId, req.key);
        break;
      case "unsynced.discardOne":
        await this.unsyncedService.handleDiscardOne(req.requestId, req.key);
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
        await this.unsyncedService.handleSyncAll(req.requestId);
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

  // ── Private ────────────────────────────────────────────────────────────

  private selectTicket(
    ticketId: number,
    throwOnLoadError = false,
    commentSelection?: { commentId?: number; documentUri?: string },
  ): Promise<void> {
    return this.selectionService.selectTicket(ticketId, throwOnLoadError, commentSelection);
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
      projects: this.cache.projects,
    });
  }

  public async createNewTicketDraft(): Promise<void> {
    await this.draftService.createQuickNewTicketDraft("command-create-ticket");
  }

  public selectTicketForEditor(ticketId: number, editorConnectionScope?: string): Promise<void> {
    return this.selectionService.selectTicketForEditor(ticketId, editorConnectionScope);
  }

  public selectCommentForEditor(
    target: { ticketId: number; commentId?: number; documentUri?: string },
    editorConnectionScope?: string,
  ): Promise<void> {
    return this.selectionService.selectCommentForEditor(target, editorConnectionScope);
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
        selectedCommentId: undefined,
        selectedCommentUri: undefined,
        items: [],
        loading: false,
        error: undefined,
      },
    });
  }

  private refreshUnsynced(): void {
    this.unsyncedService.refreshUnsynced();
    this.opts.store.update({ draftTickets: this.buildCurrentDraftTickets() });
    const selectedTicketId = this.opts.store.getState().selectedTicketId;
    if (selectedTicketId !== undefined) {
      this.commentService.refreshPresentation(selectedTicketId);
    }
  }

  private handleTicketDraftSaved(event: TicketDraftSavedEvent): void {
    if (event.connectionScope !== getCurrentConnectionScope()) {
      return;
    }
    const cached = this.cache.tickets.find((ticket) => ticket.id === event.ticketId);
    if (!cached) {
      return;
    }
    const { remoteTicket, draft } = event;
    if (remoteTicket) {
      cached.subject = remoteTicket.subject;
      cached.description = remoteTicket.description;
      cached.statusId = remoteTicket.statusId;
      cached.statusName = remoteTicket.statusName;
      cached.priorityId = remoteTicket.priorityId;
      cached.priorityName = remoteTicket.priorityName;
      cached.trackerId = remoteTicket.trackerId;
      cached.trackerName = remoteTicket.trackerName;
      cached.assigneeId = remoteTicket.assigneeId;
      cached.assigneeName = remoteTicket.assigneeName;
      cached.dueDate = remoteTicket.dueDate;
      cached.startDate = remoteTicket.startDate;
      cached.doneRatio = remoteTicket.doneRatio;
      cached.updatedAt = remoteTicket.updatedAt ?? cached.updatedAt;
      cached.parentId = remoteTicket.parentId;
    } else {
      const state = this.opts.store.getState();
      const editOptions = state.editOptions?.ticketId === event.ticketId ? state.editOptions : undefined;
      const meta = draft.baseMetadata;
      const statuses = editOptions ? editOptions.statuses : state.metadataOptions.statuses;
      const priorities = editOptions ? editOptions.priorities : state.metadataOptions.priorities;
      const trackers = editOptions ? editOptions.trackers : state.metadataOptions.trackers;
      const assignees = editOptions?.assignees ?? [];

      cached.subject = draft.baseSubject;
      cached.description = draft.baseDescription;
      cached.statusName = meta.status || undefined;
      cached.statusId = statuses.find((item) => item.name === meta.status)?.id;
      cached.priorityName = meta.priority || undefined;
      cached.priorityId = priorities.find((item) => item.name === meta.priority)?.id;
      cached.trackerName = meta.tracker || undefined;
      cached.trackerId = trackers.find((item) => item.name === meta.tracker)?.id;
      cached.assigneeName = meta.assignee ? meta.assignee : undefined;
      cached.assigneeId = meta.assignee
        ? (meta.assignee_id ?? assignees.find((item) => item.name === meta.assignee)?.id)
        : undefined;
      cached.dueDate = meta.due_date ? meta.due_date : undefined;
      cached.startDate = meta.start_date ? meta.start_date : undefined;
      if (meta.done_ratio !== undefined) {
        cached.doneRatio = meta.done_ratio;
      }
      if (meta.parent !== undefined) {
        cached.parentId = meta.parent;
      }
      cached.updatedAt = draft.lastKnownRemoteUpdatedAt ?? cached.updatedAt;
    }
    this.refreshTicketPresentation();
  }

  private refreshTicketPresentation(): void {
    this.pushTickets();
    const selectedTicketId = this.opts.store.getState().selectedTicketId;
    if (selectedTicketId === undefined) {
      return;
    }
    const selectedTicket = this.cache.tickets.find((ticket) => ticket.id === selectedTicketId);
    if (selectedTicket) {
      this.opts.store.update({ selectedTicket: buildTicketDetail(selectedTicket, this.cache.tickets) });
    }
    this.commentService.refreshPresentation(selectedTicketId);
  }

  private pushTickets(): void {
    this.ticketService.pushTickets();
    this.opts.store.update({ draftTickets: this.buildCurrentDraftTickets() });
    const state = this.opts.store.getState();
    if (state.selectedTicketId === undefined) {
      return;
    }
    const visibleIds = collectTicketNodeIds(state.tickets);
    if (!visibleIds.has(state.selectedTicketId)) {
      this.opts.store.update({
        selectedTicketId: undefined,
        selectedTicket: undefined,
        workPanel: undefined,
        comments: {
          ...state.comments,
          ticketId: undefined,
          selectedCommentId: undefined,
          selectedCommentUri: undefined,
          items: [],
          error: undefined,
        },
      });
    }
  }
}
