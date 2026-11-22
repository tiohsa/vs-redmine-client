import * as vscode from "vscode";
import { Ticket } from "../../redmine/types";
import { getTicketDraft, getTicketDraftContent } from "../../views/ticketDraftStore";
import {
  getOfflineSyncQueue,
  evaluateOfflineSyncPolicy,
  isAbandoned,
  sameDocumentIdentity,
} from "../../views/offlineSyncStore";
import { getCurrentConnectionScope } from "../../config/connectionScope";
import { buildTree } from "../../views/treeBuilder";
import { TreeNode, TreeSource } from "../../views/treeTypes";
import type {
  DashboardDraftTicketNode,
  DashboardProjectNode,
  DashboardSyncState,
  DashboardTicketDetail,
  DashboardTicketNode,
} from "../dashboardProtocol";
import {
  detectTicketIntentChanges,
  matchesQueuedTicketIntent,
  parseQueuedTicketIntent,
} from "../../views/ticketSync/ticketChangeDetector";
import { parseTicketEditorContent } from "../../views/ticketEditorContent";
import { getPrimaryEffectForRevision, isRejectedTicketCreate } from "../../app/syncEffects";

export const resolveTicketSyncState = (ticketId: number): DashboardSyncState => {
  const scope = getCurrentConnectionScope();
  const draft = getTicketDraft(ticketId, scope);
  const queue = getOfflineSyncQueue(scope);
  const queued = queue.tickets.get(ticketId);
  if (queued && isAbandoned(queued)) { return "Abandoned"; }
  if (!queued && queue.abandonedTickets?.some((entry) => entry.ticketId === ticketId) &&
      !queue.ticketEditAuthorizations?.some((entry) => entry.ticketId === ticketId)) {
    return "Abandoned";
  }
  const lifecycle = queued ? evaluateOfflineSyncPolicy(queued).lifecycle : undefined;
  if (draft?.status === "Syncing") {
    return "Syncing";
  }
  if (lifecycle === "commit_unknown") {
    return "CommitUnknown";
  }
  if (lifecycle === "recovery_pending") {
    return "RecoveryPending";
  }
  const queuedContent = queued ? parseQueuedTicketIntent(queued) : undefined;
  const currentContent = draft ? getTicketDraftContent(ticketId, scope) : undefined;
  const queueState = (): DashboardSyncState | undefined => {
    if (!queued) {
      return undefined;
    }
    if (!currentContent || !queuedContent) {
      return draft?.status === "Dirty" ? "Dirty" : "Queued";
    }
    return matchesQueuedTicketIntent(queuedContent, currentContent) ? "Queued" : "Dirty";
  };

  if (draft) {
    switch (draft.status) {
      case "Failed": return "Failed";
      case "Conflict": return "Conflict";
      case "Draft": return "Draft";
      case "Dirty": {
        const state = queueState();
        return state ?? "Dirty";
      }
      case "Queued": {
        const state = queueState();
        if (state) {
          return state;
        }
        return currentContent && detectTicketIntentChanges({
          subject: draft.baseSubject,
          description: draft.baseDescription,
          metadata: draft.baseMetadata,
        }, currentContent).hasChanges ? "Dirty" : "Synced";
      }
      case "Synced": return queueState() ?? "Synced";
    }
  }
  return queueState() ?? "Synced";
};

const resolveOverlayFields = (ticket: Ticket, syncState: DashboardSyncState) => {
  const draftContent = syncState !== "Synced"
    ? getTicketDraftContent(ticket.id, getCurrentConnectionScope())
    : undefined;
  return {
    subject: draftContent?.subject || ticket.subject,
    description: draftContent ? draftContent.description : ticket.description,
    statusName: draftContent?.metadata.status || ticket.statusName,
    priorityName: draftContent?.metadata.priority || ticket.priorityName,
    trackerName: draftContent?.metadata.tracker || ticket.trackerName,
    assigneeName: draftContent?.metadata.assignee !== undefined
      ? (draftContent.metadata.assignee || undefined)
      : ticket.assigneeName,
    dueDate: draftContent?.metadata.due_date !== undefined
      ? (draftContent.metadata.due_date || undefined)
      : ticket.dueDate,
    startDate: draftContent?.metadata.start_date !== undefined
      ? (draftContent.metadata.start_date || undefined)
      : ticket.startDate,
    doneRatio: draftContent?.metadata.done_ratio !== undefined
      ? draftContent.metadata.done_ratio
      : ticket.doneRatio,
  };
};

const extractFallbackSubject = (content: string): string => {
  const lines = content.split(/\r?\n/);
  let startIndex = 0;
  if (lines[0]?.trim() === "---") {
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (closing !== -1) {
      startIndex = closing + 1;
    }
  }
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.startsWith("#") && !trimmed.startsWith("##")) {
      return trimmed.replace(/^#\s*/, "");
    }
    return "";
  }
  return "";
};

const tryParseDraftContent = (content: string) => {
  try {
    return parseTicketEditorContent(content, {
      allowEmptyStatus: true,
      allowMissingMetadata: true,
      allowMissingSubject: true,
      fallbackMetadata: { tracker: "", priority: "", status: "", due_date: "", start_date: "" },
    });
  } catch {
    return undefined;
  }
};

export const extractNewTicketDraftSubject = (content: string): string =>
  tryParseDraftContent(content)?.subject.trim() || extractFallbackSubject(content);

const resolveAllowedProjectIds = (
  options?: {
    selectedProjectId?: number;
    includeChildProjects?: boolean;
    projects?: DashboardProjectNode[];
  },
): Set<number> | undefined => {
  if (options?.selectedProjectId === undefined) {
    return undefined;
  }
  const allowed = new Set<number>([options.selectedProjectId]);
  if (!options.includeChildProjects || !options.projects?.length) {
    return allowed;
  }
  let added = true;
  while (added) {
    added = false;
    for (const project of options.projects) {
      if (
        project.parentId !== undefined &&
        allowed.has(project.parentId) &&
        !allowed.has(project.id)
      ) {
        allowed.add(project.id);
        added = true;
      }
    }
  }
  return allowed;
};

const buildDashboardNode = (
  node: TreeNode<Ticket>,
  level: number,
  subjectById: Map<number, string>,
): DashboardTicketNode => {
  const syncState = resolveTicketSyncState(node.data.id);
  const overlay = resolveOverlayFields(node.data, syncState);
  return {
    id: node.data.id,
    subject: overlay.subject,
    statusName: overlay.statusName,
    statusId: node.data.statusId,
    priorityName: overlay.priorityName,
    priorityId: node.data.priorityId,
    trackerName: overlay.trackerName,
    trackerId: node.data.trackerId,
    assigneeName: overlay.assigneeName,
    assigneeId: node.data.assigneeId,
    dueDate: overlay.dueDate,
    startDate: overlay.startDate,
    doneRatio: overlay.doneRatio,
    projectId: node.data.projectId,
    projectName: node.data.projectName,
    parentId: node.data.parentId,
    parentSubject: node.data.parentId ? subjectById.get(node.data.parentId) : undefined,
    syncState,
    level,
    children: node.children.map((child) => buildDashboardNode(child, level + 1, subjectById)),
  };
};

export const buildDraftTicketDashboardNodes = (options?: {
  selectedProjectId?: number;
  includeChildProjects?: boolean;
  projects?: DashboardProjectNode[];
}): DashboardDraftTicketNode[] => {
  const scope = getCurrentConnectionScope();
  const queue = getOfflineSyncQueue(scope);
  const allowedProjectIds = resolveAllowedProjectIds(options);
  const nodes: DashboardDraftTicketNode[] = [];
  for (const entry of queue.newTickets) {
    if (isAbandoned(entry) || entry.createdIssueId !== undefined || !entry.documentUri) {
      continue;
    }
    const openDoc = vscode.workspace.textDocuments.find((doc) =>
      sameDocumentIdentity(doc.uri.toString(), entry.documentUri),
    );
    const content = openDoc ? openDoc.getText() : entry.content;
    const parsed = tryParseDraftContent(content);
    const projectId = parsed?.controlFields?.project_id ?? entry.projectId;
    if (allowedProjectIds && projectId !== undefined && !allowedProjectIds.has(projectId)) {
      continue;
    }
    const policy = evaluateOfflineSyncPolicy(entry);
    const primary = getPrimaryEffectForRevision(entry);
    const syncState: DashboardSyncState =
      policy.lifecycle === "commit_unknown"
        ? "CommitUnknown"
        : policy.lifecycle === "recovery_pending"
          ? "RecoveryPending"
          : (primary && isRejectedTicketCreate(primary)) || Boolean(entry.preparationFailure)
            ? "Failed"
            : "Draft";
    const subject = parsed?.subject.trim() || extractFallbackSubject(content) || vscode.l10n.t("New ticket");
    nodes.push({
      queueId: entry.queueId,
      documentUri: entry.documentUri,
      subject,
      projectId,
      trackerName: parsed?.metadata.tracker || undefined,
      statusName: parsed?.metadata.status || undefined,
      priorityName: parsed?.metadata.priority || undefined,
      assigneeName: parsed?.metadata.assignee || undefined,
      dueDate: parsed?.metadata.due_date || undefined,
      syncState,
      detail: entry.preparationFailure,
    });
  }
  return nodes;
};

export const buildTicketDashboardNodes = (tickets: Ticket[]): DashboardTicketNode[] => {
  if (tickets.length === 0) {
    return [];
  }
  const idSet = new Set(tickets.map((t) => t.id));
  const subjectById = new Map(tickets.map((t) => [t.id, t.subject]));
  const sources: Array<TreeSource<Ticket>> = tickets.map((ticket) => ({
    id: ticket.id,
    parentId: ticket.parentId,
    label: ticket.subject,
    data: ticket,
    parentNotLoaded: ticket.parentId !== undefined && !idSet.has(ticket.parentId),
  }));
  const { roots } = buildTree(sources);
  return roots.map((root) => buildDashboardNode(root, 0, subjectById));
};

export const buildTicketDetail = (ticket: Ticket, allTickets: Ticket[] = []): DashboardTicketDetail => {
  const scope = getCurrentConnectionScope();
  const draft = getTicketDraft(ticket.id, scope);
  const syncState = resolveTicketSyncState(ticket.id);
  const overlay = resolveOverlayFields(ticket, syncState);
  const parentSubject = ticket.parentId
    ? allTickets.find((candidate) => candidate.id === ticket.parentId)?.subject
    : undefined;
  return {
    id: ticket.id,
    subject: overlay.subject,
    description: overlay.description,
    statusName: overlay.statusName,
    priorityName: overlay.priorityName,
    trackerName: overlay.trackerName,
    assigneeName: overlay.assigneeName,
    dueDate: overlay.dueDate,
    startDate: overlay.startDate,
    syncState,
    projectId: ticket.projectId,
    projectName: ticket.projectName,
    parentId: ticket.parentId,
    parentSubject,
    lastSyncedAt: draft?.lastSyncedAt ? new Date(draft.lastSyncedAt).toISOString() : undefined,
  };
};
