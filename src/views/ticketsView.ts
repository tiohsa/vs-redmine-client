import * as vscode from "vscode";
import {
  getDefaultProjectId,
  getIncludeChildProjects,
  getTicketListLimit,
} from "../config/settings";
import { listIssues } from "../redmine/issues";
import { Ticket } from "../redmine/types";
import { showError } from "../utils/notifications";

export const normalizeFilterOptions = (
  allOptions: string[],
  _matchingOptions: string[],
): string[] => allOptions;

export class TicketsTreeProvider implements vscode.TreeDataProvider<TicketTreeItem> {
  private readonly emitter = new vscode.EventEmitter<
    TicketTreeItem | undefined | void
  >();
  private tickets: Ticket[] = [];
  private statusIds: string[] = [];
  private assigneeIds: string[] = [];
  private offset = 0;

  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    void this.loadTickets();
  }

  async loadTickets(): Promise<void> {
    try {
      const projectIdRaw = getDefaultProjectId();
      const projectId = Number(projectIdRaw);
      if (!projectIdRaw || Number.isNaN(projectId)) {
        this.tickets = [];
        this.emitter.fire();
        return;
      }

      const result = await listIssues({
        projectId,
        includeChildProjects: getIncludeChildProjects(),
        limit: getTicketListLimit(),
        offset: this.offset,
        statusIds: this.statusIds,
        assigneeIds: this.assigneeIds,
      });

      this.tickets = result.tickets;
      this.emitter.fire();
    } catch (error) {
      showError((error as Error).message);
    }
  }

  setStatusFilter(statusIds: string[]): void {
    this.statusIds = statusIds;
    this.refresh();
  }

  setAssigneeFilter(assigneeIds: string[]): void {
    this.assigneeIds = assigneeIds;
    this.refresh();
  }

  setOffset(offset: number): void {
    this.offset = offset;
    this.refresh();
  }

  getTreeItem(element: TicketTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TicketTreeItem): vscode.ProviderResult<TicketTreeItem[]> {
    if (element) {
      return [];
    }

    return this.tickets.map((ticket) => new TicketTreeItem(ticket));
  }
}

export class TicketTreeItem extends vscode.TreeItem {
  constructor(public readonly ticket: Ticket) {
    super(`#${ticket.id} ${ticket.subject}`, vscode.TreeItemCollapsibleState.None);
    this.description = ticket.statusName ?? "";
    this.contextValue = "redmineTicket";
  }
}
