import * as vscode from "vscode";
import { getProjectSelection } from "../config/projectSelection";
import { listProjects } from "../redmine/projects";
import { Project } from "../redmine/types";
import { showError } from "../utils/notifications";
import { MAX_VIEW_ITEMS } from "./viewLimits";
import { createEmptyStateItem, createErrorStateItem } from "./viewState";
import { buildTree, collectTreeNodeIds } from "./treeBuilder";
import { TreeBuildResult, TreeNode, TreeSource } from "./treeTypes";
import { isTreeExpanded, setTreeExpandedBulk } from "./treeState";
import { createCycleWarningItem } from "./treeWarnings";
import { createSelectionIcon } from "./selectionHighlight";

const PROJECTS_VIEW_KEY = "projects";

const buildProjectTreeSources = (projects: Project[]): Array<TreeSource<Project>> =>
  projects.map((project) => ({
    id: project.id,
    parentId: project.parentId,
    label: project.name,
    data: project,
  }));

const buildProjectTreeItems = (
  nodes: Array<TreeNode<Project>>,
  selectedProjectId: number | undefined,
): ProjectTreeItem[] =>
  nodes.map(
    (node) =>
      new ProjectTreeItem(
        node,
        node.data.id === selectedProjectId,
        node.children.length > 0 &&
          isTreeExpanded(PROJECTS_VIEW_KEY, String(node.data.id)),
      ),
  );

const buildCycleWarnings = (
  projects: Project[],
  cycleIds: Set<number>,
): vscode.TreeItem[] => {
  if (cycleIds.size === 0) {
    return [];
  }

  const nameById = new Map(projects.map((project) => [project.id, project.name]));
  return Array.from(cycleIds.values()).map((id) => {
    const label = nameById.get(id) ?? `Project ${id}`;
    return createCycleWarningItem(label);
  });
};

export const buildProjectsViewItems = (
  projects: Project[],
  selectedProjectId?: number,
  errorMessage?: string,
): vscode.TreeItem[] => {
  if (errorMessage) {
    return [createErrorStateItem(errorMessage)];
  }

  if (projects.length === 0) {
    return [createEmptyStateItem("No projects available.")];
  }

  const visibleProjects = projects.slice(0, MAX_VIEW_ITEMS);
  const treeResult = buildTree(buildProjectTreeSources(visibleProjects));
  const warningItems = buildCycleWarnings(visibleProjects, treeResult.cycleIds);
  const projectItems = buildProjectTreeItems(treeResult.roots, selectedProjectId);
  return [...warningItems, ...projectItems];
};

export class ProjectsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  private projects: Project[] = [];
  private errorMessage?: string;
  private selectedProjectId?: number;
  private rootNodes: Array<TreeNode<Project>> = [];

  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    void this.loadProjects();
  }

  async loadProjects(): Promise<void> {
    try {
      this.errorMessage = undefined;
      const selection = getProjectSelection();
      this.selectedProjectId = selection.id;
      this.projects = await listProjects(false);
      this.emitter.fire();
    } catch (error) {
      const message = (error as Error).message;
      this.errorMessage = `Failed to load projects: ${message}`;
      showError(this.errorMessage);
      this.emitter.fire();
    }
  }

  setSelectedProjectId(projectId?: number): void {
    this.selectedProjectId = projectId;
    this.emitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getParent(): vscode.ProviderResult<vscode.TreeItem> {
    return undefined;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (element instanceof ProjectTreeItem) {
      return buildProjectTreeItems(element.childNodes, this.selectedProjectId);
    }

    return this.getViewItems();
  }

  collapseAllVisible(): void {
    const { treeResult } = this.getVisibleTreeResult();
    const nodeIds = collectTreeNodeIds(treeResult.roots).map(String);
    setTreeExpandedBulk(PROJECTS_VIEW_KEY, nodeIds, false);
    this.emitter.fire();
  }

  getViewItems(): vscode.TreeItem[] {
    const { visibleProjects, treeResult } = this.getVisibleTreeResult();
    this.rootNodes = treeResult.roots;
    const warningItems = buildCycleWarnings(visibleProjects, treeResult.cycleIds);
    const projectItems = buildProjectTreeItems(treeResult.roots, this.selectedProjectId);
    return [...warningItems, ...projectItems];
  }

  private getVisibleTreeResult(): {
    visibleProjects: Project[];
    treeResult: TreeBuildResult<Project>;
  } {
    const visibleProjects = this.projects.slice(0, MAX_VIEW_ITEMS);
    const treeResult = buildTree(buildProjectTreeSources(visibleProjects));
    return { visibleProjects, treeResult };
  }

  getProjectItemById(projectId: number): ProjectTreeItem | undefined {
    const buildFromNodes = (nodes: Array<TreeNode<Project>>): ProjectTreeItem | undefined => {
      for (const node of nodes) {
        if (node.data.id === projectId) {
          return new ProjectTreeItem(
            node,
            node.data.id === this.selectedProjectId,
            node.children.length > 0 &&
              isTreeExpanded(PROJECTS_VIEW_KEY, String(node.data.id)),
          );
        }
        const child = buildFromNodes(node.children);
        if (child) {
          return child;
        }
      }
      return undefined;
    };

    return buildFromNodes(this.rootNodes);
  }
}

export class ProjectTreeItem extends vscode.TreeItem {
  constructor(
    public readonly node: TreeNode<Project>,
    isSelected: boolean,
    isExpanded: boolean,
  ) {
    super(
      node.data.name,
      node.children.length > 0
        ? isExpanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.id = String(node.data.id);
    this.contextValue = isSelected ? "redmineProjectSelected" : "redmineProject";
    this.description = isSelected ? "Selected" : "";
    this.iconPath = createSelectionIcon(
      node.children.length > 0 ? "folder" : "project",
      isSelected,
    );
  }

  get project(): Project {
    return this.node.data;
  }

  get childNodes(): Array<TreeNode<Project>> {
    return this.node.children;
  }
}
