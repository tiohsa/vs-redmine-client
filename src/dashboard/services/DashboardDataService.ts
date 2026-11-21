import * as vscode from "vscode";
import { listIssuePriorities, listIssueStatuses, listTrackers } from "../../redmine/issues";
import type { Ticket } from "../../redmine/types";
import { getCurrentUserId } from "../../redmine/users";
import {
  clearTicketSummaries,
  rememberTicketSummaries,
  restoreTicketSummaries,
  snapshotTicketSummaries,
} from "../../views/ticketSummaryStore";
import type { DashboardMetadataOptions, DashboardProjectNode, DashboardState } from "../dashboardProtocol";
import type { DashboardCommentService } from "./DashboardCommentService";
import type { DashboardMetadataService } from "./DashboardMetadataService";
import type { DashboardProjectService } from "./DashboardProjectService";
import type { DashboardServiceContext } from "./DashboardServiceContext";
import type { DashboardTicketService } from "./DashboardTicketService";

export interface DashboardDataCache {
  tickets: Ticket[];
  projects: DashboardProjectNode[];
  totalCount: number;
}

export interface DashboardMetadataTestHooks {
  listTrackers?: typeof listTrackers;
  listIssuePriorities?: typeof listIssuePriorities;
  listIssueStatuses?: typeof listIssueStatuses;
  getCurrentUserId?: typeof getCurrentUserId;
}

export class DashboardDataService {
  private connectionGeneration = 0;
  private metadataLoadGeneration = 0;
  private metadataOptionsLoaded = false;

  constructor(private readonly deps: {
    context: Pick<DashboardServiceContext, "store" | "notifyOperationStarted" | "notifySuccess" | "notifyError">;
    cache: DashboardDataCache;
    projectService: DashboardProjectService;
    ticketService: DashboardTicketService;
    commentService: DashboardCommentService;
    metadataService: DashboardMetadataService;
    pushTickets: () => void;
    selectTicket: (ticketId: number, throwOnLoadError: boolean) => Promise<void>;
    refreshUnsynced: () => void;
    metadataHooks?: DashboardMetadataTestHooks;
    confirmCacheReset?: () => Promise<boolean>;
  }) {}

  get hasMetadataOptions(): boolean {
    return this.metadataOptionsLoaded;
  }

  async loadAll(): Promise<void> {
    await Promise.all([
      this.deps.projectService.loadProjects(),
      this.loadMetadataOptions(),
      this.deps.ticketService.loadTickets(),
    ]);
  }

  async refresh(requestId: string): Promise<void> {
    this.deps.context.notifyOperationStarted(requestId, vscode.l10n.t("Refreshing…"));
    try {
      await this.loadAll();
      this.deps.refreshUnsynced();
      this.deps.context.notifySuccess(requestId, vscode.l10n.t("Dashboard refreshed."), "info");
    } catch (error) {
      this.deps.context.notifyError(requestId, error instanceof Error ? error.message : String(error));
    }
  }

  async resetForConnectionChange(initialize: () => Promise<void>): Promise<void> {
    const generation = ++this.connectionGeneration;
    this.metadataLoadGeneration++;
    this.deps.ticketService.invalidate();
    this.deps.commentService.invalidate();
    this.deps.metadataService.invalidate();
    this.deps.cache.tickets = [];
    this.deps.cache.projects = [];
    this.deps.cache.totalCount = 0;
    this.metadataOptionsLoaded = false;
    clearTicketSummaries();
    this.deps.context.store.update({
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
    await this.deps.projectService.resetForConnectionChange();
    if (generation !== this.connectionGeneration) {
      return;
    }
    await initialize();
  }

  async resetDashboardCache(requestId: string): Promise<void> {
    const confirmed = await this.confirmDashboardCacheReset();
    if (!confirmed) {
      return;
    }

    this.deps.context.notifyOperationStarted(requestId, vscode.l10n.t("Resetting Dashboard cache…"));
    const previous = this.deps.context.store.getState();
    const previousState = structuredClone(previous);
    const previousMetadataOptionsLoaded = this.metadataOptionsLoaded;
    const previousTickets = this.deps.cache.tickets;
    const previousProjects = this.deps.cache.projects;
    const previousTotalCount = this.deps.cache.totalCount;
    const previousPagination = this.deps.ticketService.snapshotPagination();
    const previousTicketSummaries = snapshotTicketSummaries();
    const selectedDetailId = previous.workPanel?.mode === "detail"
      ? previous.workPanel.ticketId
      : undefined;

    this.deps.projectService.invalidate();
    this.deps.ticketService.invalidate(false);
    this.deps.commentService.invalidate();
    this.deps.metadataService.invalidate();
    let outcome: { level: "success" | "info" | "error"; message: string } = {
      level: "info",
      message: vscode.l10n.t("Dashboard cache reset canceled because the view changed."),
    };

    try {
      await this.deps.projectService.loadProjects(true);
      if (!this.deps.ticketService.isPaginationSnapshotCurrent(previousPagination)) { return; }
      const results = await Promise.allSettled([
        this.loadMetadataOptions(true, true),
        this.deps.ticketService.loadTickets(true),
      ]);
      if (!this.deps.ticketService.isPaginationSnapshotCurrent(previousPagination)) { return; }
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
      if (failures.length > 0) {
        throw new Error(failures.join("; "));
      }

      this.deps.pushTickets();
      if (selectedDetailId !== undefined && this.deps.cache.tickets.some((ticket) => ticket.id === selectedDetailId)) {
        await this.deps.selectTicket(selectedDetailId, true);
      }
      if (!this.deps.ticketService.isPaginationSnapshotCurrent(previousPagination)) { return; }
      this.deps.refreshUnsynced();
      clearTicketSummaries();
      rememberTicketSummaries(this.deps.cache.tickets);
      outcome = { level: "success", message: vscode.l10n.t("Dashboard cache reset.") };
    } catch (err) {
      if (!this.deps.ticketService.isPaginationSnapshotCurrent(previousPagination)) { return; }
      const reason = err instanceof Error ? err.message : String(err);
      const current = this.deps.context.store.getState();
      this.deps.cache.tickets = previousTickets;
      this.deps.cache.projects = previousProjects;
      this.deps.cache.totalCount = previousTotalCount;
      this.metadataOptionsLoaded = previousMetadataOptionsLoaded;
      this.deps.ticketService.restorePagination(previousPagination);
      restoreTicketSummaries(previousTicketSummaries);
      this.deps.context.store.update({
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
      if (outcome.level === "error") {
        this.deps.context.notifyError(requestId, outcome.message);
      } else {
        this.deps.context.notifySuccess(requestId, outcome.message, outcome.level);
      }
      this.deps.refreshUnsynced();
    }
  }

  private async confirmDashboardCacheReset(): Promise<boolean> {
    const testConfirmation = this.deps.confirmCacheReset;
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

  async loadMetadataOptions(throwOnError = false, preserveExisting = false): Promise<void> {
    const { store } = this.deps.context;
    const connectionGeneration = this.connectionGeneration;
    const metadataGeneration = ++this.metadataLoadGeneration;
    const previous = store.getState();
    const retainMetadata = preserveExisting && this.metadataOptionsLoaded;
    const isCurrent = () =>
      connectionGeneration === this.connectionGeneration &&
      metadataGeneration === this.metadataLoadGeneration;
    const publishCurrentUser = (id: number | undefined): void => {
      if (!isCurrent()) {
        return;
      }
      store.update({
        currentUserId: id,
        quickFilterCapabilities: {
          ...store.getState().quickFilterCapabilities,
          mine: id === undefined ? "unavailable" : "available",
        },
      });
    };
    store.update({
      currentUserId: undefined,
      quickFilterCapabilities: { mine: "loading", open: "loading" },
    });
    const resolveCurrentUserId = this.deps.metadataHooks?.getCurrentUserId ?? getCurrentUserId;
    const currentUserTask = Promise.resolve().then(resolveCurrentUserId).then((id) =>
      Number.isSafeInteger(id) && id > 0 ? id : undefined,
    );
    const metadataTask = Promise.all([
      (this.deps.metadataHooks?.listTrackers ?? listTrackers)(),
      (this.deps.metadataHooks?.listIssuePriorities ?? listIssuePriorities)(),
      (this.deps.metadataHooks?.listIssueStatuses ?? listIssueStatuses)(),
    ]);
    try {
      let options: DashboardMetadataOptions;
      let currentUserId: number | undefined;
      if (throwOnError) {
        const [metadata, refreshedUserId] = await Promise.all([metadataTask, currentUserTask]);
        options = { trackers: metadata[0], priorities: metadata[1], statuses: metadata[2] };
        currentUserId = refreshedUserId;
      } else {
        void currentUserTask.then(publishCurrentUser, () => publishCurrentUser(undefined));
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
          : store.getState().quickFilterCapabilities.mine,
        open: options.statuses.some((status) => typeof status.isClosed === "boolean")
          ? "available"
          : "unavailable",
      };
      store.update({
        metadataOptions: options,
        quickFilterCapabilities,
        ...(throwOnError ? { currentUserId } : {}),
      });
    } catch (err) {
      if (!isCurrent()) {
        return;
      }
      if (retainMetadata) {
        store.update({
          currentUserId: previous.currentUserId,
          quickFilterCapabilities: previous.quickFilterCapabilities,
        });
      } else {
        this.metadataOptionsLoaded = false;
        store.update({
          metadataOptions: { trackers: [], priorities: [], statuses: [] },
          quickFilterCapabilities: {
            mine: throwOnError ? "unavailable" : store.getState().quickFilterCapabilities.mine,
            open: "unavailable",
          },
        });
      }
      if (throwOnError) {
        throw err;
      }
    }
  }
}
