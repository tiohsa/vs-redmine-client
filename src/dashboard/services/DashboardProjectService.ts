import * as vscode from "vscode";
import { clearProjectSelection, getProjectSelection, setAllProjectsSelection, setProjectSelection } from "../../config/projectSelection";
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
  private loadGeneration = 0;
  private connectionGeneration = 0;

  constructor(private readonly deps: DashboardProjectServiceDeps) {}

  getResolvedProject(): ResolvedProject | undefined {
    if (this.selectedProject.allProjects) { return undefined; }
    return resolveCurrentProject({
      selectionId: this.selectedProject.id,
      selectionName: this.selectedProject.name,
      defaultProjectId: getDefaultProjectId(),
      projects: this.deps.getProjects(),
    });
  }

  invalidate(): void {
    this.loadGeneration++;
  }

  async loadProjects(throwOnError = false): Promise<void> {
    const generation = ++this.loadGeneration;
    try {
      const raw = await listProjects(true);
      if (generation !== this.loadGeneration) {
        return;
      }
      const projects = this.buildProjectNodes(raw);
      this.deps.setProjects(projects);
      this.deps.context.store.update({ projects });
    } catch (err) {
      // keep existing project list when loading fails
      if (throwOnError) {
        throw err;
      }
    }
  }

  async resetForConnectionChange(): Promise<void> {
    this.connectionGeneration++;
    this.loadGeneration++;
    this.selectedProject = {};
    this.deps.setProjects([]);
    this.deps.resetTickets(undefined);
    // 旧接続の保存が完了してから消去し、新接続の選択とも順序を揃える。
    const operation = this.selectionQueue.then(() => clearProjectSelection());
    this.selectionQueue = operation.catch(() => undefined);
    await operation;
  }

  async selectProject(projectId?: number): Promise<void> {
    const generation = this.connectionGeneration;
    const operation = this.selectionQueue.then(() => this.selectProjectNow(projectId, generation));
    this.selectionQueue = operation.catch(() => undefined);
    return operation;
  }

  private async selectProjectNow(projectId: number | undefined, generation: number): Promise<void> {
    if (generation !== this.connectionGeneration) {
      return;
    }
    if (projectId !== undefined && this.deps.getProjects().length === 0) {
      await this.loadProjects();
    }
    if (generation !== this.connectionGeneration) {
      return;
    }
    const project = this.deps.getProjects().find((p) => p.id === projectId);
    if (projectId !== undefined && !project) {
      throw new Error(`Project ${projectId} is not available.`);
    }
    this.selectedProject = project ? { id: project.id, name: project.name } : { allProjects: true };
    this.deps.resetTickets(project);
    try {
      if (project) { await setProjectSelection(project.id, project.name); }
      else { await setAllProjectsSelection(); }
    } catch (err) {
      this.deps.context.notifyToast(
        "warning",
        vscode.l10n.t("Project selected for this session, but saving it failed: {0}", err instanceof Error ? err.message : String(err)),
      );
    }
    if (generation === this.connectionGeneration) { await this.deps.loadTickets(); }
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
