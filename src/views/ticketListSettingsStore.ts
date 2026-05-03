import type { Memento } from "vscode";
import { DEFAULT_TICKET_LIST_SETTINGS, TicketListSettings } from "./projectListSettings";

const STORAGE_KEY = "redmine-client.ticketListSettings";

let storage: Memento | undefined;
let currentSettings: TicketListSettings = structuredClone(DEFAULT_TICKET_LIST_SETTINGS);

export const initializeTicketListSettingsStore = (memento: Memento): void => {
  storage = memento;
  const stored = memento.get<unknown>(STORAGE_KEY);
  if (stored && typeof stored === "object") {
    currentSettings = mergeWithDefaults(stored as Partial<TicketListSettings>);
  } else {
    currentSettings = structuredClone(DEFAULT_TICKET_LIST_SETTINGS);
  }
};

export const getStoredTicketListSettings = (): TicketListSettings =>
  structuredClone(currentSettings);

export const setStoredTicketListSettings = (settings: TicketListSettings): void => {
  currentSettings = structuredClone(settings);
  if (storage) {
    void storage.update(STORAGE_KEY, currentSettings);
  }
};

export const clearStoredTicketListSettings = (): void => {
  currentSettings = structuredClone(DEFAULT_TICKET_LIST_SETTINGS);
  if (storage) {
    void storage.update(STORAGE_KEY, undefined);
  }
};

const mergeWithDefaults = (stored: Partial<TicketListSettings>): TicketListSettings => {
  const def = DEFAULT_TICKET_LIST_SETTINGS;
  return {
    filters: {
      subjectQuery: typeof stored.filters?.subjectQuery === "string"
        ? stored.filters.subjectQuery
        : def.filters.subjectQuery,
      priorityIds: Array.isArray(stored.filters?.priorityIds)
        ? stored.filters.priorityIds.filter((v): v is number => typeof v === "number")
        : def.filters.priorityIds,
      statusIds: Array.isArray(stored.filters?.statusIds)
        ? stored.filters.statusIds.filter((v): v is number => typeof v === "number")
        : def.filters.statusIds,
      trackerIds: Array.isArray(stored.filters?.trackerIds)
        ? stored.filters.trackerIds.filter((v): v is number => typeof v === "number")
        : def.filters.trackerIds,
      assigneeIds: Array.isArray(stored.filters?.assigneeIds)
        ? stored.filters.assigneeIds.filter((v): v is number => typeof v === "number")
        : def.filters.assigneeIds,
      includeUnassigned: typeof stored.filters?.includeUnassigned === "boolean"
        ? stored.filters.includeUnassigned
        : def.filters.includeUnassigned,
    },
    sort: {
      field: stored.sort?.field === "priority" || stored.sort?.field === "status" ||
             stored.sort?.field === "tracker" || stored.sort?.field === "assignee"
        ? stored.sort.field
        : def.sort.field,
      direction: stored.sort?.direction === "asc" || stored.sort?.direction === "desc"
        ? stored.sort.direction
        : def.sort.direction,
    },
    dueDate: {
      showWithin7Days: typeof stored.dueDate?.showWithin7Days === "boolean"
        ? stored.dueDate.showWithin7Days
        : def.dueDate.showWithin7Days,
      showWithin3Days: typeof stored.dueDate?.showWithin3Days === "boolean"
        ? stored.dueDate.showWithin3Days
        : def.dueDate.showWithin3Days,
      showWithin1Day: typeof stored.dueDate?.showWithin1Day === "boolean"
        ? stored.dueDate.showWithin1Day
        : def.dueDate.showWithin1Day,
      showOverdue: typeof stored.dueDate?.showOverdue === "boolean"
        ? stored.dueDate.showOverdue
        : def.dueDate.showOverdue,
    },
  };
};
