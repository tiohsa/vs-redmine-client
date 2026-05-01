import type { DashboardServiceContext } from "./DashboardServiceContext";
import { getIncludeChildProjects, getTicketListLimit } from "../../config/settings";
import { listIssues } from "../../redmine/issues";
import { rememberTicketSummaries } from "../../views/ticketSummaryStore";
import type { Ticket } from "../../redmine/types";
import { applyTicketFilters, applyTicketSort, type TicketListSettings } from "../../views/projectListSettings";
import { buildTicketDashboardNodes, buildTicketDetail } from "../viewModels/ticketDashboardViewModel";
import { showTicketPreview } from "../../views/ticketPreview";
import { openTicketInBrowser } from "../../commands/openInBrowser";
import type { ResolvedProject } from "../resolveProject";

export class DashboardTicketService {
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
  }) {}

  async loadTickets(): Promise<void> {
    const { store } = this.deps.context;
    const project = this.deps.getResolvedProject();

    store.update({
      selectedProject: project ? { id: project.id, name: project.name } : undefined,
      includeChildProjects: getIncludeChildProjects(),
      loading: { ...store.getState().loading, tickets: true },
      errors: { ...store.getState().errors, tickets: undefined },
    });

    if (!project) {
      this.deps.setTickets([]);
      this.deps.setTotalCount(0);
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
      this.deps.setTickets(result.tickets);
      this.deps.setTotalCount(result.totalCount);
      rememberTicketSummaries(result.tickets);
      this.deps.refreshUnsynced();
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

  async loadMoreTickets(): Promise<void> {
    const tickets = this.deps.getTickets();
    if (tickets.length >= this.deps.getTotalCount()) {
      return;
    }
    const { store } = this.deps.context;
    const project = this.deps.getResolvedProject();
    if (!project) {
      return;
    }
    try {
      const result = await listIssues({
        projectId: project.id,
        includeChildProjects: getIncludeChildProjects(),
        limit: getTicketListLimit(),
        offset: tickets.length,
      });
      this.deps.setTickets([...tickets, ...result.tickets]);
      this.deps.setTotalCount(result.totalCount);
      rememberTicketSummaries(result.tickets);
      this.pushTickets();
    } catch (err) {
      const msg = (err as Error).message;
      store.updateNested("errors", { tickets: `Failed to load more: ${msg}` });
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
    this.deps.context.store.update({
      tickets: nodes,
      totalTicketCount: this.deps.getTotalCount(),
      loadedTicketCount: tickets.length,
    });
  }
}
