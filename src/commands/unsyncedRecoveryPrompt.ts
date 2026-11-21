import * as vscode from "vscode";
import { showWarning } from "../utils/notifications";
import type { createSyncEngine } from "../app/ticketSync";

export type RecoveryCancelled = { kind: "cancelled" };

export const showManualRepairRequired = (
  items: ReturnType<ReturnType<typeof createSyncEngine>["getRecoveryItems"]>,
): boolean => {
  const manualItem = items.find((item) => item.disposition === "manual_repair_required");
  if (!manualItem) {
    return false;
  }
  showWarning(vscode.l10n.t(
    "Manual repair required. Automatic recovery is disabled to avoid a duplicate remote mutation. Details: {0}",
    manualItem.message ?? manualItem.manualRepairReason ?? vscode.l10n.t("Unknown recovery state"),
  ));
  return true;
};
