import type { DashboardProjectNode } from "./dashboardProtocol";
import { isValidProjectId, parseConfiguredProjectId } from "../config/projectSelection";

export interface ResolvedProject {
  id: number;
  name: string;
}

/**
 * 現在のプロジェクトを解決する純粋関数。
 * 優先順位: 選択済みプロジェクト ID > defaultProjectId (ID / identifier) > undefined
 */
export const resolveCurrentProject = (opts: {
  selectionId?: number;
  selectionName?: string;
  defaultProjectId?: string;
  projects?: DashboardProjectNode[];
}): ResolvedProject | undefined => {
  if (isValidProjectId(opts.selectionId)) {
    return { id: opts.selectionId, name: opts.selectionName ?? "" };
  }

  const defaultProjectId = opts.defaultProjectId?.trim();
  if (!defaultProjectId) {
    return undefined;
  }
  const fallbackId = parseConfiguredProjectId(defaultProjectId);
  if (fallbackId !== undefined) {
    const project = opts.projects?.find((p) => p.id === fallbackId);
    return { id: fallbackId, name: project?.name ?? `Project #${fallbackId}` };
  }

  const project = opts.projects?.find((p) => p.identifier === defaultProjectId);
  return project ? { id: project.id, name: project.name } : undefined;
};
