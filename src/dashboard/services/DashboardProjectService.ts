import * as vscode from "vscode";
import { getProjectSelection, setProjectSelection } from "../../config/projectSelection";
import { getDefaultProjectId } from "../../config/settings";
import { listProjects } from "../../redmine/projects";
import { resolveCurrentProject, type ResolvedProject } from "../resolveProject";
import type { DashboardProjectNode } from "../dashboardProtocol";
import type { DashboardServiceContext } from "./DashboardServiceContext";

interface DashboardProjectServiceDeps {
  context: DashboardServiceContext;
  getProjects: () => DashboardProjectNode[];
  setProjects: (projects: DashboardProjectNode[]) => void;
  resetTickets: (project: DashboardProjectNode | undefined) => void;
  loadTickets: () => Promise<void>;
}

export class DashboardProjectService {
  private selectedProject = getProjectSelection();
  private selectionQueue = Promise.resolve();

  constructor(private readonly deps: DashboardProjectServiceDeps) {}

  getResolvedProject(): ResolvedProject | undefined {
    return resolveCurrentProject({
      selectionId: this.selectedProject.id,
      selectionName: this.selectedProject.name,
      defaultProjectId: getDefaultProjectId(),
      projects: this.deps.getProjects(),
    });
  }

  async loadProjects(): Promise<void> {
    try {
      const raw = await listProjects(true);
      const projects = this.buildProjectNodes(raw);
      this.deps.setProjects(projects);
      this.deps.context.store.update({ projects });
    } catch {
      // keep existing project list when loading fails
    }
  }

  async selectProject(projectId: number): Promise<void> {
    const operation = this.selectionQueue.then(() => this.selectProjectNow(projectId));
    this.selectionQueue = operation.catch(() => undefined);
    return operation;
  }

  private async selectProjectNow(projectId: number): Promise<void> {
    if (this.deps.getProjects().length === 0) {
      await this.loadProjects();
    }
    const project = this.deps.getProjects().find((p) => p.id === projectId);
    if (!project) {
      throw new Error(`Project ${projectId} is not available.`);
    }
    this.selectedProject = { id: project.id, name: project.name };
    this.deps.resetTickets(project);
    try {
      await setProjectSelection(project.id, project.name);
    } catch (err) {
      this.deps.context.notifyToast(
        "warning",
        `Project selected for this session, but saving it failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await this.deps.loadTickets();
  }

  async toggleIncludeChildren(include: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration("redmine-client")
      .update("includeChildProjects", include, vscode.ConfigurationTarget.Global);
    await this.deps.loadTickets();
  }

  private buildProjectNodes(
    projects: Array<{ id: number; name: string; identifier: string; parentId?: number }>,
  ): DashboardProjectNode[] {
    const byId = new Map(projects.map((p) => [p.id, p]));
    const computeLevel = (id: number, visited = new Set<number>()): number => {
      if (visited.has(id)) {
        return 0;
      }
      visited.add(id);
      const p = byId.get(id);
      if (!p?.parentId) {
        return 0;
      }
      return 1 + computeLevel(p.parentId, visited);
    };
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      identifier: p.identifier,
      parentId: p.parentId,
      level: computeLevel(p.id),
    }));
  }
}
