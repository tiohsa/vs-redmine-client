import { getCurrentConnectionScope } from "../../config/connectionScope";
import { getTicketListFollowActiveEditor } from "../../config/settings";
import type { DashboardTicketNode } from "../dashboardProtocol";
import type { DashboardStateStore } from "../DashboardStateStore";
import type { DashboardDataCache, DashboardDataService } from "./DashboardDataService";
import type { DashboardProjectService } from "./DashboardProjectService";
import type { DashboardTicketService } from "./DashboardTicketService";
import type { DashboardCommentService } from "./DashboardCommentService";
import type { DashboardMetadataService } from "./DashboardMetadataService";

export const collectTicketNodeIds = (nodes: DashboardTicketNode[]): Set<number> => {
  const ids = new Set<number>();
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    ids.add(node.id);
    if (node.children.length > 0) {
      stack.push(...node.children);
    }
  }
  return ids;
};

interface DashboardSelectionDependencies {
  store: DashboardStateStore;
  cache: DashboardDataCache;
  dataService: DashboardDataService;
  projectService: DashboardProjectService;
  ticketService: DashboardTicketService;
  commentService: DashboardCommentService;
  metadataService: DashboardMetadataService;
}

export class DashboardSelectionService {
  constructor(private readonly deps: DashboardSelectionDependencies) {}

  private async ensureTicketsLoadedForReveal(
    ticketIds: readonly number[],
    initialScope: string,
  ): Promise<boolean> {
    if (this.deps.cache.projects.length === 0) {
      await this.deps.projectService.loadProjects();
    }
    if (initialScope !== getCurrentConnectionScope()) {
      return false;
    }
    if (!this.deps.dataService.hasMetadataOptions) {
      await Promise.all([
        this.deps.dataService.loadMetadataOptions(),
        this.deps.ticketService.loadTickets(false, { ensureTicketIds: ticketIds }),
      ]);
    } else {
      await this.deps.ticketService.loadTickets(false, { ensureTicketIds: ticketIds });
    }
    return initialScope === getCurrentConnectionScope();
  }

  async revealCreatedTickets(
    ticketIds: readonly number[],
    options?: { connectionScope?: string },
  ): Promise<void> {
    const initialScope = options?.connectionScope ?? getCurrentConnectionScope();
    if (options?.connectionScope !== undefined && options.connectionScope !== getCurrentConnectionScope()) {
      return;
    }
    const normalizedIds = Array.from(
      new Set(ticketIds.filter((id) => Number.isInteger(id) && id > 0)),
    );
    const targetId = normalizedIds.at(-1);
    if (!(await this.ensureTicketsLoadedForReveal(normalizedIds, initialScope))) {
      return;
    }
    if (targetId === undefined) {
      return;
    }
    const state = this.deps.store.getState();
    if (collectTicketNodeIds(state.tickets).has(targetId)) {
      await this.selectTicket(targetId);
    }
  }

  async revealCreatedComment(
    ticketId: number,
    commentId: number,
    options?: { connectionScope?: string },
  ): Promise<void> {
    const initialScope = options?.connectionScope ?? getCurrentConnectionScope();
    if (options?.connectionScope !== undefined && options.connectionScope !== getCurrentConnectionScope()) {
      return;
    }
    if (!Number.isInteger(ticketId) || ticketId <= 0 || !Number.isInteger(commentId) || commentId <= 0) {
      return;
    }
    let state = this.deps.store.getState();
    if (!collectTicketNodeIds(state.tickets).has(ticketId)) {
      if (!(await this.ensureTicketsLoadedForReveal([ticketId], initialScope))) {
        return;
      }
      state = this.deps.store.getState();
      if (!collectTicketNodeIds(state.tickets).has(ticketId)) {
        return;
      }
    }
    if (state.selectedTicketId !== ticketId) {
      await this.selectTicket(ticketId, false, { commentId });
      return;
    }
    await this.deps.commentService.loadComments(ticketId, false, { commentId });
  }

  async selectTicket(
    ticketId: number,
    throwOnLoadError = false,
    commentSelection?: { commentId?: number; documentUri?: string },
  ): Promise<void> {
    await this.deps.ticketService.selectTicket(ticketId, throwOnLoadError, commentSelection);
    const ticket = this.deps.cache.tickets.find((t) => t.id === ticketId);
    if (ticket?.projectId) {
      const editOptions = this.deps.metadataService.loadEditOptions(ticketId, ticket.projectId, throwOnLoadError);
      if (throwOnLoadError) {
        await editOptions;
      } else {
        void editOptions;
      }
    }
  }

  private canFollowEditor(ticketId: number, editorConnectionScope?: string): boolean {
    return getTicketListFollowActiveEditor()
      && Number.isInteger(ticketId)
      && ticketId > 0
      && (editorConnectionScope === undefined || editorConnectionScope === getCurrentConnectionScope())
      && collectTicketNodeIds(this.deps.store.getState().tickets).has(ticketId);
  }

  public async selectTicketForEditor(
    ticketId: number,
    editorConnectionScope?: string,
  ): Promise<void> {
    if (!this.canFollowEditor(ticketId, editorConnectionScope)) {
      return;
    }
    if (this.deps.store.getState().selectedTicketId === ticketId) {
      return;
    }
    await this.selectTicket(ticketId);
  }

  public async selectCommentForEditor(
    target: { ticketId: number; commentId?: number; documentUri?: string },
    editorConnectionScope?: string,
  ): Promise<void> {
    if (!this.canFollowEditor(target.ticketId, editorConnectionScope)) {
      return;
    }
    const state = this.deps.store.getState();
    if (state.selectedTicketId !== target.ticketId) {
      await this.selectTicket(target.ticketId, false, {
        commentId: target.commentId,
        documentUri: target.documentUri,
      });
      return;
    }
    this.deps.commentService.selectComment(target.ticketId, {
      commentId: target.commentId,
      documentUri: target.documentUri,
    });
  }

}
