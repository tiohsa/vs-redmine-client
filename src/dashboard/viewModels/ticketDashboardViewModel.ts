import { Ticket } from "../../redmine/types";
import { getTicketDraft } from "../../views/ticketDraftStore";
import { getOfflineSyncQueue } from "../../views/offlineSyncStore";
import { buildTree } from "../../views/treeBuilder";
import { TreeNode, TreeSource } from "../../views/treeTypes";
import type { DashboardSyncState, DashboardTicketDetail, DashboardTicketNode } from "../dashboardProtocol";

export const resolveTicketSyncState = (ticketId: number): DashboardSyncState => {
  const draft = getTicketDraft(ticketId);
  if (draft) {
    switch (draft.status) {
      case "Dirty": return "Dirty";
      case "Syncing": return "Syncing";
      case "Failed": return "Failed";
      case "Conflict": return "Conflict";
      case "Synced": return "Synced";
      case "Draft": return "Draft";
    }
  }
  const queue = getOfflineSyncQueue();
  if (queue.tickets.has(ticketId)) {
    return "Queued";
  }
  return "Synced";
};

const buildDashboardNode = (
  node: TreeNode<Ticket>,
  level: number,
  subjectById: Map<number, string>,
): DashboardTicketNode => ({
  id: node.data.id,
  subject: node.data.subject,
  statusName: node.data.statusName,
  statusId: node.data.statusId,
  priorityName: node.data.priorityName,
  priorityId: node.data.priorityId,
  trackerName: node.data.trackerName,
  trackerId: node.data.trackerId,
  assigneeName: node.data.assigneeName,
  assigneeId: node.data.assigneeId,
  dueDate: node.data.dueDate,
  startDate: node.data.startDate,
  projectId: node.data.projectId,
  projectName: node.data.projectName,
  parentId: node.data.parentId,
  parentSubject: node.data.parentId ? subjectById.get(node.data.parentId) : undefined,
  syncState: resolveTicketSyncState(node.data.id),
  level,
  children: node.children.map((child) => buildDashboardNode(child, level + 1, subjectById)),
});

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
  const draft = getTicketDraft(ticket.id);
  const parentSubject = ticket.parentId
    ? allTickets.find((candidate) => candidate.id === ticket.parentId)?.subject
    : undefined;
  return {
  id: ticket.id,
  subject: ticket.subject,
  description: ticket.description,
  statusName: ticket.statusName,
  priorityName: ticket.priorityName,
  trackerName: ticket.trackerName,
  assigneeName: ticket.assigneeName,
  dueDate: ticket.dueDate,
  startDate: ticket.startDate,
  syncState: resolveTicketSyncState(ticket.id),
  projectId: ticket.projectId,
  projectName: ticket.projectName,
  parentId: ticket.parentId,
  parentSubject,
  lastSyncedAt: draft?.lastSyncedAt ? new Date(draft.lastSyncedAt).toISOString() : undefined,
  };
};
