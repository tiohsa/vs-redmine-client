import type { DashboardState } from "./dashboardProtocol";

type StateListener = (state: DashboardState) => void;

const DEFAULT_STATE: DashboardState = {
  includeChildProjects: false,
  projects: [],
  tickets: [],
  totalTicketCount: 0,
  loadedTicketCount: 0,
  unsynced: { totalCount: 0, items: [] },
  comments: { loading: false, items: [] },
  settings: {
    filters: {
      subjectQuery: "",
      priorityIds: [],
      statusIds: [],
      trackerIds: [],
      assigneeIds: [],
      includeUnassigned: true,
    },
    sort: { direction: "asc" },
    dueDate: {
      showWithin7Days: true,
      showWithin3Days: true,
      showWithin1Day: true,
      showOverdue: true,
    },
    offlineSyncMode: "auto",
  },
  loading: { tickets: false, comments: false },
  errors: {},
};

export class DashboardStateStore {
  private state: DashboardState = structuredClone(DEFAULT_STATE);
  private listeners = new Set<StateListener>();

  getState(): DashboardState {
    return this.state;
  }

  update(patch: Partial<DashboardState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  updateNested<K extends keyof DashboardState>(
    key: K,
    patch: Partial<DashboardState[K]>,
  ): void {
    this.state = {
      ...this.state,
      [key]: { ...(this.state[key] as object), ...(patch as object) },
    };
    this.notify();
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      listener(this.state);
    }
  }
}
