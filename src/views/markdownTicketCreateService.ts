import { getProjectSelection } from "../config/projectSelection";
import { getDefaultProjectId } from "../config/settings";
import type { TicketCreateDependencies } from "./ticketSync/types";
import { defaultCreateDeps } from "./ticketSync/ticketSyncDeps";
import { createTicketFromContent } from "./ticketSync/ticketCreateSync";
import { updateMarkdownTicketHeader, validateMarkdownTicketHeader } from "./markdownTicketHeaderUpdater";

export type MarkdownTicketCreatePreview = {
  projectId: number;
  subject: string;
  tracker: string;
  priority: string;
  status: string;
};

export type MarkdownTicketCreateResult =
  | {
      status: "created";
      issueId: number;
      updatedContent: string;
      preview: MarkdownTicketCreatePreview;
    }
  | {
      status: "failed";
      message: string;
    }
  | {
      status: "header-update-failed";
      issueId: number;
      preview: MarkdownTicketCreatePreview;
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

export const createTicketFromMarkdownContent = async (input: {
  content: string;
  projectId?: number;
  baseDir?: string;
  deps?: Partial<TicketCreateDependencies>;
  now?: () => Date;
}): Promise<MarkdownTicketCreateResult> => {
  let preview: MarkdownTicketCreatePreview;
  try {
    preview = previewMarkdownTicketCreation(input.content, {
      getSelectedProjectId: () => input.projectId ?? getProjectSelection().id,
      getDefaultProjectId,
    });
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Invalid metadata.",
    };
  }

  const output = await createTicketFromContent({
    content: input.content,
    projectId: preview.projectId,
    baseDir: input.baseDir,
    deps: { ...defaultCreateDeps, ...input.deps },
  });
  if (output.result.status !== "created" || !output.createdId || !output.parsed) {
    return {
      status: "failed",
      message: output.result.message,
    };
  }

  try {
    return {
      status: "created",
      issueId: output.createdId,
      preview,
      updatedContent: updateMarkdownTicketHeader({
        content: input.content,
        projectId: preview.projectId,
        issueId: output.createdId,
        syncedAt: (input.now ?? (() => new Date()))().toISOString(),
        parsedContent: output.parsed,
      }),
    };
  } catch {
    return {
      status: "header-update-failed",
      issueId: output.createdId,
      preview,
    };
  }
};
