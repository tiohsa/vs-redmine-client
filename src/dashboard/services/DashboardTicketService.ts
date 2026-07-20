import type { DashboardServiceContext } from "./DashboardServiceContext";
import { getIncludeChildProjects, getTicketListLimit } from "../../config/settings";
import { getIssueDetail as fetchIssueDetail, listIssues as fetchIssues } from "../../redmine/issues";
import { rememberTicketSummaries } from "../../views/ticketSummaryStore";
import type { Ticket } from "../../redmine/types";
import { applyTicketFilters, applyTicketSort, type TicketListSettings } from "../../views/projectListSettings";
import { buildTicketDashboardNodes, buildTicketDetail } from "../viewModels/ticketDashboardViewModel";
import { showTicketPreview } from "../../views/ticketPreview";
import { openTicketInBrowser } from "../../commands/openInBrowser";
import type { ResolvedProject } from "../resolveProject";

export class DashboardTicketService {
  private ticketLoadGeneration = 0;
  private allProjectsSearchQuery = "";
  private allProjectsSearchIssueOffset = 0;
  private allProjectsSearchExtraCount = 0;

  constructor(private readonly deps: {
    context: DashboardServiceContext;
    getResolvedProject: () => ResolvedProject | undefined;
    getTickets: () => Ticket[];
    setTickets: (tickets: Ticket[]) => void;
    getTotalCount: () => number;
    setTotalCount: (count: number) => void;
    getSettings: () => TicketListSettings;
    loadComments: (ticketId: number) => Promise<void>;
    refreshUnsynced: () => void;
    listIssues?: typeof fetchIssues;
    getIssueDetail?: typeof fetchIssueDetail;
  }) {}

  async loadTickets(): Promise<void> {
    const generation = ++this.ticketLoadGeneration;
    this.allProjectsSearchQuery = "";
    this.allProjectsSearchIssueOffset = 0;
    this.allProjectsSearchExtraCount = 0;
    const { store } = this.deps.context;
    const project = this.deps.getResolvedProject();

    store.update({
      selectedProject: project ? { id: project.id, name: project.name } : undefined,
      includeChildProjects: getIncludeChildProjects(),
      loading: { ...store.getState().loading, tickets: true },
      errors: { ...store.getState().errors, tickets: undefined },
    });

    if (!project) {
      if (generation !== this.ticketLoadGeneration) {
        return;
      }
      this.deps.setTickets([]);
      this.deps.setTotalCount(0);
      this.pushTickets();
      store.updateNested("loading", { tickets: false });
      return;
    }

    try {
      const result = await this.listIssues({
        projectId: project.id,
        includeChildProjects: getIncludeChildProjects(),
        limit: getTicketListLimit(),
        offset: 0,
      });
      if (generation !== this.ticketLoadGeneration) {
        return;
      }
      this.deps.setTickets(result.tickets);
      this.deps.setTotalCount(result.totalCount);
      rememberTicketSummaries(result.tickets);
      this.deps.refreshUnsynced();
      this.pushTickets();
      store.updateNested("loading", { tickets: false });
    } catch (err) {
      if (generation !== this.ticketLoadGeneration) {
        return;
      }
      const msg = (err as Error).message;
      store.update({
        loading: { ...store.getState().loading, tickets: false },
        errors: { ...store.getState().errors, tickets: `Failed to load tickets: ${msg}` },
      });
    }
  }

  async loadMoreTickets(): Promise<void> {
    const generation = this.ticketLoadGeneration;
    const tickets = this.deps.getTickets();
    if (tickets.length >= this.deps.getTotalCount()) {
      return;
    }
    const { store } = this.deps.context;
    if (this.allProjectsSearchQuery) {
      try {
        const result = await this.listIssues({
          includeChildProjects: false,
          limit: getTicketListLimit(),
          offset: this.allProjectsSearchIssueOffset,
          subjectQuery: this.allProjectsSearchQuery,
        });
        if (generation !== this.ticketLoadGeneration) {
          return;
        }
        this.allProjectsSearchIssueOffset += result.tickets.length;
        this.deps.setTickets(mergeTicketsById(tickets, result.tickets));
        this.deps.setTotalCount(result.totalCount + this.allProjectsSearchExtraCount);
        rememberTicketSummaries(result.tickets);
        this.pushTickets();
      } catch (err) {
        const msg = (err as Error).message;
        store.updateNested("errors", { tickets: `Failed to load more: ${msg}` });
      }
      return;
    }
    const project = this.deps.getResolvedProject();
    if (!project) {
      return;
    }
    try {
      const result = await this.listIssues({
        projectId: project.id,
        includeChildProjects: getIncludeChildProjects(),
        limit: getTicketListLimit(),
        offset: tickets.length,
      });
      if (generation !== this.ticketLoadGeneration) {
        return;
      }
      this.deps.setTickets([...tickets, ...result.tickets]);
      this.deps.setTotalCount(result.totalCount);
      rememberTicketSummaries(result.tickets);
      this.pushTickets();
    } catch (err) {
      const msg = (err as Error).message;
      store.updateNested("errors", { tickets: `Failed to load more: ${msg}` });
    }
  }

  async searchAllProjects(rawQuery: string): Promise<void> {
    const generation = ++this.ticketLoadGeneration;
    const { store } = this.deps.context;
    const query = rawQuery.trim();
    this.allProjectsSearchQuery = query;
    this.allProjectsSearchIssueOffset = 0;
    this.allProjectsSearchExtraCount = 0;

    store.update({
      selectedProject: undefined,
      loading: { ...store.getState().loading, tickets: query.length > 0 },
      errors: { ...store.getState().errors, tickets: undefined },
      selectedTicketId: undefined,
      selectedTicket: undefined,
      workPanel: undefined,
    });

    if (!query) {
      this.deps.setTickets([]);
      this.deps.setTotalCount(0);
      this.pushTickets();
      store.updateNested("loading", { tickets: false });
      return;
    }

    try {
      const result = await this.listIssues({
        includeChildProjects: false,
        limit: getTicketListLimit(),
        offset: 0,
        subjectQuery: query,
      });
      if (generation !== this.ticketLoadGeneration) {
        return;
      }
      this.allProjectsSearchIssueOffset = result.tickets.length;
      const idTicket = await this.searchTicketById(query);
      if (generation !== this.ticketLoadGeneration) {
        return;
      }
      const tickets = idTicket ? mergeTicketsById([idTicket], result.tickets) : result.tickets;
      this.allProjectsSearchExtraCount = idTicket && !result.tickets.some((ticket) => ticket.id === idTicket.id) ? 1 : 0;
      this.deps.setTickets(tickets);
      this.deps.setTotalCount(result.totalCount + this.allProjectsSearchExtraCount);
      rememberTicketSummaries(tickets);
      this.deps.refreshUnsynced();
      this.pushTickets();
      store.updateNested("loading", { tickets: false });
    } catch (err) {
      if (generation !== this.ticketLoadGeneration) {
        return;
      }
      const msg = (err as Error).message;
      store.update({
        loading: { ...store.getState().loading, tickets: false },
        errors: { ...store.getState().errors, tickets: `Failed to search tickets: ${msg}` },
      });
    }
  }

  async selectTicket(ticketId: number): Promise<void> {
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
    await this.deps.loadComments(ticketId);
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
    const settings = this.deps.getSettings();
    const filtered = applyTicketFilters(tickets, settings.filters);
    const sorted = applyTicketSort(filtered, settings.sort);
    const nodes = buildTicketDashboardNodes(sorted);
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
    this.deps.context.store.update({
      tickets: nodes,
      totalTicketCount: this.deps.getTotalCount(),
      loadedTicketCount: tickets.length,
      ticketFilterOptions: {
        assignees: toSortedAssigneeOptions(assignees),
        statuses: globalStatuses,
      },
    });
  }

  private async searchTicketById(query: string): Promise<Ticket | undefined> {
    if (!/^\d+$/.test(query)) {
      return undefined;
    }
    const issueId = Number(query);
    if (!Number.isSafeInteger(issueId) || issueId <= 0) {
      return undefined;
    }
    try {
      return (await this.getIssueDetail(issueId)).ticket;
    } catch {
      return undefined;
    }
  }

  private get listIssues(): typeof fetchIssues {
    return this.deps.listIssues ?? fetchIssues;
  }

  private get getIssueDetail(): typeof fetchIssueDetail {
    return this.deps.getIssueDetail ?? fetchIssueDetail;
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
