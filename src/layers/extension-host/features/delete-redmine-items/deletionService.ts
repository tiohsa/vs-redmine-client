import * as vscode from "vscode";
import { getRelevantPendingTicketIds, hasRelevantPendingTicketChanges, resolveTicketDeletionTarget, sameTicketIds, sortedUniqueTicketIds } from "./deletionAssessment";
import { writeAndVerifyDeletion } from "./deletionVerification";
import type { DeleteProtectionInput, DeleteTarget, DeletionIssueDetail, ProtectedDelete, UnverifiedDescendant } from "./deletionTypes";

export type { DeleteProtectionInput, DeletionIssueDetail } from "./deletionTypes";

export interface DeleteTicketRequest {
  requestId: string;
  ticketId: number;
  connectionGeneration: number;
}

export interface DeleteCommentRequest extends DeleteTicketRequest {
  commentId: number;
}

export interface PendingChangeReviewItem {
  id: string;
  ticketIds: readonly number[];
  label: string;
  detail: string;
  version: string;
  inProgress?: boolean;
  open?: () => Promise<void>;
}

export interface PendingChangeReviewInput {
  title: string;
  detail: string;
  items: readonly PendingChangeReviewItem[];
  unreadableReferences: readonly string[];
  blocked: boolean;
  openUnsynced?: () => void;
}

export interface DashboardDeletionServiceDependencies {
  getIssueDetail: (ticketId: number, includeChildren?: boolean) => Promise<DeletionIssueDetail>;
  deleteIssue: (ticketId: number) => Promise<void>;
  clearJournalNotes: (commentId: number) => Promise<void>;
  getConnectionScope: () => string;
  withConnectionScope: <T>(connectionScope: string, operation: () => Promise<T>) => Promise<T>;
  getHttpStatusCode: (error: unknown) => number | undefined;
  getConnectionGeneration: () => number;
  assertCanDelete: (input: DeleteProtectionInput) => void;
  runProtectedDelete: ProtectedDelete;
  getPendingTicketIds: (connectionScope: string) => readonly number[];
  getPendingChangeReview: (connectionScope: string, ticketIds: readonly number[]) => readonly PendingChangeReviewItem[];
  reviewPendingChanges: (input: PendingChangeReviewInput) => Promise<boolean>;
  openUnsynced?: (itemIds: readonly string[]) => void;
  confirmDelete?: (input: { title: string; detail: string }) => Promise<boolean>;
  refreshTickets: (ticketIds: readonly number[]) => Promise<void>;
  refreshComments: (ticketId: number, commentId: number) => Promise<void>;
  clearSelectedTicket: (ticketId: number) => void;
  clearSelectedComment: (ticketId: number, commentId: number) => void;
  notifyError: (requestId: string, message: string) => void;
  notifySuccess: (requestId: string, message: string) => void;
}

export class DashboardDeletionService {
  private readonly inFlight = new Set<string>();
  constructor(private readonly deps: DashboardDeletionServiceDependencies) {}

  async deleteTicket(request: DeleteTicketRequest): Promise<void> {
    await this.perform(request, (scope) => resolveTicketDeletionTarget(this.deps, scope, request.ticketId));
  }

  async deleteComment(request: DeleteCommentRequest): Promise<void> {
    await this.perform(request, async (scope) => {
      const detail = await this.deps.withConnectionScope(scope, () => this.deps.getIssueDetail(request.ticketId));
      if (detail.ticket.id !== request.ticketId) {
        throw new Error(vscode.l10n.t("The comment's parent ticket could not be verified."));
      }
      const comment = detail.comments.find((item) => item.id === request.commentId && item.ticketId === request.ticketId);
      if (!comment) { throw new Error(vscode.l10n.t("The comment could not be verified.")); }
      return { kind: "comment", ticketId: request.ticketId, commentId: request.commentId, body: comment.body };
    });
  }

  private async perform(
    request: DeleteTicketRequest | DeleteCommentRequest,
    resolve: (scope: string) => Promise<DeleteTarget>,
  ): Promise<void> {
    const scope = this.deps.getConnectionScope();
    const commentId = "commentId" in request ? request.commentId : undefined;
    const key = `${scope}\0${request.ticketId}\0${commentId ?? ""}`;
    if (this.inFlight.has(key)) { return; }
    this.inFlight.add(key);
    try {
      this.assertCurrent(request, scope);
      const target = await resolve(scope);
      this.assertCurrent(request, scope);
      const pendingReview = target.kind === "ticket" && hasRelevantPendingTicketChanges(this.deps, target, scope)
        ? await this.reviewPending(target, request, scope)
        : undefined;
      if (pendingReview === undefined) {
        this.deps.assertCanDelete(this.protectionInput(scope, target));
        if (!await this.confirm(target)) { return; }
      } else if (!pendingReview.approved) {
        return;
      }

      this.assertCurrent(request, scope);
      const verified = await resolve(scope);
      this.assertCurrent(request, scope);
      if (verified.kind === "ticket") {
        if (target.kind !== "ticket" || target.subject !== verified.subject ||
            !this.sameUnverified(target.unverified, verified.unverified) || !sameTicketIds(target.ticketIds, verified.ticketIds) ||
            !this.sameOptionalIds(target.pendingSnapshot, verified.pendingSnapshot)) {
          throw new Error(vscode.l10n.t("Pending changes changed while verifying this ticket. Try again."));
        }
        if (verified.pendingSnapshot !== undefined) {
          this.assertPendingSnapshotCurrent(scope, verified.pendingSnapshot);
        }
        if (pendingReview !== undefined) {
          const reviewIds = getRelevantPendingTicketIds(this.deps, verified, scope);
          const currentItems = this.getReviewItems(scope, request, reviewIds);
          this.assertReviewSnapshotCurrent(pendingReview.items, currentItems);
        }
      }
      this.assertCurrent(request, scope);
      this.deps.assertCanDelete(this.protectionInput(scope, verified));
      await this.deps.runProtectedDelete(this.protectionInput(scope, verified), async () => {
        this.assertCurrent(request, scope);
        await writeAndVerifyDeletion(this.deps, scope, verified);
      });

      if (!this.isCurrent(request, scope)) { return; }
      if (verified.kind === "ticket") {
        for (const ticketId of verified.ticketIds) { this.deps.clearSelectedTicket(ticketId); }
        await this.deps.refreshTickets(verified.ticketIds);
        if (this.isCurrent(request, scope)) {
          this.deps.notifySuccess(request.requestId, vscode.l10n.t("Ticket #{0} was deleted.", request.ticketId));
        }
      } else {
        this.deps.clearSelectedComment(verified.ticketId, verified.commentId);
        await this.deps.refreshComments(verified.ticketId, verified.commentId);
        if (this.isCurrent(request, scope)) {
          this.deps.notifySuccess(request.requestId, vscode.l10n.t("Comment was deleted."));
        }
      }
    } catch (error) {
      if (this.isCurrent(request, scope)) {
        this.deps.notifyError(request.requestId, this.errorMessage(error));
      }
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async reviewPending(
    target: Extract<DeleteTarget, { kind: "ticket" }>,
    request: DeleteTicketRequest,
    scope: string,
  ): Promise<{ approved: boolean; items: readonly PendingChangeReviewItem[] }> {
    const pendingIds = getRelevantPendingTicketIds(this.deps, target, scope);
    const items = this.getReviewItems(scope, request, pendingIds);
    const itemTicketIds = new Set(items.flatMap((item) => item.ticketIds));
    const missingCandidates = pendingIds.filter((ticketId) => !itemTicketIds.has(ticketId));
    const blocked = missingCandidates.length > 0 || items.some((item) => !item.open || item.inProgress ||
      item.ticketIds.some((ticketId) => target.ticketIds.includes(ticketId)));
    const unreadableReferences = [
      ...target.unverified.map(({ ticketId, unreadableTicketId }) =>
        vscode.l10n.t("Ticket #{0} could not be verified because ticket #{1} was unreadable.", ticketId, unreadableTicketId)),
      ...missingCandidates.map((ticketId) =>
        vscode.l10n.t("Pending changes for ticket #{0} are unavailable for inspection.", ticketId)),
    ];
    const detail = vscode.l10n.t(
      "Redmine may delete this ticket, its descendants, associated comments, and time entries. Pending local changes will be preserved. Open a change or Unsynced to inspect it. Select Delete again to start a new review.",
    );
    const approved = await this.deps.reviewPendingChanges({
      title: vscode.l10n.t("Review pending changes before deleting ticket #{0}: {1}", target.ticketId, target.subject),
      detail,
      items: items.map(item => {
        const references = sortedUniqueTicketIds(target.unverified.filter(gap => item.ticketIds.includes(gap.ticketId))
          .map(gap => gap.unreadableTicketId));
        const detail = [item.detail];
        if (references.length > 0) {
          detail.push(vscode.l10n.t("Unreadable reference: {0}", references.map(id => `#${id}`).join(", ")));
        }
        if (item.ticketIds.some(id => target.ticketIds.includes(id))) {
          detail.push(vscode.l10n.t("This change affects the deletion target or one of its descendants."));
        }
        if (!item.open) { detail.push(vscode.l10n.t("The change content is unavailable.")); }
        return this.scopeBoundReviewItem({ ...item, detail: detail.join(" · ") }, request, scope);
      }),
      unreadableReferences,
      blocked,
      openUnsynced: this.deps.openUnsynced ? () => {
        this.assertCurrent(request, scope);
        this.deps.openUnsynced?.(items.map(item => item.id));
      } : undefined,
    });
    this.assertCurrent(request, scope);
    if (approved && blocked) { return { approved: false, items }; }
    return { approved, items };
  }

  private getReviewItems(
    scope: string,
    request: DeleteTicketRequest,
    ticketIds: readonly number[],
  ): PendingChangeReviewItem[] {
    this.assertCurrent(request, scope);
    const items = this.deps.getPendingChangeReview(scope, ticketIds);
    const ids = new Set<string>();
    for (const item of items) {
      if (!item.id || ids.has(item.id) || !item.version || item.ticketIds.length === 0 ||
          item.ticketIds.some((id) => !ticketIds.includes(id))) {
        throw new Error(vscode.l10n.t("Pending changes changed while verifying this ticket. Try again."));
      }
      ids.add(item.id);
    }
    this.assertCurrent(request, scope);
    return items.map((item) => ({ ...item, ticketIds: sortedUniqueTicketIds(item.ticketIds) }));
  }

  private scopeBoundReviewItem(
    item: PendingChangeReviewItem,
    request: DeleteTicketRequest,
    scope: string,
  ): PendingChangeReviewItem {
    return {
      ...item,
      open: item.open ? async () => {
        this.assertCurrent(request, scope);
        await item.open?.();
        this.assertCurrent(request, scope);
      } : undefined,
    };
  }

  private assertReviewSnapshotCurrent(
    approved: readonly PendingChangeReviewItem[],
    current: readonly PendingChangeReviewItem[],
  ): void {
    if (approved.length !== current.length || approved.some((item, index) => {
      const next = current[index];
      return item.id !== next.id || item.label !== next.label || item.detail !== next.detail ||
        item.version !== next.version || item.inProgress !== next.inProgress || Boolean(item.open) !== Boolean(next.open) || !sameTicketIds(item.ticketIds, next.ticketIds);
    })) {
      throw new Error(vscode.l10n.t("Pending changes changed while verifying this ticket. Try again."));
    }
  }

  private sameUnverified(left: readonly UnverifiedDescendant[], right: readonly UnverifiedDescendant[]): boolean {
    return left.length === right.length && left.every((item, index) =>
      item.ticketId === right[index].ticketId && item.unreadableTicketId === right[index].unreadableTicketId);
  }

  private assertPendingSnapshotCurrent(scope: string, pendingSnapshot: number[]): void {
    if (!sameTicketIds(pendingSnapshot, sortedUniqueTicketIds(this.deps.getPendingTicketIds(scope)))) {
      throw new Error(vscode.l10n.t("Pending changes changed while verifying this ticket. Try again."));
    }
  }

  private async confirm(target: DeleteTarget): Promise<boolean> {
    const deleteLabel = vscode.l10n.t("Delete");
    const title = target.kind === "ticket"
      ? vscode.l10n.t("Delete ticket #{0}: {1}?", target.ticketId, target.subject)
      : vscode.l10n.t("Delete comment #{0} on ticket #{1}?", target.commentId, target.ticketId);
    const impact = target.kind === "ticket"
      ? vscode.l10n.t("Redmine may also delete child tickets, comments, and time entries associated with this ticket.")
      : target.body;
    const detail = impact;
    if (this.deps.confirmDelete) { return this.deps.confirmDelete({ title, detail }); }
    const choice = await vscode.window.showWarningMessage(title, { modal: true, detail }, deleteLabel);
    return choice === deleteLabel;
  }

  private assertCurrent(request: DeleteTicketRequest, scope: string): void {
    if (!this.isCurrent(request, scope)) {
      throw new Error(vscode.l10n.t("The Redmine connection changed. Reopen the Dashboard and try again."));
    }
  }

  private isCurrent(request: DeleteTicketRequest, scope: string): boolean {
    return this.deps.getConnectionScope() === scope && this.deps.getConnectionGeneration() === request.connectionGeneration;
  }

  private protectionInput(scope: string, target: DeleteTarget): DeleteProtectionInput {
    return target.kind === "ticket"
      ? { connectionScope: scope, ticketIds: target.ticketIds, possibleTicketIds: target.unverified.map(candidate => candidate.ticketId) }
      : { connectionScope: scope, ticketIds: [target.ticketId], commentIds: [target.commentId] };
  }

  private sameOptionalIds(left: readonly number[] | undefined, right: readonly number[] | undefined): boolean {
    if (left === undefined || right === undefined) { return left === right; }
    return sameTicketIds(left, right);
  }

  private errorMessage(error: unknown): string {
    const status = this.deps.getHttpStatusCode(error);
    if (status !== undefined) {
      return vscode.l10n.t("Redmine rejected the deletion request (HTTP {0}).", status);
    }
    return error instanceof Error ? error.message : String(error);
  }
}
