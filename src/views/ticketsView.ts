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
import { getCurrentUserId } from "../redmine/users";
import { Ticket } from "../redmine/types";
import { getTicketDraft } from "./ticketDraftStore";
import { showError } from "../utils/notifications";
import { setViewContext } from "./viewContext";
import { createEmptyStateItem, createErrorStateItem } from "./viewState";
import { buildTree, collectTreeNodeIds } from "./treeBuilder";
import { TreeBuildResult, TreeNode, TreeSource } from "./treeTypes";
import { isTreeExpanded, setTreeExpandedBulk } from "./treeState";
import { createCycleWarningItem } from "./treeWarnings";
import { createSelectionIcon } from "./selectionHighlight";
import { rememberTicketSummaries, setTicketSummary } from "./ticketSummaryStore";
import {
  applyTicketViewPipeline,
  buildDueIndicatorsMap,
  DEFAULT_TICKET_LIST_SETTINGS,
  TicketListSettings,
} from "./projectListSettings";
import {
  configureAssigneeFilter,
  configureDueDateDisplay,
  configurePriorityFilter,
  configureSort,
  configureStatusFilter,
  configureTitleFilter,
  configureTrackerFilter,
} from "./ticketFilterConfigurator";
import { buildTicketSettingsItems } from "./ticketSettingsItems";

export { TicketSettingsItem } from "./ticketSettingsItems";

export const TICKET_RELOAD_COMMAND = "redmine-client.reloadTicket";

export const CREATE_TICKET_CONTEXT_KEY = "redmine-client.canCreateTickets";
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

const cloneTicketListSettings = (settings: TicketListSettings): TicketListSettings => ({
  filters: { ...settings.filters },
  sort: { ...settings.sort },
  dueDate: { ...settings.dueDate },
});

const getDefaultTicketListSettings = (): TicketListSettings =>
  cloneTicketListSettings(DEFAULT_TICKET_LIST_SETTINGS);

const buildTicketTreeSources = (tickets: Ticket[]): Array<TreeSource<Ticket>> => {
  const idSet = new Set(tickets.map((t) => t.id));
  return tickets.map((ticket) => ({
    id: ticket.id,
    parentId: ticket.parentId,
    label: `#${ticket.id} ${ticket.subject}`,
    data: ticket,
    parentNotLoaded:
      ticket.parentId !== undefined && !idSet.has(ticket.parentId),
  }));
};

const collectTicketNodes = (
  nodes: Array<TreeNode<Ticket>>,
  bucket: Array<TreeNode<Ticket>> = [],
): Array<TreeNode<Ticket>> => {
  nodes.forEach((node) => {
    bucket.push(node);
    if (node.children.length > 0) {
      collectTicketNodes(node.children, bucket);
    }
  });
  return bucket;
};

const ensureTicketItem = (
  node: TreeNode<Ticket>,
  dueIndicators: Map<number, string | undefined>,
  selectedTicketId: number | undefined,
  itemCache: Map<number, TicketTreeItem>,
): TicketTreeItem => {
  const isExpanded =
    node.children.length > 0 && isTreeExpanded(TICKETS_VIEW_KEY, String(node.data.id));
  const dueIndicator = dueIndicators.get(node.data.id);
  const isSelected = node.data.id === selectedTicketId;
  const existing = itemCache.get(node.data.id);
  if (existing) {
    existing.update(node, dueIndicator, isSelected, isExpanded);
    return existing;
  }
  const created = new TicketTreeItem(node, dueIndicator, isSelected, isExpanded);
  itemCache.set(node.data.id, created);
  return created;
};

const buildTicketTreeItems = (
  nodes: Array<TreeNode<Ticket>>,
  dueIndicators: Map<number, string | undefined>,
  selectedTicketId?: number,
  itemCache?: Map<number, TicketTreeItem>,
  pruneCache = false,
): TicketTreeItem[] =>
  itemCache
    ? (() => {
        const nodesToCache = collectTicketNodes(nodes);
        const visibleIds = new Set<number>();
        nodesToCache.forEach((node) => {
          visibleIds.add(node.data.id);
          ensureTicketItem(node, dueIndicators, selectedTicketId, itemCache);
        });
        if (pruneCache) {
          Array.from(itemCache.keys()).forEach((id) => {
            if (!visibleIds.has(id)) {
              itemCache.delete(id);
            }
          });
        }
        return nodes.map((node) =>
          ensureTicketItem(node, dueIndicators, selectedTicketId, itemCache),
        );
      })()
    : nodes.map(
        (node) =>
          new TicketTreeItem(
            node,
            dueIndicators.get(node.data.id),
            node.data.id === selectedTicketId,
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

const getDraftStatusIcon = (ticketId: number): vscode.ThemeIcon | undefined => {
  const draft = getTicketDraft(ticketId);
  if (!draft) { return undefined; }
  switch (draft.status) {
    case "Draft": return new vscode.ThemeIcon("edit");
    case "Dirty": return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("list.warningForeground"));
    case "Syncing": return new vscode.ThemeIcon("loading~spin");
    case "Failed": return new vscode.ThemeIcon("error");
    case "Conflict": return new vscode.ThemeIcon("warning");
    default: return undefined;
  }
};

const RELEVANT_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const isTicketRelevant = (
  ticket: Ticket,
  currentUserId?: number,
): boolean => {
  const draft = getTicketDraft(ticket.id);
  if (draft && draft.status !== "Synced") { return true; }
  if (ticket.updatedAt && Date.now() - new Date(ticket.updatedAt).getTime() <= RELEVANT_DAYS_MS) {
    return true;
  }
  if (currentUserId && ticket.assigneeId === currentUserId) { return true; }
  return false;
};

export const buildTicketsViewItems = (
  tickets: Ticket[],
  selectedProjectId?: number,
  errorMessage?: string,
  settings: TicketListSettings = DEFAULT_TICKET_LIST_SETTINGS,
  now: Date = new Date(),
  selectedTicketId?: number,
  itemCache?: Map<number, TicketTreeItem>,
): vscode.TreeItem[] => {
  if (errorMessage) {
    if (itemCache) { itemCache.clear(); }
    return [createErrorStateItem(errorMessage)];
  }

  if (!selectedProjectId) {
    if (itemCache) { itemCache.clear(); }
    return [createEmptyStateItem("Select a project to view tickets.")];
  }

  if (tickets.length === 0) {
    if (itemCache) { itemCache.clear(); }
    return [createEmptyStateItem("No tickets for the selected project.")];
  }

  const visibleTickets = applyTicketViewPipeline(tickets, settings);

  if (visibleTickets.length === 0) {
    if (itemCache) { itemCache.clear(); }
    return [createEmptyStateItem("No tickets match the current filters.")];
  }

  const dueIndicators = buildDueIndicatorsMap(visibleTickets, settings.dueDate, now);
  const treeResult = buildTree(buildTicketTreeSources(visibleTickets));
  const warningItems = buildTicketCycleWarnings(visibleTickets, treeResult.cycleIds);
  const ticketItems = buildTicketTreeItems(
    treeResult.roots,
    dueIndicators,
    selectedTicketId,
    itemCache,
    true,
  );
  return [...warningItems, ...ticketItems];
};

export class LoadMoreTicketsItem extends vscode.TreeItem {
  constructor(loaded: number, total: number) {
    super(
      `Load more… (${loaded} / ${total})`,
      vscode.TreeItemCollapsibleState.None,
    );
    this.iconPath = new vscode.ThemeIcon("ellipsis");
    this.command = {
      command: "redmine-client.loadMoreTickets",
      title: "Load More Tickets",
      arguments: [],
    };
    this.tooltip = `${loaded} 件表示中 / 全 ${total} 件`;
  }
}

export class TicketsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  private tickets: Ticket[] = [];
  private totalCount = 0;
  private offset = 0;
  private errorMessage?: string;
  private selectedProjectId?: number;
  private selectedTicketId?: number;
  private settings = getDefaultTicketListSettings();
  private rootNodes: Array<TreeNode<Ticket>> = [];
  private ticketItemsById = new Map<number, TicketTreeItem>();
  private showRelevantOnly: boolean = true;
  private currentUserId?: number;

  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    void this.loadTickets();
  }

  notifyChange(): void {
    this.emitter.fire();
  }

  async loadTickets(): Promise<void> {
    try {
      this.errorMessage = undefined;
      this.offset = 0;
      refreshCreateTicketContext();
      const selection = getProjectSelection();
      const fallbackId = Number(getDefaultProjectId());
      const projectId = selection.id ?? (Number.isNaN(fallbackId) ? undefined : fallbackId);

      this.selectedProjectId = projectId;
      if (!projectId) {
        this.tickets = [];
        this.totalCount = 0;
        this.emitter.fire();
        return;
      }

      const result = await listIssues({
        projectId,
        includeChildProjects: getIncludeChildProjects(),
        limit: getTicketListLimit(),
        offset: 0,
      });

      this.tickets = result.tickets;
      this.totalCount = result.totalCount;
      rememberTicketSummaries(this.tickets);
      try {
        this.currentUserId = await getCurrentUserId();
      } catch {
        // Ignore user ID lookup failure.
      }
      this.emitter.fire();
    } catch (error) {
      const message = (error as Error).message;
      this.errorMessage = `Failed to load tickets: ${message}`;
      showError(this.errorMessage);
      this.emitter.fire();
    }
  }

  async loadMoreTickets(): Promise<void> {
    if (!this.selectedProjectId || this.tickets.length >= this.totalCount) {
      return;
    }
    try {
      const limit = getTicketListLimit();
      const nextOffset = this.tickets.length;
      const result = await listIssues({
        projectId: this.selectedProjectId,
        includeChildProjects: getIncludeChildProjects(),
        limit,
        offset: nextOffset,
      });
      this.tickets = [...this.tickets, ...result.tickets];
      this.totalCount = result.totalCount;
      this.offset = nextOffset;
      rememberTicketSummaries(result.tickets);
      this.emitter.fire();
    } catch (error) {
      const message = (error as Error).message;
      showError(`Failed to load more tickets: ${message}`);
    }
  }

  getTotalCount(): number {
    return this.totalCount;
  }

  setOffset(offset: number): void {
    this.offset = offset;
    this.refresh();
  }

  setSelectedProjectId(projectId?: number): void {
    this.selectedProjectId = projectId;
    this.selectedTicketId = undefined;
    this.refresh();
  }

  setSelectedTicketId(ticketId?: number): void {
    this.selectedTicketId = ticketId;
    this.emitter.fire();
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
      return buildTicketTreeItems(
        element.childNodes,
        dueIndicators,
        this.selectedTicketId,
        this.ticketItemsById,
      );
    }

    return this.getViewItems();
  }

  setTicketsState(tickets: Ticket[], selectedProjectId?: number): void {
    this.tickets = tickets;
    this.selectedProjectId = selectedProjectId;
    this.errorMessage = undefined;
    rememberTicketSummaries(this.tickets);
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
    setTicketSummary(ticketId, subject);
    this.emitter.fire();
    return true;
  }

  collapseAllVisible(): void {
    if (this.errorMessage || !this.selectedProjectId) {
      return;
    }
    const preFiltered = this.showRelevantOnly
      ? this.tickets.filter((t) => isTicketRelevant(t, this.currentUserId))
      : this.tickets;
    const { treeResult } = this.getVisibleTreeResult(preFiltered);
    const nodeIds = collectTreeNodeIds(treeResult.roots).map(String);
    setTreeExpandedBulk(TICKETS_VIEW_KEY, nodeIds, false);
    this.emitter.fire();
  }

  getViewItems(): vscode.TreeItem[] {
    const visibleTickets = this.showRelevantOnly
      ? this.tickets.filter((t) => isTicketRelevant(t, this.currentUserId))
      : this.tickets;

    const items = buildTicketsViewItems(
      visibleTickets,
      this.selectedProjectId,
      this.errorMessage,
      this.settings,
      new Date(),
      this.selectedTicketId,
      this.ticketItemsById,
    );

    if (this.errorMessage || !this.selectedProjectId) {
      this.rootNodes = [];
      return items;
    }

    const { treeResult } = this.getVisibleTreeResult(visibleTickets);
    this.rootNodes = treeResult.roots;

    // サーバー側にまだ未取得のチケットがある場合は「Load more」を表示する
    if (this.tickets.length < this.totalCount) {
      items.push(new LoadMoreTicketsItem(this.tickets.length, this.totalCount));
    }

    return items;
  }

  toggleRelevantView(): void {
    this.showRelevantOnly = !this.showRelevantOnly;
    this.emitter.fire();
  }

  isRelevantOnlyMode(): boolean {
    return this.showRelevantOnly;
  }

  getTicketItemById(ticketId: number): TicketTreeItem | undefined {
    return this.ticketItemsById.get(ticketId);
  }

  getTickets(): Ticket[] {
    return this.tickets;
  }

  getSelectedProjectId(): number | undefined {
    return this.selectedProjectId;
  }

  async configurePriorityFilter(): Promise<void> {
    const next = await configurePriorityFilter(this.tickets, this.settings);
    if (next) { this.settings = next; this.emitter.fire(); }
  }

  async configureTitleFilter(): Promise<void> {
    const next = await configureTitleFilter(this.settings);
    if (next) { this.settings = next; this.emitter.fire(); }
  }

  async configureStatusFilter(): Promise<void> {
    const next = await configureStatusFilter(this.tickets, this.settings);
    if (next) { this.settings = next; this.emitter.fire(); }
  }

  async configureTrackerFilter(): Promise<void> {
    const next = await configureTrackerFilter(this.tickets, this.settings);
    if (next) { this.settings = next; this.emitter.fire(); }
  }

  async configureAssigneeFilter(): Promise<void> {
    const next = await configureAssigneeFilter(this.tickets, this.settings);
    if (next) { this.settings = next; this.emitter.fire(); }
  }

  async configureSort(): Promise<void> {
    const next = await configureSort(this.settings);
    if (next) { this.settings = next; this.emitter.fire(); }
  }

  async configureDueDateDisplay(): Promise<void> {
    const next = await configureDueDateDisplay(this.settings);
    if (next) { this.settings = next; this.emitter.fire(); }
  }

  resetTicketSettings(): void {
    this.settings = getDefaultTicketListSettings();
    this.emitter.fire();
  }

  getSettingsItems(): vscode.TreeItem[] {
    return buildTicketSettingsItems(this.tickets, this.settings);
  }

  private getVisibleTreeResult(preFiltered?: Ticket[]): {
    visibleTickets: Ticket[];
    treeResult: TreeBuildResult<Ticket>;
  } {
    const base = preFiltered ?? this.tickets;
    const visibleTickets = applyTicketViewPipeline(base, this.settings);
    const treeResult = buildTree(buildTicketTreeSources(visibleTickets));
    return { visibleTickets, treeResult };
  }

  private buildDueIndicators(): Map<number, string | undefined> {
    const visibleTickets = applyTicketViewPipeline(this.tickets, this.settings);
    return buildDueIndicatorsMap(visibleTickets, this.settings.dueDate, new Date());
  }
}

export class TicketTreeItem extends vscode.TreeItem {
  constructor(
    public node: TreeNode<Ticket>,
    dueDateIndicator: string | undefined,
    isSelected: boolean,
    isExpanded: boolean,
  ) {
    super("", vscode.TreeItemCollapsibleState.None);
    this.id = String(node.data.id);
    this.contextValue = "redmineTicket";
    this.command = {
      command: "redmine-client.openTicketPreview",
      title: "Open Ticket Preview",
      arguments: [this],
    };
    this.update(node, dueDateIndicator, isSelected, isExpanded);
  }

  update(
    node: TreeNode<Ticket>,
    dueDateIndicator: string | undefined,
    isSelected: boolean,
    isExpanded: boolean,
  ): void {
    this.node = node;
    this.label = node.level > 0
      ? `↳ #${node.data.id} ${node.data.subject}`
      : `#${node.data.id} ${node.data.subject}`;
    this.collapsibleState =
      node.children.length > 0
        ? isExpanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;
    const status = node.data.statusName ?? "";
    if (status && dueDateIndicator) {
      this.description = `${status} · ${dueDateIndicator}`;
    } else {
      this.description = status || dueDateIndicator || "";
    }
    const draftStatusIcon = getDraftStatusIcon(node.data.id);
    this.iconPath = draftStatusIcon ?? createSelectionIcon(
      node.children.length > 0 ? "folder" : "file-text",
      isSelected,
    );
    if (node.parentNotLoaded && node.data.parentId !== undefined) {
      this.tooltip = `Parent ticket #${node.data.parentId} is not loaded in the current view.`;
    }
  }

  get ticket(): Ticket {
    return this.node.data;
  }

  get childNodes(): Array<TreeNode<Ticket>> {
    return this.node.children;
  }
}
