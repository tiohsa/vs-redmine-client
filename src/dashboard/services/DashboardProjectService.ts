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
  resetTickets: () => void;
  loadTickets: () => Promise<void>;
}

export class DashboardProjectService {
  constructor(private readonly deps: DashboardProjectServiceDeps) {}

  getResolvedProject(): ResolvedProject | undefined {
    const selection = getProjectSelection();
    return resolveCurrentProject({
      selectionId: selection.id,
      selectionName: selection.name,
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
    const project = this.deps.getProjects().find((p) => p.id === projectId);
    await setProjectSelection(projectId, project?.name ?? "");
    this.deps.resetTickets();
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
