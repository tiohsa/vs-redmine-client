import * as vscode from "vscode";
import { TicketUpdateFields } from "../../redmine/types";
import { IssueMetadata } from "../ticketMetadataTypes";
import type { TicketCreateDependencies, TicketSaveDependencies } from "./types";

export const computeChanges = (
  baseSubject: string,
  baseDescription: string,
  subject: string,
  description: string,
): TicketUpdateFields => {
  const changes: TicketUpdateFields = {};
  if (subject !== baseSubject) {
    changes.subject = subject;
  }
  if (description !== baseDescription) {
    changes.description = description;
  }
  return changes;
};

export const computeMetadataChanges = (
  baseMetadata: IssueMetadata,
  nextMetadata: IssueMetadata,
): Partial<IssueMetadata> => {
  const changes: Partial<IssueMetadata> = {};
  const baseStartDate = baseMetadata.start_date ?? "";
  const nextStartDate = nextMetadata.start_date ?? "";
  if (baseMetadata.tracker !== nextMetadata.tracker) {
    changes.tracker = nextMetadata.tracker;
  }
  if (baseMetadata.priority !== nextMetadata.priority) {
    changes.priority = nextMetadata.priority;
  }
  if (baseMetadata.status !== nextMetadata.status) {
    changes.status = nextMetadata.status;
  }
  if (baseMetadata.due_date !== nextMetadata.due_date) {
    changes.due_date = nextMetadata.due_date;
  }
  if (baseStartDate !== nextStartDate) {
    changes.start_date = nextStartDate;
  }
  if (baseMetadata.done_ratio !== nextMetadata.done_ratio) {
    changes.done_ratio = nextMetadata.done_ratio;
  }
  if (baseMetadata.estimated_hours !== nextMetadata.estimated_hours) {
    changes.estimated_hours = nextMetadata.estimated_hours;
  }
  if ((baseMetadata.assignee ?? "") !== (nextMetadata.assignee ?? "")) {
    changes.assignee = nextMetadata.assignee ?? "";
  }
  if (baseMetadata.assignee_id !== nextMetadata.assignee_id) {
    changes.assignee_id = nextMetadata.assignee_id;
  }
  return changes;
};

const resolveAssigneeId = async (
  assigneeName: string,
  deps: Pick<TicketSaveDependencies, "searchUsers" | "listProjectMembers">,
  projectId?: number,
): Promise<number> => {
  // listProjectMembers は管理者権限不要なため優先して使用
  if (deps.listProjectMembers !== undefined && projectId !== undefined) {
    const members = await deps.listProjectMembers(projectId);
    const match = members.find((m) => m.name === assigneeName);
    if (match) {
      return match.id;
    }
    throw new Error(`Unknown assignee: ${assigneeName}`);
  }
  // フォールバック: searchUsers（管理者権限が必要な環境向け）
  const results = await deps.searchUsers(assigneeName);
  const match = results.find((u) => u.name === assigneeName);
  if (!match) {
    throw new Error(`Unknown assignee: ${assigneeName}`);
  }
  return match.id;
};

export const resolveMetadataUpdates = async (
  changes: Partial<IssueMetadata>,
  deps: TicketSaveDependencies,
  projectId?: number,
): Promise<TicketUpdateFields> => {
  const updateFields: TicketUpdateFields = {};
  if (
    changes.tracker === undefined &&
    changes.priority === undefined &&
    changes.status === undefined &&
    changes.due_date === undefined &&
    changes.start_date === undefined &&
    changes.done_ratio === undefined &&
    changes.estimated_hours === undefined &&
    changes.assignee === undefined &&
    changes.assignee_id === undefined
  ) {
    return updateFields;
  }

  const useProjectTrackers =
    changes.tracker !== undefined &&
    projectId !== undefined &&
    deps.getProjectTrackers !== undefined;

  const [statuses, trackers, priorities] = await Promise.all([
    deps.listIssueStatuses(),
    useProjectTrackers ? Promise.resolve([]) : deps.listTrackers(),
    deps.listIssuePriorities(),
  ]);

  if (changes.status !== undefined) {
    const match = statuses.find((item) => item.name === changes.status);
    if (!match) {
      throw new Error(`Unknown status: ${changes.status}`);
    }
    updateFields.statusId = match.id;
  }

  if (changes.tracker !== undefined) {
    if (useProjectTrackers) {
      const projectTrackers = await deps.getProjectTrackers!(projectId!);
      const match = projectTrackers.find((item) => item.name === changes.tracker);
      if (!match) {
        throw new Error(vscode.l10n.t("Tracker not available for this project: {0}", changes.tracker));
      }
      updateFields.trackerId = match.id;
    } else {
      const match = trackers.find((item) => item.name === changes.tracker);
      if (!match) {
        throw new Error(`Unknown tracker: ${changes.tracker}`);
      }
      updateFields.trackerId = match.id;
    }
  }

  if (changes.priority !== undefined) {
    const match = priorities.find((item) => item.name === changes.priority);
    if (!match) {
      throw new Error(`Unknown priority: ${changes.priority}`);
    }
    updateFields.priorityId = match.id;
  }

  if (changes.due_date !== undefined) {
    updateFields.dueDate = changes.due_date.length === 0 ? null : changes.due_date;
  }

  if (changes.start_date !== undefined) {
    updateFields.startDate = changes.start_date.length === 0 ? null : changes.start_date;
  }
  if (changes.done_ratio !== undefined) {
    updateFields.doneRatio = changes.done_ratio;
  }
  if (changes.estimated_hours !== undefined) {
    updateFields.estimatedHours = changes.estimated_hours;
  }

  if (changes.assignee_id !== undefined) {
    updateFields.assigneeId = changes.assignee_id === 0 ? 0 : changes.assignee_id;
  } else if (changes.assignee !== undefined) {
    if (changes.assignee.length === 0) {
      updateFields.assigneeId = 0;
    } else {
      updateFields.assigneeId = await resolveAssigneeId(changes.assignee, deps, projectId);
    }
  }

  return updateFields;
};

export const resolveMetadataForCreate = async (
  metadata: IssueMetadata,
  deps: TicketCreateDependencies,
  projectId?: number,
): Promise<TicketUpdateFields> => {
  const useProjectTrackers = projectId !== undefined && deps.getProjectTrackers !== undefined;

  const [statuses, trackers, priorities] = await Promise.all([
    deps.listIssueStatuses(),
    useProjectTrackers ? Promise.resolve([]) : deps.listTrackers(),
    deps.listIssuePriorities(),
  ]);

  let trackerMatch: { id: number; name: string } | undefined;
  if (useProjectTrackers) {
    const projectTrackers = await deps.getProjectTrackers!(projectId!);
    trackerMatch = projectTrackers.find((item) => item.name === metadata.tracker);
    if (!trackerMatch) {
      throw new Error(vscode.l10n.t("Tracker not available for this project: {0}", metadata.tracker));
    }
  } else {
    trackerMatch = trackers.find((item) => item.name === metadata.tracker);
    if (!trackerMatch) {
      throw new Error(`Unknown tracker: ${metadata.tracker}`);
    }
  }

  const priorityMatch = priorities.find((item) => item.name === metadata.priority);
  if (!priorityMatch) {
    throw new Error(`Unknown priority: ${metadata.priority}`);
  }

  const fields: TicketUpdateFields = {
    trackerId: trackerMatch.id,
    priorityId: priorityMatch.id,
  };

  if (metadata.status && metadata.status.trim().length > 0) {
    const statusMatch = statuses.find((item) => item.name === metadata.status);
    if (!statusMatch) {
      throw new Error(`Unknown status: ${metadata.status}`);
    }
    fields.statusId = statusMatch.id;
  }

  if (metadata.due_date.length > 0) {
    fields.dueDate = metadata.due_date;
  }

  if (metadata.start_date && metadata.start_date.length > 0) {
    fields.startDate = metadata.start_date;
  }
  if (metadata.done_ratio !== undefined) {
    fields.doneRatio = metadata.done_ratio;
  }
  if (metadata.estimated_hours !== undefined) {
    fields.estimatedHours = metadata.estimated_hours;
  }

  if (metadata.assignee_id !== undefined && metadata.assignee_id > 0) {
    fields.assigneeId = metadata.assignee_id;
  } else if (metadata.assignee && metadata.assignee.length > 0) {
    fields.assigneeId = await resolveAssigneeId(metadata.assignee, deps, projectId);
  }

  return fields;
};
