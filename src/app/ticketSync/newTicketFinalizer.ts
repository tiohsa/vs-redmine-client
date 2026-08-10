import type { TicketCreateDependencies } from "../../views/ticketSync/types";
import type { OfflineNewTicket } from "../../views/offlineSyncStore";
import { parseTicketEditorContent } from "../../views/ticketEditorContent";
import { editorContentFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import type {
  DocumentPort,
  NewTicketLocalStatePort,
  SyncContext,
  SyncJournal,
} from "./ports";
import type { TicketSyncOutcome } from "./ticketSyncOutcome";

export class NewTicketFinalizer {
  public constructor(
    private readonly journal: SyncJournal,
    private readonly documents: DocumentPort,
    private readonly localState: NewTicketLocalStatePort,
  ) {}

  public async finalize(input: {
    context: SyncContext;
    operation: OfflineNewTicket;
    ticketId: number;
    deps: TicketCreateDependencies;
  }): Promise<TicketSyncOutcome> {
    const key = {
      queueId: input.operation.queueId,
      documentUri: input.operation.documentUri,
    };
    if (!input.deps.getIssueDetail) {
      try {
        await this.journal.markNewTicket(
          key,
          { phase: "reconciliation_pending" },
          input.context.connectionScope,
        );
      } catch {
        // The remote commit is still the authoritative outcome.
      }
      return {
        kind: "remote_committed",
        ticketId: input.ticketId,
        pending: "remote_reconcile",
        message: "Remote read-back is unavailable.",
      };
    }

    let detail;
    try {
      detail = await input.deps.getIssueDetail(input.ticketId);
    } catch (error) {
      try {
        await this.journal.markNewTicket(
          key,
          { phase: "reconciliation_pending" },
          input.context.connectionScope,
        );
      } catch {
        // Preserve the remote-committed outcome even if the pending phase cannot be persisted.
      }
      return {
        kind: "remote_committed",
        ticketId: input.ticketId,
        pending: "remote_reconcile",
        message: error instanceof Error ? error.message : "Remote read-back failed.",
      };
    }

    if (!detail.ticket.updatedAt) {
      try {
        await this.journal.markNewTicket(
          key,
          { phase: "reconciliation_pending", remoteUpdatedAt: undefined },
          input.context.connectionScope,
        );
      } catch {
        // Preserve the remote-committed outcome.
      }
      return {
        kind: "remote_committed",
        ticketId: input.ticketId,
        pending: "remote_reconcile",
        message: "Remote read-back did not include an updated revision.",
      };
    }

    let parsed;
    try {
      parsed = parseTicketEditorContent(input.operation.content, {
        allowMissingMetadata: true,
        fallbackMetadata: {
          tracker: "",
          priority: "",
          status: "",
          due_date: "",
          children: [],
        },
        allowMissingSubject: true,
      });
    } catch (error) {
      try {
        await this.journal.markNewTicket(
          key,
          { phase: "local_finalize_pending", remoteUpdatedAt: detail.ticket.updatedAt },
          input.context.connectionScope,
        );
      } catch {
        // Preserve the remote-committed outcome.
      }
      return {
        kind: "remote_committed",
        ticketId: input.ticketId,
        pending: "local_finalize",
        message: error instanceof Error ? error.message : "Local content parsing failed.",
      };
    }

    const canonical = editorContentFromTicket(detail.ticket, parsed);
    try {
      await this.journal.markNewTicket(
        key,
        { phase: "local_finalize_pending", remoteUpdatedAt: detail.ticket.updatedAt },
        input.context.connectionScope,
      );
    } catch (error) {
      return {
        kind: "remote_committed",
        ticketId: input.ticketId,
        pending: "local_finalize",
        message: error instanceof Error
          ? `Local finalization journal update failed: ${error.message}`
          : "Local finalization journal update failed.",
      };
    }

    if (input.operation.documentUri) {
      let rewritten = false;
      try {
        rewritten = await this.documents.rewriteNewTicket({
          documentUri: input.operation.documentUri,
          ticketId: input.ticketId,
          projectId: detail.ticket.projectId ?? input.operation.projectId,
          replacement: canonical,
        });
      } catch (error) {
        return {
          kind: "remote_committed",
          ticketId: input.ticketId,
          pending: "local_finalize",
          message: error instanceof Error ? error.message : "File rewrite or save failed.",
        };
      }
      if (!rewritten) {
        return {
          kind: "remote_committed",
          ticketId: input.ticketId,
          pending: "local_finalize",
          message: "File rewrite or save failed.",
        };
      }
    }

    try {
      this.localState.register({
        ticketId: input.ticketId,
        documentUri: input.operation.documentUri,
        projectId: detail.ticket.projectId ?? input.operation.projectId,
        connectionScope: input.context.connectionScope,
      });
      this.localState.updateDraft({
        ticketId: input.ticketId,
        canonical,
        remoteUpdatedAt: detail.ticket.updatedAt,
        connectionScope: input.context.connectionScope,
      });
    } catch (error) {
      return {
        kind: "remote_committed",
        ticketId: input.ticketId,
        pending: "local_finalize",
        message: error instanceof Error ? error.message : "Local state finalization failed.",
      };
    }

    try {
      await this.journal.completeNewTicket(key, input.context.connectionScope);
    } catch (error) {
      return {
        kind: "remote_committed",
        ticketId: input.ticketId,
        pending: "local_finalize",
        message: error instanceof Error
          ? `Local state was finalized, but journal completion failed: ${error.message}`
          : "Local state was finalized, but journal completion failed.",
      };
    }
    return { kind: "completed", ticketId: input.ticketId };
  }
}
