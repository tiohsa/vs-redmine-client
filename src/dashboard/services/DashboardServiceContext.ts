import type { DashboardStateStore } from "../DashboardStateStore";

export interface DashboardServiceContext {
  store: DashboardStateStore;
  notifySuccess: (requestId: string, msg: string) => void;
  notifyError: (requestId: string, msg: string) => void;
  notifyToast: (level: "info" | "warning" | "error" | "success", msg: string) => void;
  notifyOperationStarted: (requestId: string, label?: string) => void;
  onTicketsRefreshed: () => void;
}
