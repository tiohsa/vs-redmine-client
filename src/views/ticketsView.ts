import * as vscode from "vscode";
import {
  getDefaultProjectId,
  getIncludeChildProjects,
  getTicketListLimit,
} from "../config/settings";
import { getProjectSelection } from "../config/projectSelection";
import { listIssues } from "../redmine/issues";
import { Ticket } from "../redmine/types";
import { showError } from "../utils/notifications";
import { MAX_VIEW_ITEMS } from "./viewLimits";
import { createEmptyStateItem, createErrorStateItem } from "./viewState";

export const normalizeFilterOptions = (
  allOptions: string[],
  _matchingOptions: string[],
): string[] => allOptions;

export const buildTicketsViewItems = (
  tickets: Ticket[],
  selectedProjectId?: number,
  errorMessage?: string,
): vscode.TreeItem[] => {
  if (errorMessage) {
    return [createErrorStateItem(errorMessage)];
  }

  if (!selectedProjectId) {
    return [createEmptyStateItem("Select a project to view tickets.")];
  }

  if (tickets.length === 0) {
    return [createEmptyStateItem("No tickets for the selected project.")];
  }

  return tickets.slice(0, MAX_VIEW_ITEMS).map((ticket) => new TicketTreeItem(ticket));
};

export class TicketsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  private tickets: Ticket[] = [];
  private statusIds: string[] = [];
  private assigneeIds: string[] = [];
  private offset = 0;
  private errorMessage?: string;
  private selectedProjectId?: number;

  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    void this.loadTickets();
  }

  async loadTickets(): Promise<void> {
    try {
      this.errorMessage = undefined;
      const selection = getProjectSelection();
      const fallbackId = Number(getDefaultProjectId());
      const projectId = selection.id ?? (Number.isNaN(fallbackId) ? undefined : fallbackId);

      this.selectedProjectId = projectId;
      if (!projectId) {
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
      const message = (error as Error).message;
      this.errorMessage = `Failed to load tickets: ${message}`;
      showError(this.errorMessage);
      this.emitter.fire();
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

  setSelectedProjectId(projectId?: number): void {
    this.selectedProjectId = projectId;
    this.refresh();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    return this.getViewItems();
  }

  getViewItems(): vscode.TreeItem[] {
    return buildTicketsViewItems(this.tickets, this.selectedProjectId, this.errorMessage);
  }
}

export class TicketTreeItem extends vscode.TreeItem {
  constructor(public readonly ticket: Ticket) {
    super(`#${ticket.id} ${ticket.subject}`, vscode.TreeItemCollapsibleState.None);
    this.description = ticket.statusName ?? "";
    this.contextValue = "redmineTicket";
    this.command = {
      command: "todoex.openTicketPreview",
      title: "Open Ticket Preview",
      arguments: [this],
    };
  }
}
