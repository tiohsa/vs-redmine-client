import * as vscode from "vscode";
import type { DeleteTarget, DeletionDependencies, DeletionIssueDetail, UnverifiedDescendant } from "./deletionTypes";

type ScopedDeletionDependencies = DeletionDependencies & {
  withConnectionScope: <T>(connectionScope: string, operation: () => Promise<T>) => Promise<T>;
};

export const sortedUniqueTicketIds = (ids: readonly number[]): number[] => Array.from(new Set(ids)).sort((left, right) => left - right);

export const sameTicketIds = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index]);

export function getRelevantPendingTicketIds(
  deps: Pick<DeletionDependencies, "getPendingTicketIds">,
  target: Extract<DeleteTarget, { kind: "ticket" }>,
  scope: string,
): number[] {
  const pending = target.pendingSnapshot ?? sortedUniqueTicketIds(deps.getPendingTicketIds(scope));
  const relevant = new Set(target.unverified.map((candidate) => candidate.ticketId));
  for (const ticketId of pending) {
    if (target.ticketIds.includes(ticketId)) { relevant.add(ticketId); }
  }
  return sortedUniqueTicketIds([...relevant]);
}

export function hasRelevantPendingTicketChanges(
  deps: Pick<DeletionDependencies, "getPendingTicketIds">,
  target: Extract<DeleteTarget, { kind: "ticket" }>,
  scope: string,
): boolean {
  return getRelevantPendingTicketIds(deps, target, scope).length > 0;
}

export async function resolveTicketDeletionTarget(
  deps: ScopedDeletionDependencies,
  scope: string,
  ticketId: number,
): Promise<DeleteTarget> {
  const detail = await deps.withConnectionScope(scope, () => deps.getIssueDetail(ticketId, true));
  if (detail.ticket.id !== ticketId) { throw new Error(vscode.l10n.t("The ticket could not be verified.")); }
  const ticketIds = sortedUniqueTicketIds([ticketId, ...(detail.childIssueIds ?? [])]);
  if (ticketIds.length !== (detail.childIssueIds?.length ?? 0) + 1 ||
      ticketIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error(vscode.l10n.t("Redmine returned an invalid ticket hierarchy."));
  }
  const target = { kind: "ticket" as const, ticketId, subject: detail.ticket.subject, ticketIds, unverified: [] };
  if (detail.childIssueIds === undefined) { return target; }
  return { ...target, ...await resolvePendingDescendants(deps, scope, ticketIds) };
}

async function resolvePendingDescendants(
  deps: ScopedDeletionDependencies,
  scope: string,
  visibleTicketIds: number[],
): Promise<{ ticketIds: number[]; pendingSnapshot: number[]; unverified: UnverifiedDescendant[] }> {
  const pendingSnapshot = sortedUniqueTicketIds(deps.getPendingTicketIds(scope));
  const deletedTree = new Set(visibleTicketIds);
  const pendingDescendants = new Set<number>();
  const unverified: UnverifiedDescendant[] = [];
  for (const candidateId of pendingSnapshot) {
    if (deletedTree.has(candidateId)) { continue; }
    const visited = new Set<number>();
    let currentId = candidateId;
    while (true) {
      if (visited.has(currentId)) {
        throw new Error(vscode.l10n.t("Redmine returned an invalid ticket hierarchy."));
      }
      visited.add(currentId);
      let detail: DeletionIssueDetail;
      try {
        detail = await deps.withConnectionScope(scope, () => deps.getIssueDetail(currentId, false));
      } catch (error) {
        const status = deps.getHttpStatusCode(error);
        if (status === 403 || status === 404) {
          unverified.push({ ticketId: candidateId, unreadableTicketId: currentId });
          break;
        }
        throw new Error(vscode.l10n.t("Unable to read ticket #{0} while checking whether pending changes on ticket #{1} would be affected by deletion.", currentId, candidateId));
      }
      if (detail.ticket.id !== currentId) {
        throw new Error(vscode.l10n.t("Unable to read ticket #{0} while checking whether pending changes on ticket #{1} would be affected by deletion.", currentId, candidateId));
      }
      const parentId = detail.ticket.parentId;
      if (parentId === undefined) { break; }
      if (!Number.isSafeInteger(parentId) || parentId <= 0) {
        throw new Error(vscode.l10n.t("Redmine returned an invalid ticket hierarchy."));
      }
      if (deletedTree.has(parentId)) {
        pendingDescendants.add(candidateId);
        break;
      }
      currentId = parentId;
    }
  }
  if (!sameTicketIds(pendingSnapshot, sortedUniqueTicketIds(deps.getPendingTicketIds(scope)))) {
    throw new Error(vscode.l10n.t("Pending changes changed while verifying this ticket. Try again."));
  }
  return {
    ticketIds: sortedUniqueTicketIds([...visibleTicketIds, ...pendingDescendants]),
    pendingSnapshot,
    unverified,
  };
}
