import * as vscode from "vscode";

interface DeletionIssueDetail {
  ticket: { id: number; subject: string; parentId?: number };
  comments: Array<{ id: number; ticketId: number; body: string }>;
  childIssueIds?: number[];
}

interface DeleteProtectionInput {
  connectionScope: string;
  ticketIds: readonly number[];
  commentIds?: readonly number[];
  possibleTicketIds?: readonly number[];
}

type ProtectedDelete = <T>(input: DeleteProtectionInput, operation: () => Promise<T>) => Promise<T>;

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

interface UnverifiedDescendant {
  ticketId: number;
  unreadableTicketId: number;
}

type DeleteTarget =
  | { kind: "ticket"; ticketId: number; subject: string; ticketIds: number[]; pendingSnapshot?: number[]; unverified: UnverifiedDescendant[] }
  | { kind: "comment"; ticketId: number; commentId: number; body: string };

export class DashboardDeletionService {
  private readonly inFlight = new Set<string>();
  constructor(private readonly deps: DashboardDeletionServiceDependencies) {}

  async deleteTicket(request: DeleteTicketRequest): Promise<void> {
    await this.perform(request, (scope) => this.resolveTicket(scope, request.ticketId));
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
      const pendingReview = target.kind === "ticket" && this.hasPendingReview(target, scope)
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
            !this.sameUnverified(target.unverified, verified.unverified) || !this.sameIds(target.ticketIds, verified.ticketIds) ||
            !this.sameOptionalIds(target.pendingSnapshot, verified.pendingSnapshot)) {
          throw new Error(vscode.l10n.t("Pending changes changed while verifying this ticket. Try again."));
        }
        if (verified.pendingSnapshot !== undefined) {
          this.assertPendingSnapshotCurrent(scope, verified.pendingSnapshot);
        }
        if (pendingReview !== undefined) {
          const reviewIds = this.relevantPendingIds(verified, scope);
          const currentItems = this.getReviewItems(scope, request, reviewIds);
          this.assertReviewSnapshotCurrent(pendingReview.items, currentItems);
        }
      }
      this.assertCurrent(request, scope);
      this.deps.assertCanDelete(this.protectionInput(scope, verified));
      await this.deps.runProtectedDelete(this.protectionInput(scope, verified), async () => {
        this.assertCurrent(request, scope);
        await this.writeAndVerify(scope, verified);
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
    const pendingIds = this.relevantPendingIds(target, scope);
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
        const references = this.sortedUnique(target.unverified.filter(gap => item.ticketIds.includes(gap.ticketId))
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

  private hasPendingReview(target: Extract<DeleteTarget, { kind: "ticket" }>, scope: string): boolean {
    return this.relevantPendingIds(target, scope).length > 0;
  }

  private relevantPendingIds(target: Extract<DeleteTarget, { kind: "ticket" }>, scope: string): number[] {
    const pending = target.pendingSnapshot ?? this.sortedUnique(this.deps.getPendingTicketIds(scope));
    const relevant = new Set(target.unverified.map((candidate) => candidate.ticketId));
    for (const ticketId of pending) {
      if (target.ticketIds.includes(ticketId)) { relevant.add(ticketId); }
    }
    return this.sortedUnique([...relevant]);
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
    return items.map((item) => ({ ...item, ticketIds: this.sortedUnique(item.ticketIds) }));
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
        item.version !== next.version || item.inProgress !== next.inProgress || Boolean(item.open) !== Boolean(next.open) || !this.sameIds(item.ticketIds, next.ticketIds);
    })) {
      throw new Error(vscode.l10n.t("Pending changes changed while verifying this ticket. Try again."));
    }
  }

  private sameUnverified(left: readonly UnverifiedDescendant[], right: readonly UnverifiedDescendant[]): boolean {
    return left.length === right.length && left.every((item, index) =>
      item.ticketId === right[index].ticketId && item.unreadableTicketId === right[index].unreadableTicketId);
  }

  private async resolveTicket(scope: string, ticketId: number): Promise<DeleteTarget> {
    const detail = await this.deps.withConnectionScope(scope, () => this.deps.getIssueDetail(ticketId, true));
    if (detail.ticket.id !== ticketId) { throw new Error(vscode.l10n.t("The ticket could not be verified.")); }
    const ticketIds = this.sortedUnique([ticketId, ...(detail.childIssueIds ?? [])]);
    if (ticketIds.length !== (detail.childIssueIds?.length ?? 0) + 1 ||
        ticketIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error(vscode.l10n.t("Redmine returned an invalid ticket hierarchy."));
    }
    const target = { kind: "ticket" as const, ticketId, subject: detail.ticket.subject, ticketIds, unverified: [] };
    if (detail.childIssueIds === undefined) { return target; }
    return { ...target, ...await this.resolvePendingDescendants(scope, ticketIds) };
  }

  private async writeAndVerify(scope: string, target: DeleteTarget): Promise<void> {
    try {
      await this.deps.withConnectionScope(scope, () => target.kind === "ticket"
        ? this.deps.deleteIssue(target.ticketId)
        : this.deps.clearJournalNotes(target.commentId));
    } catch (error) {
      const status = this.deps.getHttpStatusCode(error);
      if (status !== undefined && status >= 400 && status < 500 && status !== 408) { throw error; }
    }

    const verified = target.kind === "ticket"
      ? await this.ticketIsMissing(scope, target.ticketId)
      : await this.commentIsEmpty(scope, target.ticketId, target.commentId);
    if (!verified) {
      throw new Error(vscode.l10n.t("The deletion result could not be confirmed. Review the item in Redmine before trying again."));
    }
  }

  private async resolvePendingDescendants(
    scope: string,
    visibleTicketIds: number[],
  ): Promise<{ ticketIds: number[]; pendingSnapshot: number[]; unverified: UnverifiedDescendant[] }> {
    const pendingSnapshot = this.sortedUnique(this.deps.getPendingTicketIds(scope));
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
          detail = await this.deps.withConnectionScope(scope, () => this.deps.getIssueDetail(currentId, false));
        } catch (error) {
          const status = this.deps.getHttpStatusCode(error);
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
    const currentSnapshot = this.sortedUnique(this.deps.getPendingTicketIds(scope));
    if (!this.sameIds(pendingSnapshot, currentSnapshot)) {
      throw new Error(vscode.l10n.t("Pending changes changed while verifying this ticket. Try again."));
    }
    return {
      ticketIds: this.sortedUnique([...visibleTicketIds, ...pendingDescendants]),
      pendingSnapshot,
      unverified,
    };
  }

  private assertPendingSnapshotCurrent(scope: string, pendingSnapshot: number[]): void {
    if (!this.sameIds(pendingSnapshot, this.sortedUnique(this.deps.getPendingTicketIds(scope)))) {
      throw new Error(vscode.l10n.t("Pending changes changed while verifying this ticket. Try again."));
    }
  }

  private async ticketIsMissing(scope: string, ticketId: number): Promise<boolean> {
    try {
      await this.deps.withConnectionScope(scope, () => this.deps.getIssueDetail(ticketId));
      return false;
    } catch (error) {
      if (this.deps.getHttpStatusCode(error) === 404) { return true; }
      return false;
    }
  }

  private async commentIsEmpty(scope: string, ticketId: number, commentId: number): Promise<boolean> {
    try {
      const detail = await this.deps.withConnectionScope(scope, () => this.deps.getIssueDetail(ticketId));
      return detail.ticket.id === ticketId &&
        !detail.comments.some((item) => item.id === commentId && item.body.trim().length > 0);
    } catch {
      return false;
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

  private sortedUnique(ids: readonly number[]): number[] {
    return Array.from(new Set(ids)).sort((left, right) => left - right);
  }

  private sameIds(left: readonly number[], right: readonly number[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
  }

  private sameOptionalIds(left: readonly number[] | undefined, right: readonly number[] | undefined): boolean {
    if (left === undefined || right === undefined) { return left === right; }
    return this.sameIds(left, right);
  }

  private errorMessage(error: unknown): string {
    const status = this.deps.getHttpStatusCode(error);
    if (status !== undefined) {
      return vscode.l10n.t("Redmine rejected the deletion request (HTTP {0}).", status);
    }
    return error instanceof Error ? error.message : String(error);
  }
}
