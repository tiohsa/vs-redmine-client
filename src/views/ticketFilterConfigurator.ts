import * as vscode from "vscode";
import { Ticket } from "../redmine/types";
import {
  DueDateDisplayRule,
  TicketListSettings,
  TicketSortField,
} from "./projectListSettings";

type TicketOption = { id: number; label: string };

export const collectOptions = (
  tickets: Ticket[],
  getId: (ticket: Ticket) => number | undefined,
  getLabel: (ticket: Ticket) => string | undefined,
): TicketOption[] => {
  const seen = new Map<number, string>();
  tickets.forEach((ticket) => {
    const id = getId(ticket);
    if (id === undefined) { return; }
    const label = getLabel(ticket) ?? `#${id}`;
    if (!seen.has(id)) { seen.set(id, label); }
  });
  return Array.from(seen.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

const pickMultiSelect = async (
  title: string,
  options: TicketOption[],
  selectedIds: number[],
): Promise<number[] | undefined> => {
  if (options.length === 0) {
    void vscode.window.showInformationMessage("No options available for this filter.");
    return undefined;
  }

  const items: Array<vscode.QuickPickItem & { id: number }> = options.map((option) => ({
    label: option.label,
    picked: selectedIds.includes(option.id),
    id: option.id,
  }));

  const picked = await vscode.window.showQuickPick(items, { canPickMany: true, title });
  if (!picked) { return undefined; }
  return picked.map((item) => item.id);
};

export const configurePriorityFilter = async (
  tickets: Ticket[],
  settings: TicketListSettings,
): Promise<TicketListSettings | undefined> => {
  const options = collectOptions(tickets, (t) => t.priorityId, (t) => t.priorityName);
  const selected = await pickMultiSelect("Filter by priority", options, settings.filters.priorityIds);
  if (!selected) { return undefined; }
  return { ...settings, filters: { ...settings.filters, priorityIds: selected } };
};

export const configureTitleFilter = async (
  settings: TicketListSettings,
): Promise<TicketListSettings | undefined> => {
  const next = await vscode.window.showInputBox({
    title: "Filter by title",
    prompt: "Enter title keyword (leave blank for all)",
    value: settings.filters.subjectQuery,
  });
  if (next === undefined) { return undefined; }
  return { ...settings, filters: { ...settings.filters, subjectQuery: next.trim() } };
};

export const configureStatusFilter = async (
  tickets: Ticket[],
  settings: TicketListSettings,
): Promise<TicketListSettings | undefined> => {
  const options = collectOptions(tickets, (t) => t.statusId, (t) => t.statusName);
  const selected = await pickMultiSelect("Filter by status", options, settings.filters.statusIds);
  if (!selected) { return undefined; }
  return { ...settings, filters: { ...settings.filters, statusIds: selected } };
};

export const configureTrackerFilter = async (
  tickets: Ticket[],
  settings: TicketListSettings,
): Promise<TicketListSettings | undefined> => {
  const options = collectOptions(tickets, (t) => t.trackerId, (t) => t.trackerName);
  const selected = await pickMultiSelect("Filter by tracker", options, settings.filters.trackerIds);
  if (!selected) { return undefined; }
  return { ...settings, filters: { ...settings.filters, trackerIds: selected } };
};

export const configureAssigneeFilter = async (
  tickets: Ticket[],
  settings: TicketListSettings,
): Promise<TicketListSettings | undefined> => {
  const options = collectOptions(tickets, (t) => t.assigneeId, (t) => t.assigneeName);

  const items: Array<vscode.QuickPickItem & { id?: number; unassigned?: boolean }> =
    options.map((option) => ({
      label: option.label,
      picked: settings.filters.assigneeIds.includes(option.id),
      id: option.id,
    }));
  items.unshift({ label: "Unassigned", picked: settings.filters.includeUnassigned, unassigned: true });

  const picked = await vscode.window.showQuickPick(items, { canPickMany: true, title: "Filter by assignee" });
  if (!picked) { return undefined; }

  return {
    ...settings,
    filters: {
      ...settings.filters,
      assigneeIds: picked.filter((item) => item.id !== undefined).map((item) => item.id as number),
      includeUnassigned: picked.some((item) => item.unassigned),
    },
  };
};

export const configureSort = async (
  settings: TicketListSettings,
): Promise<TicketListSettings | undefined> => {
  const fieldItems: Array<vscode.QuickPickItem & { field?: TicketSortField }> = [
    { label: "None", field: undefined },
    { label: "Priority", field: "priority" },
    { label: "Status", field: "status" },
    { label: "Tracker", field: "tracker" },
    { label: "Assignee", field: "assignee" },
  ];

  const pickedField = await vscode.window.showQuickPick(fieldItems, { title: "Sort tickets by" });
  if (!pickedField) { return undefined; }

  if (!pickedField.field) {
    return { ...settings, sort: { ...settings.sort, field: undefined } };
  }

  const directionItems: Array<vscode.QuickPickItem & { direction: "asc" | "desc" }> = [
    { label: "Ascending", direction: "asc" },
    { label: "Descending", direction: "desc" },
  ];

  const pickedDirection = await vscode.window.showQuickPick(directionItems, {
    title: `Sort ${pickedField.label.toLowerCase()} by`,
  });
  if (!pickedDirection) { return undefined; }

  return { ...settings, sort: { field: pickedField.field, direction: pickedDirection.direction } };
};

export const configureDueDateDisplay = async (
  settings: TicketListSettings,
): Promise<TicketListSettings | undefined> => {
  const items: Array<vscode.QuickPickItem & { key: keyof DueDateDisplayRule }> = [
    { label: "Within 1 day", picked: settings.dueDate.showWithin1Day, key: "showWithin1Day" },
    { label: "Within 3 days", picked: settings.dueDate.showWithin3Days, key: "showWithin3Days" },
    { label: "Within 7 days", picked: settings.dueDate.showWithin7Days, key: "showWithin7Days" },
    { label: "Overdue", picked: settings.dueDate.showOverdue, key: "showOverdue" },
  ];

  const picked = await vscode.window.showQuickPick(items, { canPickMany: true, title: "Due date indicators" });
  if (!picked) { return undefined; }

  const keys = new Set(picked.map((item) => item.key));
  return {
    ...settings,
    dueDate: {
      showWithin1Day: keys.has("showWithin1Day"),
      showWithin3Days: keys.has("showWithin3Days"),
      showWithin7Days: keys.has("showWithin7Days"),
      showOverdue: keys.has("showOverdue"),
    },
  };
};
