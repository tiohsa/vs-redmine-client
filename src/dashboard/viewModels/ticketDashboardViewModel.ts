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
  parentId: node.data.parentId,
  syncState: resolveTicketSyncState(node.data.id),
  level,
  children: node.children.map((child) => buildDashboardNode(child, level + 1)),
});

export const buildTicketDashboardNodes = (tickets: Ticket[]): DashboardTicketNode[] => {
  if (tickets.length === 0) {
    return [];
  }
  const idSet = new Set(tickets.map((t) => t.id));
  const sources: Array<TreeSource<Ticket>> = tickets.map((ticket) => ({
    id: ticket.id,
    parentId: ticket.parentId,
    label: ticket.subject,
    data: ticket,
    parentNotLoaded: ticket.parentId !== undefined && !idSet.has(ticket.parentId),
  }));
  const { roots } = buildTree(sources);
  return roots.map((root) => buildDashboardNode(root, 0));
};

export const buildTicketDetail = (ticket: Ticket): DashboardTicketDetail => ({
  id: ticket.id,
  subject: ticket.subject,
  description: ticket.description,
  statusName: ticket.statusName,
  priorityName: ticket.priorityName,
  trackerName: ticket.trackerName,
  assigneeName: ticket.assigneeName,
  dueDate: ticket.dueDate,
  syncState: resolveTicketSyncState(ticket.id),
  projectId: ticket.projectId,
});
