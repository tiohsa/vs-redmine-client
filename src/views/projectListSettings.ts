import { Ticket } from "../redmine/types";

export type TicketSortField = "priority" | "status" | "tracker" | "assignee";
export type SortDirection = "asc" | "desc";
export type DueDateWindow = "within1Day" | "within3Days" | "within7Days" | "overdue";

export interface TicketFilterSelection {
  subjectQuery: string;
  priorityIds: number[];
  statusIds: number[];
  trackerIds: number[];
  assigneeIds: number[];
  includeUnassigned: boolean;
}

export interface TicketSortPreference {
  field?: TicketSortField;
  direction: SortDirection;
}

export interface DueDateDisplayRule {
  showWithin7Days: boolean;
  showWithin3Days: boolean;
  showWithin1Day: boolean;
  showOverdue: boolean;
}

export interface TicketListSettings {
  filters: TicketFilterSelection;
  sort: TicketSortPreference;
  dueDate: DueDateDisplayRule;
}

export const DEFAULT_TICKET_LIST_SETTINGS: TicketListSettings = {
  filters: {
    subjectQuery: "",
    priorityIds: [],
    statusIds: [],
    trackerIds: [],
    assigneeIds: [],
    includeUnassigned: true,
  },
  sort: {
    field: undefined,
    direction: "asc",
  },
  dueDate: {
    showWithin7Days: true,
    showWithin3Days: true,
    showWithin1Day: true,
    showOverdue: true,
  },
};

export const DUE_DATE_PRIORITY_ORDER: DueDateWindow[] = [
  "within1Day",
  "within3Days",
  "within7Days",
  "overdue",
];

export const applyTicketFilters = (
  tickets: Ticket[],
  filters: TicketFilterSelection,
): Ticket[] => {
  const normalizedSubjectQuery = filters.subjectQuery.trim().toLowerCase();

  const matchesSelection = (value: number | undefined, selections: number[]): boolean => {
    if (selections.length === 0) {
      return true;
    }
    return value !== undefined && selections.includes(value);
  };

  const matchesAssignee = (value: number | undefined): boolean => {
    if (filters.assigneeIds.length === 0) {
      return filters.includeUnassigned ? true : value !== undefined;
    }
    if (value !== undefined && filters.assigneeIds.includes(value)) {
      return true;
    }
    return filters.includeUnassigned && value === undefined;
  };

  return tickets.filter((ticket) => {
    if (
      normalizedSubjectQuery.length > 0 &&
      !ticket.subject.toLowerCase().includes(normalizedSubjectQuery)
    ) {
      return false;
    }
    if (!matchesSelection(ticket.priorityId, filters.priorityIds)) {
      return false;
    }
    if (!matchesSelection(ticket.statusId, filters.statusIds)) {
      return false;
    }
    if (!matchesSelection(ticket.trackerId, filters.trackerIds)) {
      return false;
    }
    if (!matchesAssignee(ticket.assigneeId)) {
      return false;
    }
    return true;
  });
};

export const applyTicketSort = (
  tickets: Ticket[],
  sort: TicketSortPreference,
): Ticket[] => {
  if (!sort.field) {
    return tickets.slice();
  }

  const getSortValue = (ticket: Ticket): string | number | undefined => {
    switch (sort.field) {
      case "priority":
        return ticket.priorityName ?? ticket.priorityId;
      case "status":
        return ticket.statusName ?? ticket.statusId;
      case "tracker":
        return ticket.trackerName ?? ticket.trackerId;
      case "assignee":
        return ticket.assigneeName ?? ticket.assigneeId;
      default:
        return undefined;
    }
  };

  const normalizeString = (value: string): string => value.toLowerCase();

  return tickets.slice().sort((left, right) => {
    const leftValue = getSortValue(left);
    const rightValue = getSortValue(right);

    if (leftValue === undefined && rightValue === undefined) {
      return left.id - right.id;
    }
    if (leftValue === undefined) {
      return 1;
    }
    if (rightValue === undefined) {
      return -1;
    }

    let comparison = 0;
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      comparison = leftValue - rightValue;
    } else {
      comparison = normalizeString(String(leftValue)).localeCompare(
        normalizeString(String(rightValue)),
      );
    }

    if (comparison === 0) {
      comparison = left.id - right.id;
    }

    return sort.direction === "desc" ? -comparison : comparison;
  });
};

export const resolveDueDateWindow = (
  ticket: Ticket,
  rule: DueDateDisplayRule,
  now: Date,
): DueDateWindow | undefined => {
  if (!ticket.dueDate) {
    return undefined;
  }

  const dueDate = new Date(ticket.dueDate);
  if (Number.isNaN(dueDate.getTime())) {
    return undefined;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const startOfNow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startOfDue = Date.UTC(
    dueDate.getUTCFullYear(),
    dueDate.getUTCMonth(),
    dueDate.getUTCDate(),
  );
  const diffDays = Math.floor((startOfDue - startOfNow) / dayMs);

  const candidates: DueDateWindow[] = [];
  if (diffDays < 0) {
    candidates.push("overdue");
  } else {
    if (diffDays <= 7) {
      candidates.push("within7Days");
    }
    if (diffDays <= 3) {
      candidates.push("within3Days");
    }
    if (diffDays <= 1) {
      candidates.push("within1Day");
    }
  }

  const enabled = new Set<DueDateWindow>();
  if (rule.showWithin1Day) {
    enabled.add("within1Day");
  }
  if (rule.showWithin3Days) {
    enabled.add("within3Days");
  }
  if (rule.showWithin7Days) {
    enabled.add("within7Days");
  }
  if (rule.showOverdue) {
    enabled.add("overdue");
  }

  for (const window of DUE_DATE_PRIORITY_ORDER) {
    if (candidates.includes(window) && enabled.has(window)) {
      return window;
    }
  }

  return undefined;
};

export const formatDueDateIndicator = (
  window: DueDateWindow | undefined,
): string | undefined => {
  switch (window) {
    case "within1Day":
      return "Due in 1 day";
    case "within3Days":
      return "Due in 3 days";
    case "within7Days":
      return "Due in 7 days";
    case "overdue":
      return "Overdue";
    default:
      return undefined;
  }
};
