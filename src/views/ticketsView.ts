import * as vscode from "vscode";
import {
  getApiKey,
  getBaseUrl,
  getDefaultProjectId,
  getIncludeChildProjects,
  getTicketListLimit,
} from "../config/settings";
import { getProjectSelection } from "../config/projectSelection";
import { listIssues } from "../redmine/issues";
import { Ticket } from "../redmine/types";
import { showError } from "../utils/notifications";
import { MAX_VIEW_ITEMS } from "./viewLimits";
import { setViewContext } from "./viewContext";
import { createEmptyStateItem, createErrorStateItem } from "./viewState";
import { buildTree, collectTreeNodeIds } from "./treeBuilder";
import { TreeBuildResult, TreeNode, TreeSource } from "./treeTypes";
import { isTreeExpanded, setTreeExpandedBulk } from "./treeState";
import { createCycleWarningItem } from "./treeWarnings";
import {
  applyTicketFilters,
  applyTicketSort,
  DEFAULT_TICKET_LIST_SETTINGS,
  DueDateDisplayRule,
  formatDueDateIndicator,
  resolveDueDateWindow,
  TicketListSettings,
  TicketSortField,
} from "./projectListSettings";

export const TICKET_SETTINGS_COMMANDS = {
  priorityFilter: "todoex.configureTicketPriorityFilter",
  statusFilter: "todoex.configureTicketStatusFilter",
  trackerFilter: "todoex.configureTicketTrackerFilter",
  assigneeFilter: "todoex.configureTicketAssigneeFilter",
  sort: "todoex.configureTicketSort",
  dueDate: "todoex.configureTicketDueDateDisplay",
  reset: "todoex.resetTicketListSettings",
};

export const TICKET_RELOAD_COMMAND = "todoex.reloadTicket";

export const CREATE_TICKET_CONTEXT_KEY = "todoex.canCreateTickets";
const TICKETS_VIEW_KEY = "tickets";

export const evaluateCreateTicketPermission = (
  baseUrl: string,
  apiKey: string,
): boolean => baseUrl.length > 0 && apiKey.length > 0;

export const refreshCreateTicketContext = (
  baseUrl = getBaseUrl(),
  apiKey = getApiKey(),
): boolean => {
  const canCreate = evaluateCreateTicketPermission(baseUrl, apiKey);
  void setViewContext(CREATE_TICKET_CONTEXT_KEY, canCreate);
  return canCreate;
};

export const normalizeFilterOptions = (
  allOptions: string[],
  _matchingOptions: string[],
): string[] => allOptions;

type TicketOption = { id: number; label: string };

const cloneTicketListSettings = (settings: TicketListSettings): TicketListSettings => ({
  filters: { ...settings.filters },
  sort: { ...settings.sort },
  dueDate: { ...settings.dueDate },
});

const getDefaultTicketListSettings = (): TicketListSettings =>
  cloneTicketListSettings(DEFAULT_TICKET_LIST_SETTINGS);

const formatSelectionSummary = (selectedCount: number, totalCount: number): string => {
  if (selectedCount === 0 || selectedCount === totalCount) {
    return "All";
  }
  return `${selectedCount} selected`;
};

const formatSortSummary = (sort: TicketListSettings["sort"]): string => {
  if (!sort.field) {
    return "None";
  }
  const label = sort.field.charAt(0).toUpperCase() + sort.field.slice(1);
  return `${label} (${sort.direction})`;
};

const formatDueDateSummary = (rule: DueDateDisplayRule): string => {
  const enabled: string[] = [];
  if (rule.showWithin1Day) {
    enabled.push("1 day");
  }
  if (rule.showWithin3Days) {
    enabled.push("3 days");
  }
  if (rule.showWithin7Days) {
    enabled.push("7 days");
  }
  if (rule.showOverdue) {
    enabled.push("Overdue");
  }
  if (enabled.length === 0) {
    return "None";
  }
  if (enabled.length === 4) {
    return "All";
  }
  return enabled.join(", ");
};

const buildTicketTreeSources = (tickets: Ticket[]): Array<TreeSource<Ticket>> =>
  tickets.map((ticket) => ({
    id: ticket.id,
    parentId: ticket.parentId,
    label: `#${ticket.id} ${ticket.subject}`,
    data: ticket,
  }));

const buildTicketTreeItems = (
  nodes: Array<TreeNode<Ticket>>,
  dueIndicators: Map<number, string | undefined>,
): TicketTreeItem[] =>
  nodes.map(
    (node) =>
      new TicketTreeItem(
        node,
        dueIndicators.get(node.data.id),
        node.children.length > 0 &&
          isTreeExpanded(TICKETS_VIEW_KEY, String(node.data.id)),
      ),
  );

const buildTicketCycleWarnings = (
  tickets: Ticket[],
  cycleIds: Set<number>,
): vscode.TreeItem[] => {
  if (cycleIds.size === 0) {
    return [];
  }

  const labelById = new Map(
    tickets.map((ticket) => [ticket.id, `#${ticket.id} ${ticket.subject}`]),
  );
  return Array.from(cycleIds.values()).map((id) => {
    const label = labelById.get(id) ?? `Ticket ${id}`;
    return createCycleWarningItem(label);
  });
};

const collectOptions = (
  tickets: Ticket[],
  getId: (ticket: Ticket) => number | undefined,
  getLabel: (ticket: Ticket) => string | undefined,
): TicketOption[] => {
  const seen = new Map<number, string>();
  tickets.forEach((ticket) => {
    const id = getId(ticket);
    if (id === undefined) {
      return;
    }
    const label = getLabel(ticket) ?? `#${id}`;
    if (!seen.has(id)) {
      seen.set(id, label);
    }
  });
  return Array.from(seen.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

export class TicketSettingsItem extends vscode.TreeItem {
  constructor(label: string, description: string, command: vscode.Command) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.command = command;
    this.contextValue = "ticketSettingsItem";
  }
}

export const buildTicketsViewItems = (
  tickets: Ticket[],
  selectedProjectId?: number,
  errorMessage?: string,
  settings: TicketListSettings = DEFAULT_TICKET_LIST_SETTINGS,
  now: Date = new Date(),
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

  const filteredTickets = applyTicketFilters(tickets, settings.filters);
  const sortedTickets = applyTicketSort(filteredTickets, settings.sort);
  const visibleTickets = sortedTickets.slice(0, MAX_VIEW_ITEMS);

  if (visibleTickets.length === 0) {
    return [createEmptyStateItem("No tickets match the current filters.")];
  }

  const dueIndicators = new Map<number, string | undefined>();
  visibleTickets.forEach((ticket) => {
    const dueWindow = resolveDueDateWindow(ticket, settings.dueDate, now);
    const dueIndicator = formatDueDateIndicator(dueWindow);
    dueIndicators.set(ticket.id, dueIndicator);
  });
  const treeResult = buildTree(buildTicketTreeSources(visibleTickets));
  const warningItems = buildTicketCycleWarnings(visibleTickets, treeResult.cycleIds);
  const ticketItems = buildTicketTreeItems(treeResult.roots, dueIndicators);
  return [...warningItems, ...ticketItems];
};

export class TicketsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  private tickets: Ticket[] = [];
  private offset = 0;
  private errorMessage?: string;
  private selectedProjectId?: number;
  private settings = getDefaultTicketListSettings();
  private rootNodes: Array<TreeNode<Ticket>> = [];

  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    void this.loadTickets();
  }

  async loadTickets(): Promise<void> {
    try {
      this.errorMessage = undefined;
      refreshCreateTicketContext();
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

  getParent(): vscode.ProviderResult<vscode.TreeItem> {
    return undefined;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (element instanceof TicketTreeItem) {
      const dueIndicators = this.buildDueIndicators();
      return buildTicketTreeItems(element.childNodes, dueIndicators);
    }

    return this.getViewItems();
  }

  setTicketsState(tickets: Ticket[], selectedProjectId?: number): void {
    this.tickets = tickets;
    this.selectedProjectId = selectedProjectId;
    this.errorMessage = undefined;
  }

  updateTicketSubject(ticketId: number, subject: string): boolean {
    if (this.errorMessage || !this.selectedProjectId) {
      return false;
    }
    const ticket = this.tickets.find((item) => item.id === ticketId);
    if (!ticket || ticket.subject === subject) {
      return false;
    }
    ticket.subject = subject;
    this.emitter.fire();
    return true;
  }

  collapseAllVisible(): void {
    if (this.errorMessage || !this.selectedProjectId) {
      return;
    }
    const { treeResult } = this.getVisibleTreeResult();
    const nodeIds = collectTreeNodeIds(treeResult.roots).map(String);
    setTreeExpandedBulk(TICKETS_VIEW_KEY, nodeIds, false);
    this.emitter.fire();
  }

  getViewItems(): vscode.TreeItem[] {
    const items = buildTicketsViewItems(
      this.tickets,
      this.selectedProjectId,
      this.errorMessage,
      this.settings,
    );

    if (this.errorMessage || !this.selectedProjectId) {
      this.rootNodes = [];
      return items;
    }

    const { treeResult } = this.getVisibleTreeResult();
    this.rootNodes = treeResult.roots;
    return items;
  }

  private getVisibleTreeResult(): {
    visibleTickets: Ticket[];
    treeResult: TreeBuildResult<Ticket>;
  } {
    const filteredTickets = applyTicketFilters(this.tickets, this.settings.filters);
    const sortedTickets = applyTicketSort(filteredTickets, this.settings.sort);
    const visibleTickets = sortedTickets.slice(0, MAX_VIEW_ITEMS);
    const treeResult = buildTree(buildTicketTreeSources(visibleTickets));
    return { visibleTickets, treeResult };
  }

  private buildDueIndicators(): Map<number, string | undefined> {
    const dueIndicators = new Map<number, string | undefined>();
    const now = new Date();
    const filteredTickets = applyTicketFilters(this.tickets, this.settings.filters);
    const sortedTickets = applyTicketSort(filteredTickets, this.settings.sort);
    const visibleTickets = sortedTickets.slice(0, MAX_VIEW_ITEMS);
    visibleTickets.forEach((ticket) => {
      const dueWindow = resolveDueDateWindow(ticket, this.settings.dueDate, now);
      dueIndicators.set(ticket.id, formatDueDateIndicator(dueWindow));
    });
    return dueIndicators;
  }

  async configurePriorityFilter(): Promise<void> {
    const options = collectOptions(
      this.tickets,
      (ticket) => ticket.priorityId,
      (ticket) => ticket.priorityName,
    );
    const selected = await this.pickMultiSelect(
      "Filter by priority",
      options,
      this.settings.filters.priorityIds,
    );
    if (!selected) {
      return;
    }

    this.settings = {
      ...this.settings,
      filters: {
        ...this.settings.filters,
        priorityIds: selected,
      },
    };
    this.emitter.fire();
  }

  async configureStatusFilter(): Promise<void> {
    const options = collectOptions(
      this.tickets,
      (ticket) => ticket.statusId,
      (ticket) => ticket.statusName,
    );
    const selected = await this.pickMultiSelect(
      "Filter by status",
      options,
      this.settings.filters.statusIds,
    );
    if (!selected) {
      return;
    }

    this.settings = {
      ...this.settings,
      filters: {
        ...this.settings.filters,
        statusIds: selected,
      },
    };
    this.emitter.fire();
  }

  async configureTrackerFilter(): Promise<void> {
    const options = collectOptions(
      this.tickets,
      (ticket) => ticket.trackerId,
      (ticket) => ticket.trackerName,
    );
    const selected = await this.pickMultiSelect(
      "Filter by tracker",
      options,
      this.settings.filters.trackerIds,
    );
    if (!selected) {
      return;
    }

    this.settings = {
      ...this.settings,
      filters: {
        ...this.settings.filters,
        trackerIds: selected,
      },
    };
    this.emitter.fire();
  }

  async configureAssigneeFilter(): Promise<void> {
    const options = collectOptions(
      this.tickets,
      (ticket) => ticket.assigneeId,
      (ticket) => ticket.assigneeName,
    );

    const items: Array<vscode.QuickPickItem & { id?: number; unassigned?: boolean }> =
      options.map((option) => ({
        label: option.label,
        picked: this.settings.filters.assigneeIds.includes(option.id),
        id: option.id,
      }));

    items.unshift({
      label: "Unassigned",
      picked: this.settings.filters.includeUnassigned,
      unassigned: true,
    });

    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: "Filter by assignee",
    });

    if (!picked) {
      return;
    }

    const assigneeIds = picked
      .filter((item) => item.id !== undefined)
      .map((item) => item.id as number);
    const includeUnassigned = picked.some((item) => item.unassigned);

    this.settings = {
      ...this.settings,
      filters: {
        ...this.settings.filters,
        assigneeIds,
        includeUnassigned,
      },
    };
    this.emitter.fire();
  }

  async configureSort(): Promise<void> {
    const fieldItems: Array<vscode.QuickPickItem & { field?: TicketSortField }> = [
      { label: "None", field: undefined },
      { label: "Priority", field: "priority" },
      { label: "Status", field: "status" },
      { label: "Tracker", field: "tracker" },
      { label: "Assignee", field: "assignee" },
    ];

    const pickedField = await vscode.window.showQuickPick(fieldItems, {
      title: "Sort tickets by",
    });

    if (!pickedField) {
      return;
    }

    if (!pickedField.field) {
      this.settings = {
        ...this.settings,
        sort: {
          ...this.settings.sort,
          field: undefined,
        },
      };
      this.emitter.fire();
      return;
    }

    const directionItems: Array<vscode.QuickPickItem & { direction: "asc" | "desc" }> = [
      { label: "Ascending", direction: "asc" },
      { label: "Descending", direction: "desc" },
    ];

    const pickedDirection = await vscode.window.showQuickPick(directionItems, {
      title: `Sort ${pickedField.label.toLowerCase()} by`,
    });

    if (!pickedDirection) {
      return;
    }

    this.settings = {
      ...this.settings,
      sort: {
        field: pickedField.field,
        direction: pickedDirection.direction,
      },
    };
    this.emitter.fire();
  }

  async configureDueDateDisplay(): Promise<void> {
    const items: Array<vscode.QuickPickItem & { key: keyof DueDateDisplayRule }> = [
      { label: "Within 1 day", picked: this.settings.dueDate.showWithin1Day, key: "showWithin1Day" },
      { label: "Within 3 days", picked: this.settings.dueDate.showWithin3Days, key: "showWithin3Days" },
      { label: "Within 7 days", picked: this.settings.dueDate.showWithin7Days, key: "showWithin7Days" },
      { label: "Overdue", picked: this.settings.dueDate.showOverdue, key: "showOverdue" },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: "Due date indicators",
    });

    if (!picked) {
      return;
    }

    const keys = new Set(picked.map((item) => item.key));
    this.settings = {
      ...this.settings,
      dueDate: {
        showWithin1Day: keys.has("showWithin1Day"),
        showWithin3Days: keys.has("showWithin3Days"),
        showWithin7Days: keys.has("showWithin7Days"),
        showOverdue: keys.has("showOverdue"),
      },
    };
    this.emitter.fire();
  }

  resetTicketSettings(): void {
    this.settings = getDefaultTicketListSettings();
    this.emitter.fire();
  }

  getSettingsItems(): vscode.TreeItem[] {
    const priorityOptions = collectOptions(
      this.tickets,
      (ticket) => ticket.priorityId,
      (ticket) => ticket.priorityName,
    );
    const statusOptions = collectOptions(
      this.tickets,
      (ticket) => ticket.statusId,
      (ticket) => ticket.statusName,
    );
    const trackerOptions = collectOptions(
      this.tickets,
      (ticket) => ticket.trackerId,
      (ticket) => ticket.trackerName,
    );
    const assigneeOptions = collectOptions(
      this.tickets,
      (ticket) => ticket.assigneeId,
      (ticket) => ticket.assigneeName,
    );

    const assigneeTotal = assigneeOptions.length + 1;
    const assigneeSelected =
      this.settings.filters.assigneeIds.length +
      (this.settings.filters.includeUnassigned ? 1 : 0);

    return [
      new TicketSettingsItem(
        "Filter: Priority",
        formatSelectionSummary(this.settings.filters.priorityIds.length, priorityOptions.length),
        { command: TICKET_SETTINGS_COMMANDS.priorityFilter, title: "Filter by priority" },
      ),
      new TicketSettingsItem(
        "Filter: Status",
        formatSelectionSummary(this.settings.filters.statusIds.length, statusOptions.length),
        { command: TICKET_SETTINGS_COMMANDS.statusFilter, title: "Filter by status" },
      ),
      new TicketSettingsItem(
        "Filter: Tracker",
        formatSelectionSummary(this.settings.filters.trackerIds.length, trackerOptions.length),
        { command: TICKET_SETTINGS_COMMANDS.trackerFilter, title: "Filter by tracker" },
      ),
      new TicketSettingsItem(
        "Filter: Assignee",
        formatSelectionSummary(assigneeSelected, assigneeTotal),
        { command: TICKET_SETTINGS_COMMANDS.assigneeFilter, title: "Filter by assignee" },
      ),
      new TicketSettingsItem(
        "Sort order",
        formatSortSummary(this.settings.sort),
        { command: TICKET_SETTINGS_COMMANDS.sort, title: "Sort order" },
      ),
      new TicketSettingsItem(
        "Due date indicators",
        formatDueDateSummary(this.settings.dueDate),
        { command: TICKET_SETTINGS_COMMANDS.dueDate, title: "Due date indicators" },
      ),
      new TicketSettingsItem(
        "Reset settings",
        "Restore defaults",
        { command: TICKET_SETTINGS_COMMANDS.reset, title: "Reset settings" },
      ),
    ];
  }

  private async pickMultiSelect(
    title: string,
    options: TicketOption[],
    selectedIds: number[],
  ): Promise<number[] | undefined> {
    if (options.length === 0) {
      void vscode.window.showInformationMessage("No options available for this filter.");
      return undefined;
    }

    const items: Array<vscode.QuickPickItem & { id: number }> = options.map((option) => ({
      label: option.label,
      picked: selectedIds.includes(option.id),
      id: option.id,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title,
    });

    if (!picked) {
      return undefined;
    }

    return picked.map((item) => item.id);
  }
}

export class TicketTreeItem extends vscode.TreeItem {
  constructor(
    public readonly node: TreeNode<Ticket>,
    dueDateIndicator: string | undefined,
    isExpanded: boolean,
  ) {
    super(
      `#${node.data.id} ${node.data.subject}`,
      node.children.length > 0
        ? isExpanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.id = String(node.data.id);
    const status = node.data.statusName ?? "";
    if (status && dueDateIndicator) {
      this.description = `${status} \u00b7 ${dueDateIndicator}`;
    } else {
      this.description = status || dueDateIndicator || "";
    }
    this.contextValue = "redmineTicket";
    this.command = {
      command: "todoex.openTicketPreview",
      title: "Open Ticket Preview",
      arguments: [this],
    };
  }

  get ticket(): Ticket {
    return this.node.data;
  }

  get childNodes(): Array<TreeNode<Ticket>> {
    return this.node.children;
  }
}
