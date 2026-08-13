import { getProjectSelection } from "../config/projectSelection";
import { getDefaultProjectId } from "../config/settings";
import { validateMarkdownTicketHeader } from "./markdownTicketHeaderUpdater";

export type MarkdownTicketCreatePreview = {
  projectId: number;
  subject: string;
  tracker: string;
  priority: string;
  status: string;
};

type ProjectResolutionDeps = {
  getSelectedProjectId: () => number | undefined;
  getDefaultProjectId: () => string;
};

const defaultProjectResolutionDeps: ProjectResolutionDeps = {
  getSelectedProjectId: () => getProjectSelection().id,
  getDefaultProjectId,
};

const resolveProjectId = (
  headerProjectId: number | undefined,
  deps: ProjectResolutionDeps,
): number => {
  if (headerProjectId) {
    return headerProjectId;
  }
  const selectedProjectId = deps.getSelectedProjectId();
  if (selectedProjectId) {
    return selectedProjectId;
  }
  const fallback = Number(deps.getDefaultProjectId());
  if (!Number.isNaN(fallback) && fallback > 0) {
    return fallback;
  }
  throw new Error("Select a project or set a default project ID before creating tickets.");
};

export const previewMarkdownTicketCreation = (
  content: string,
  deps: ProjectResolutionDeps = defaultProjectResolutionDeps,
): MarkdownTicketCreatePreview => {
  const parsed = validateMarkdownTicketHeader(content);
  return {
    projectId: resolveProjectId(parsed.controlFields?.project_id, deps),
    subject: parsed.subject,
    tracker: parsed.metadata.tracker,
    priority: parsed.metadata.priority,
    status: parsed.metadata.status,
  };
};
