import * as vscode from "vscode";
import { getOfflineSyncLifecycle } from "./offlineSyncStore";

/** Dashboard とサイドバーで同じ永続状態を同じ言葉で説明する。 */
export const describeOfflineSync = (
  operation: Parameters<typeof getOfflineSyncLifecycle>[0] & { nextIntent?: unknown },
): { label: string; detail: string } => {
  const lifecycle = getOfflineSyncLifecycle(operation);
  const label = lifecycle === "commit_unknown"
    ? vscode.l10n.t("Remote outcome unknown")
    : lifecycle === "recovery_pending"
      ? vscode.l10n.t("Recovery pending")
      : vscode.l10n.t("Waiting to sync");
  const detail = lifecycle === "commit_unknown"
    ? vscode.l10n.t("The Redmine write outcome is unknown. Open recovery to check before retrying.")
    : operation.phase === "local_finalize_pending"
      ? vscode.l10n.t("Changes are on Redmine. Resume recovery to finish updating the local file.")
      : lifecycle === "recovery_pending"
        ? vscode.l10n.t("Resume recovery to verify the saved synchronization state.")
        : vscode.l10n.t("Status: Saved locally (unsynced)");
  return {
    label,
    detail: operation.nextIntent === undefined ? detail
      : `${detail}\n${vscode.l10n.t("Later local changes are also waiting to sync.")}`,
  };
};
