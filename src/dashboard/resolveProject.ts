import type { DashboardProjectNode } from "./dashboardProtocol";

export interface ResolvedProject {
  id: number;
  name: string;
}

/**
 * 現在のプロジェクトを解決する純粋関数。
 * 優先順位: 選択済みプロジェクト ID > defaultProjectId (数値) > undefined
 */
export const resolveCurrentProject = (opts: {
  selectionId?: number;
  selectionName?: string;
  defaultProjectId?: string;
  projects?: DashboardProjectNode[];
}): ResolvedProject | undefined => {
  if (opts.selectionId && opts.selectionId > 0) {
    return { id: opts.selectionId, name: opts.selectionName ?? "" };
  }

  if (!opts.defaultProjectId) {
    return undefined;
  }
  const fallbackId = Number(opts.defaultProjectId);
  if (Number.isNaN(fallbackId) || fallbackId <= 0) {
    return undefined;
  }

  const project = opts.projects?.find((p) => p.id === fallbackId);
  return { id: fallbackId, name: project?.name ?? `Project #${fallbackId}` };
};
