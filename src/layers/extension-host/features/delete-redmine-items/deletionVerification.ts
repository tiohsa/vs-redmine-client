import * as vscode from "vscode";
import type { DeleteTarget, DeletionDependencies } from "./deletionTypes";

type ScopedVerificationDependencies = DeletionDependencies & {
  deleteIssue: (ticketId: number) => Promise<void>;
  clearJournalNotes: (commentId: number) => Promise<void>;
  withConnectionScope: <T>(connectionScope: string, operation: () => Promise<T>) => Promise<T>;
};

export async function writeAndVerifyDeletion(
  deps: ScopedVerificationDependencies,
  scope: string,
  target: DeleteTarget,
): Promise<void> {
  try {
    await deps.withConnectionScope(scope, () => target.kind === "ticket"
      ? deps.deleteIssue(target.ticketId)
      : deps.clearJournalNotes(target.commentId));
  } catch (error) {
    const status = deps.getHttpStatusCode(error);
    if (status !== undefined && status >= 400 && status < 500 && status !== 408) { throw error; }
  }

  const verified = target.kind === "ticket"
    ? await ticketIsMissing(deps, scope, target.ticketId)
    : await commentIsEmpty(deps, scope, target.ticketId, target.commentId);
  if (!verified) {
    throw new Error(vscode.l10n.t("The deletion result could not be confirmed. Review the item in Redmine before trying again."));
  }
}

async function ticketIsMissing(
  deps: ScopedVerificationDependencies,
  scope: string,
  ticketId: number,
): Promise<boolean> {
  try {
    await deps.withConnectionScope(scope, () => deps.getIssueDetail(ticketId));
    return false;
  } catch (error) {
    if (deps.getHttpStatusCode(error) === 404) { return true; }
    return false;
  }
}

async function commentIsEmpty(
  deps: ScopedVerificationDependencies,
  scope: string,
  ticketId: number,
  commentId: number,
): Promise<boolean> {
  try {
    const detail = await deps.withConnectionScope(scope, () => deps.getIssueDetail(ticketId));
    return detail.ticket.id === ticketId &&
      !detail.comments.some((item) => item.id === commentId && item.body.trim().length > 0);
  } catch {
    return false;
  }
}
