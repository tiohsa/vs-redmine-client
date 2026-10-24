import * as vscode from "vscode";
import type { DashboardSearchScope } from "../dashboardProtocol";
import type { DashboardServiceContext } from "./DashboardServiceContext";
import { getIncludeChildProjects, getTicketListLimit } from "../../config/settings";
import { listIssues as fetchIssues } from "../../redmine/issues";
import { rememberTicketSummaries } from "../../views/ticketSummaryStore";
import type { Ticket } from "../../redmine/types";
import { applyTicketFilters, applyTicketSort, type TicketListSettings } from "../../views/projectListSettings";
import { buildTicketDashboardNodes, buildTicketDetail } from "../viewModels/ticketDashboardViewModel";
import { showTicketPreview } from "../../views/ticketPreview";
import { openTicketInBrowser } from "../../commands/openInBrowser";
import type { ResolvedProject } from "../resolveProject";

type SearchPage = { offset: number; total?: number };
type TicketSearch = {
  query: string;
  scope: DashboardSearchScope;
  includeChildProjects: boolean;
  subject: SearchPage;
  description: SearchPage;
  directId?: number;
};

export interface DashboardTicketPaginationSnapshot {
  contextRevision: number;
  query: string;
  projectIssueOffset?: number;
  search?: TicketSearch;
}

export class DashboardTicketService {
  private ticketLoadGeneration = 0;
  private searchContextRevision = 0;
  private projectIssueOffset?: number;
  private searchQuery = "";
  private search?: TicketSearch;
  private loadMoreFlight?: { key: string; promise: Promise<void> };

  constructor(private readonly deps: {
    context: DashboardServiceContext;
    getResolvedProject: () => ResolvedProject | undefined;
    getTickets: () => Ticket[];
    setTickets: (tickets: Ticket[]) => void;
    getTotalCount: () => number;
    setTotalCount: (count: number) => void;
    getSettings: () => TicketListSettings;
    loadComments: (ticketId: number, throwOnError?: boolean) => Promise<void>;
    refreshUnsynced: () => void;
    onSearchAccepted?: () => void;
    listIssues?: typeof fetchIssues;
  }) {}

  // プロジェクト切替の永続化を待つ間も、旧検索の応答を受け付けない。
  prepareSearch(query = this.searchQuery): void {
    this.searchContextRevision++;
    this.invalidate(false);
    this.searchQuery = query.trim();
  }

  async searchTickets(rawQuery: string, scope?: DashboardSearchScope): Promise<void> {
    const project = this.deps.getResolvedProject();
    if (scope && (scope.kind === "all" ? !!project : scope.projectId !== project?.id)) {
      return;
    }
    this.deps.onSearchAccepted?.();
    this.prepareSearch(rawQuery);
    const { store } = this.deps.context;
    const workPanel = store.getState().workPanel;
    store.update({ selectedTicketId: undefined, selectedTicket: undefined,
      workPanel: workPanel?.mode === "detail" ? undefined : workPanel,
      comments: { loading: false, items: [] }, editOptions: undefined });
    await this.loadTickets();
  }

  // 旧Webviewからの要求も同じ検索処理を通す。
  async searchAllProjects(rawQuery: string): Promise<void> {
    await this.searchTickets(rawQuery, { kind: "all" });
  }

  async loadTickets(throwOnError = false): Promise<void> {
    const generation = ++this.ticketLoadGeneration;
    this.projectIssueOffset = undefined;
    const { store } = this.deps.context;
    const project = this.deps.getResolvedProject();
    const includeChildProjects = getIncludeChildProjects();
    const scope: DashboardSearchScope = project ? { kind: "project", projectId: project.id } : { kind: "all" };
    const query = this.searchQuery;
    this.search = query ? { query, scope, includeChildProjects, subject: { offset: 0 }, description: { offset: 0 } } : undefined;
    store.update({
      ticketSearch: { query, scope, includeChildProjects },
      selectedProject: project ? { id: project.id, name: project.name } : undefined,
      includeChildProjects,
      loading: { ...store.getState().loading, tickets: true, moreTickets: false },
      errors: { ...store.getState().errors, tickets: undefined, moreTickets: undefined },
    });
    try {
      if (this.search) {
        await this.loadSearchPage(this.search, generation, true);
      } else if (project) {
        const result = await this.listIssues({ projectId: project.id, includeChildProjects, limit: getTicketListLimit(), offset: 0 });
        if (generation !== this.ticketLoadGeneration) { return; }
        this.projectIssueOffset = result.offset + result.tickets.length;
        this.deps.setTickets(mergeTicketsById([], result.tickets));
        this.deps.setTotalCount(result.totalCount);
      } else {
        this.deps.setTickets([]);
        this.deps.setTotalCount(0);
      }
      if (generation !== this.ticketLoadGeneration) { return; }
      rememberTicketSummaries(this.deps.getTickets());
      this.deps.refreshUnsynced();
      this.pushTickets();
      store.updateNested("loading", { tickets: false });
    } catch (err) {
      if (generation !== this.ticketLoadGeneration) { return; }
      const message = err instanceof Error ? err.message : String(err);
      store.update({
        loading: { ...store.getState().loading, tickets: false },
        errors: { ...store.getState().errors, tickets: vscode.l10n.t("Failed to load tickets: {0}", message) },
      });
      if (throwOnError) { throw err; }
    }
  }

  loadMoreTickets(): Promise<void> {
    const generation = this.ticketLoadGeneration;
    if (this.deps.context.store.getState().loading.tickets || !this.hasMoreTickets()) {
      return this.loadMoreFlight?.promise ?? Promise.resolve();
    }
    const key = String(generation);
    if (this.loadMoreFlight?.key === key) { return this.loadMoreFlight.promise; }
    const promise = this.loadMoreTicketsNow(generation).finally(() => {
      if (this.loadMoreFlight?.promise === promise) { this.loadMoreFlight = undefined; }
    });
    this.loadMoreFlight = { key, promise };
    return promise;
  }

  invalidate(clearSearch = true): void {
    this.ticketLoadGeneration++;
    this.projectIssueOffset = undefined;
    this.search = undefined;
    this.loadMoreFlight = undefined;
    if (clearSearch) {
      this.searchContextRevision++;
      this.searchQuery = "";
    }
    const { store } = this.deps.context;
    if (store.getState().loading.moreTickets || store.getState().errors.moreTickets) {
      store.update({
        loading: { ...store.getState().loading, moreTickets: false },
        errors: { ...store.getState().errors, moreTickets: undefined },
      });
    }
  }

  snapshotPagination(): DashboardTicketPaginationSnapshot {
    return structuredClone({ contextRevision: this.searchContextRevision, query: this.searchQuery, projectIssueOffset: this.projectIssueOffset, search: this.search });
  }

  isPaginationSnapshotCurrent(snapshot: DashboardTicketPaginationSnapshot): boolean {
    return snapshot.contextRevision === this.searchContextRevision;
  }

  restorePagination(snapshot: DashboardTicketPaginationSnapshot): void {
    if (!this.isPaginationSnapshotCurrent(snapshot)) { return; }
    // 通信中のPromiseや世代は復元せず、旧応答を破棄したまま取得位置だけを戻す。
    this.invalidate(false);
    this.searchQuery = snapshot.query;
    this.projectIssueOffset = snapshot.projectIssueOffset;
    this.search = structuredClone(snapshot.search);
  }

  private async loadMoreTicketsNow(generation: number): Promise<void> {
    const { store } = this.deps.context;
    const project = this.deps.getResolvedProject();
    store.update({
      loading: { ...store.getState().loading, moreTickets: true },
      errors: { ...store.getState().errors, moreTickets: undefined },
    });
    try {
      if (this.search) {
        await this.loadSearchPage(this.search, generation, false);
      } else if (project) {
        const tickets = this.deps.getTickets();
        const result = await this.listIssues({
          projectId: project.id, includeChildProjects: getIncludeChildProjects(),
          limit: getTicketListLimit(), offset: this.projectIssueOffset ?? tickets.length,
        });
        if (generation !== this.ticketLoadGeneration) { return; }
        if (result.totalCount !== this.deps.getTotalCount()) {
          await this.loadTickets();
          return;
        }
        this.projectIssueOffset = result.offset + result.tickets.length;
        this.deps.setTickets(mergeTicketsById(tickets, result.tickets));
        this.deps.setTotalCount(result.totalCount);
      }
      if (generation !== this.ticketLoadGeneration) { return; }
      rememberTicketSummaries(this.deps.getTickets());
      store.updateNested("errors", { moreTickets: undefined });
      this.pushTickets();
    } catch (err) {
      if (generation !== this.ticketLoadGeneration) { return; }
      const message = err instanceof Error ? err.message : String(err);
      store.updateNested("errors", { moreTickets: vscode.l10n.t("Failed to load more: {0}", message) });
    } finally {
      if (generation === this.ticketLoadGeneration) { store.updateNested("loading", { moreTickets: false }); }
    }
  }

  private async loadSearchPage(search: TicketSearch, generation: number, first: boolean): Promise<void> {
    const base = {
      projectId: search.scope.kind === "project" ? search.scope.projectId : undefined,
      includeChildProjects: search.includeChildProjects,
      limit: getTicketListLimit(),
    };
    const onlyId = /^#\d+$/.test(search.query);
    const id = /^#?\d+$/.test(search.query) ? Number(search.query.replace(/^#/, "")) : undefined;
    const readPage = async (field: "subject" | "description") => {
      const page = search[field];
      if (onlyId || (page.total !== undefined && page.offset >= page.total)) { return undefined; }
      return this.listIssues({ ...base, offset: page.offset,
        ...(field === "subject" ? { subjectQuery: search.query } : { descriptionQuery: search.query }) });
    };
    // 全問い合わせが成功してからoffsetと結果を反映する。失敗時は同じページを再試行できる。
    const [subject, description, direct] = await Promise.all([
      readPage("subject"), readPage("description"),
      first && id !== undefined && Number.isSafeInteger(id) && id > 0
        ? this.listIssues({ ...base, offset: 0, issueIds: [id] }) : undefined,
    ]);
    if (generation !== this.ticketLoadGeneration) { return; }
    if (!first && ((subject && subject.totalCount !== search.subject.total) ||
      (description && description.totalCount !== search.description.total))) {
      await this.loadTickets();
      return;
    }
    for (const [field, result] of [["subject", subject], ["description", description]] as const) {
      if (result) {
        const offset = result.offset + result.tickets.length;
        search[field] = { offset, total: result.tickets.length ? result.totalCount : offset };
      } else if (onlyId) { search[field] = { offset: 0, total: 0 }; }
    }
    if (first) { search.directId = direct?.tickets.find(ticket => ticket.id === id)?.id; }
    const additions = [...(direct?.tickets ?? []), ...(subject?.tickets ?? []), ...(description?.tickets ?? [])];
    const tickets = mergeTicketsById(first ? [] : this.deps.getTickets(), additions);
    tickets.sort((a, b) => Number(b.id === search.directId) - Number(a.id === search.directId) || a.id - b.id);
    this.deps.setTickets(tickets);
    // OR検索の総数は未確定。UIは読み込み済み件数を表示する。
    this.deps.setTotalCount(tickets.length);
  }

  async selectTicket(ticketId: number, throwOnCommentError = false): Promise<void> {
    const { store } = this.deps.context;
    const tickets = this.deps.getTickets();
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      return;
    }
    store.update({
      selectedTicketId: ticketId,
      selectedTicket: buildTicketDetail(ticket, tickets),
      workPanel: { mode: "detail", ticketId },
    });
    await this.deps.loadComments(ticketId, throwOnCommentError);
  }

  async openEditor(ticketId: number): Promise<void> {
    const ticket = this.deps.getTickets().find((t) => t.id === ticketId);
    if (ticket) {
      await showTicketPreview(ticket);
    }
  }

  async openInBrowser(ticketId: number): Promise<void> {
    const ticket = this.deps.getTickets().find((t) => t.id === ticketId);
    if (!ticket) {
      return;
    }
    await openTicketInBrowser({ ticket });
  }

  pushTickets(): void {
    const tickets = this.deps.getTickets();
    const state = this.deps.context.store.getState();
    const settings = this.deps.getSettings();
    const filtered = applyTicketFilters(tickets, { ...settings.filters, subjectQuery: "" });
    const sorted = applyTicketSort(filtered, settings.sort);
    if (this.search?.directId !== undefined) {
      const directId = this.search.directId;
      sorted.sort((a, b) => Number(b.id === directId) - Number(a.id === directId));
    }
    const nodes = this.search
      ? sorted.flatMap(ticket => buildTicketDashboardNodes([ticket]))
      : buildTicketDashboardNodes(sorted);
    const assignees = new Map<number, string>();
    for (const ticket of tickets) {
      if (ticket.assigneeId !== undefined) {
        assignees.set(ticket.assigneeId, ticket.assigneeName ?? `User #${ticket.assigneeId}`);
      }
    }
    const toSortedAssigneeOptions = (options: Map<number, string>) =>
      Array.from(options.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) => left.name.localeCompare(right.name, "ja"));
    const globalStatuses = this.deps.context.store.getState().metadataOptions.statuses;
    const selectedTicket = state.selectedTicketId === undefined
      ? undefined
      : tickets.find((ticket) => ticket.id === state.selectedTicketId);
    this.deps.context.store.update({
      tickets: nodes,
      totalTicketCount: this.deps.getTotalCount(),
      loadedTicketCount: tickets.length,
      hasMoreTickets: this.hasMoreTickets(),
      ticketFilterOptions: {
        assignees: toSortedAssigneeOptions(assignees),
        statuses: globalStatuses,
      },
      ...(state.selectedTicketId === undefined
        ? {}
        : selectedTicket
          ? { selectedTicket: buildTicketDetail(selectedTicket, tickets) }
          : {
            selectedTicketId: undefined,
            selectedTicket: undefined,
            workPanel: state.workPanel?.mode === "detail" ? undefined : state.workPanel,
            comments: {
              ...state.comments,
              ticketId: undefined,
              items: [],
              loading: false,
              error: undefined,
            },
          }),
    });
  }

  private hasMoreTickets(): boolean {
    if (this.search) {
      return [this.search.subject, this.search.description].some(page => page.total !== undefined && page.offset < page.total);
    }
    return (this.projectIssueOffset ?? this.deps.getTickets().length) < this.deps.getTotalCount();
  }

  private get listIssues(): typeof fetchIssues {
    return this.deps.listIssues ?? fetchIssues;
  }

}

const mergeTicketsById = (base: Ticket[], additions: Ticket[]): Ticket[] => {
  const seen = new Set<number>();
  const merged: Ticket[] = [];
  for (const ticket of [...base, ...additions]) {
    if (seen.has(ticket.id)) {
      continue;
    }
    seen.add(ticket.id);
    merged.push(ticket);
  }
  return merged;
};
