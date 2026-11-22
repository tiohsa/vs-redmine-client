import * as vscode from "vscode";
import { getCurrentConnectionScope } from "../../config/connectionScope";
import { getOfflineSyncQueue, isAbandoned } from "../../views/offlineSyncStore";
import { clearCommentDraft } from "../../views/commentDraftStore";
import { discardCommentEditDraft } from "../../views/commentEditStore";
import { clearTicketDraftContent, getTicketDraft } from "../../views/ticketDraftStore";
import type { ChangeSnapshot } from "./dashboardPendingDeletionChanges";
import type { buildUnsyncedPendingChanges } from "./dashboardUnsyncedPendingChanges";

type PendingView = ReturnType<typeof buildUnsyncedPendingChanges>;
type LocalEntry = PendingView["local"][number];
type DiscardContext = {
  scope: string;
  generation: number;
  local: PendingView["local"];
};

const confirmLabel = (): string => vscode.l10n.t("Discard draft");

export async function discardReadOnlyDraft(
  itemId: string,
  getContext: () => DiscardContext,
): Promise<"discarded" | "cancelled"> {
  const initialContext = getContext();
  const initial = findDiscardableEntry(initialContext, itemId);

  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t("Discard this local draft? This cannot be undone."),
    { modal: true, detail: initial.row.detail },
    confirmLabel(),
  );
  if (answer !== confirmLabel()) { return "cancelled"; }

  const currentContext = getContext();
  if (currentContext.scope !== initialContext.scope || currentContext.generation !== initialContext.generation) {
    throw new Error(vscode.l10n.t("The selected draft changed. Refresh the list and try again."));
  }
  const current = findDiscardableEntry(currentContext, itemId);
  for (const source of current.members) {
    discardStoredDraft(currentContext.scope, source);
  }
  return "discarded";
}

function findDiscardableEntry(context: DiscardContext, itemId: string): LocalEntry {
  if (context.scope !== getCurrentConnectionScope()) {
    throw new Error(vscode.l10n.t("The selected draft changed. Refresh the list and try again."));
  }
  const entry = context.local.find(candidate => candidate.row.id === itemId);
  if (!entry) {
    throw new Error(vscode.l10n.t("The selected draft changed. Refresh the list and try again."));
  }
  if (entry.row.open !== "preview") {
    throw new Error(vscode.l10n.t("Only local ticket and comment drafts can be discarded here."));
  }
  if (!entry.row.canDiscard) {
    throw new Error(vscode.l10n.t("Resolve editor changes or pending sync for this item before discarding its draft."));
  }
  return entry;
}

function discardStoredDraft(scope: string, change: ChangeSnapshot): void {
  const [kind, first, second] = change.id.split(":");
  const ticketId = Number(first);
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
    throw new Error(vscode.l10n.t("The selected draft changed. Refresh the list and try again."));
  }
  if (kind === "ticket-draft") {
    const draft = getTicketDraft(ticketId, scope);
    if (!draft) {
      throw new Error(vscode.l10n.t("The selected draft changed. Refresh the list and try again."));
    }
    const queued = getOfflineSyncQueue(scope).tickets.get(ticketId);
    const status = queued && !isAbandoned(queued)
      ? draft.status === "Conflict" || draft.status === "Failed" ? draft.status : "Queued"
      : "Synced";
    clearTicketDraftContent(ticketId, scope, status);
  } else if (kind === "comment-draft") {
    clearCommentDraft(ticketId, scope);
  } else if (kind === "comment-edit") {
    const commentId = Number(second);
    if (!Number.isSafeInteger(commentId) || commentId <= 0) {
      throw new Error(vscode.l10n.t("The selected draft changed. Refresh the list and try again."));
    }
    discardCommentEditDraft(commentId, scope);
  } else {
    throw new Error(vscode.l10n.t("Only local ticket and comment drafts can be discarded here."));
  }
}
