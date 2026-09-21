import type { TicketUpdateSyncPhase, OfflineSyncLifecycle } from "../../views/offlineSyncStore";
import type { DashboardSyncState } from "../../dashboard/dashboardProtocol";

export const syncLifecycleCases: ReadonlyArray<{
  phase: TicketUpdateSyncPhase | undefined;
  lifecycle: OfflineSyncLifecycle;
  state: DashboardSyncState;
  canDiscard: boolean;
}> = [
  { phase: undefined, lifecycle: "queued", state: "Queued", canDiscard: true },
  { phase: "queued", lifecycle: "queued", state: "Queued", canDiscard: true },
  { phase: "preparing", lifecycle: "recovery_pending", state: "RecoveryPending", canDiscard: false },
  { phase: "remote_write_started", lifecycle: "commit_unknown", state: "CommitUnknown", canDiscard: false },
  { phase: "commit_unknown", lifecycle: "commit_unknown", state: "CommitUnknown", canDiscard: false },
  { phase: "remote_committed", lifecycle: "recovery_pending", state: "RecoveryPending", canDiscard: false },
  { phase: "reconciliation_pending", lifecycle: "recovery_pending", state: "RecoveryPending", canDiscard: false },
  { phase: "local_finalize_pending", lifecycle: "recovery_pending", state: "RecoveryPending", canDiscard: false },
  { phase: "completed", lifecycle: "queued", state: "Queued", canDiscard: true },
];
