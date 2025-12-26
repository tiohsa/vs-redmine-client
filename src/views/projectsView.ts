import * as vscode from "vscode";
import { getProjectSelection } from "../config/projectSelection";
import { listProjects } from "../redmine/projects";
import { Project } from "../redmine/types";
import { showError } from "../utils/notifications";
import { createEmptyStateItem, createErrorStateItem } from "./viewState";

export const buildProjectTreeItems = (
  projects: Project[],
  selectedProjectId?: number,
): ProjectTreeItem[] =>
  projects.map((project) => new ProjectTreeItem(project, project.id === selectedProjectId));

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

  return buildProjectTreeItems(projects, selectedProjectId);
};

export class ProjectsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  private projects: Project[] = [];
  private errorMessage?: string;
  private selectedProjectId?: number;

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

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    return buildProjectsViewItems(this.projects, this.selectedProjectId, this.errorMessage);
  }

  getProjectItemById(projectId: number): ProjectTreeItem | undefined {
    return buildProjectTreeItems(this.projects, this.selectedProjectId).find(
      (item) => item.project.id === projectId,
    );
  }
}

export class ProjectTreeItem extends vscode.TreeItem {
  constructor(public readonly project: Project, isSelected: boolean) {
    super(project.name, vscode.TreeItemCollapsibleState.None);
    this.id = String(project.id);
    this.contextValue = isSelected ? "redmineProjectSelected" : "redmineProject";
    this.description = isSelected ? "Selected" : "";
  }
}
