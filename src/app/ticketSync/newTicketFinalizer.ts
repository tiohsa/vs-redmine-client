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
import { rebaseTicketEditorContent } from "./ticketIntentRebase";
import type { OfflineTicketUpdate } from "../../views/offlineSyncStore";
import type { IssueDetailResult } from "../../redmine/issues";

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
    detail?: IssueDetailResult;
  }): Promise<TicketSyncOutcome> {
    const key = {
      queueId: input.operation.queueId,
      documentUri: input.operation.documentUri,
    };
    if (!input.detail && !input.deps.getIssueDetail) {
      try {
        await this.journal.markNewTicket(
          key,
          { phase: "reconciliation_pending" },
          input.context.connectionScope,
          input.operation.revision,
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

    let detail = input.detail;
    try {
      detail ??= await input.deps.getIssueDetail!(input.ticketId);
    } catch (error) {
      try {
        await this.journal.markNewTicket(
          key,
          { phase: "reconciliation_pending" },
          input.context.connectionScope,
          input.operation.revision,
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
          input.operation.revision,
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
          input.operation.revision,
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
    const latestOperation = this.journal.getNewTicket(
      key,
      input.context.connectionScope,
    ) ?? input.operation;
    let replacement = canonical;
    let promotion: (OfflineTicketUpdate & { sourceRevision?: number }) | undefined;
    if (latestOperation.nextIntent) {
      try {
        const latest = parseTicketEditorContent(latestOperation.nextIntent.content, {
          allowMissingMetadata: true,
          fallbackMetadata: parsed.metadata,
          allowMissingSubject: true,
        });
        replacement = rebaseTicketEditorContent(parsed, canonical, latest);
        promotion = {
          ticketId: input.ticketId,
          baseSubject: canonical.subject,
          baseDescription: canonical.description,
          baseMetadata: canonical.metadata,
          lastKnownRemoteUpdatedAt: detail.ticket.updatedAt,
          subject: replacement.subject,
          description: replacement.description,
          metadata: replacement.metadata,
          layout: replacement.layout,
          metadataBlock: replacement.metadataBlock,
          controlFields: replacement.controlFields,
          baseDir: latestOperation.nextIntent.baseDir ?? input.operation.baseDir,
          documentUri: latestOperation.nextIntent.documentUri ?? input.operation.documentUri,
          operationId: input.operation.operationId,
          connectionScope: input.context.connectionScope,
          phase: "queued",
          revision: latestOperation.nextIntent.revision,
          sourceRevision: latestOperation.nextIntent.revision,
        };
      } catch (error) {
        return {
          kind: "remote_committed",
          ticketId: input.ticketId,
          pending: "local_finalize",
          message: error instanceof Error ? error.message : "Later local content parsing failed.",
        };
      }
    }
    try {
      await this.journal.markNewTicket(
        key,
        { phase: "local_finalize_pending", remoteUpdatedAt: detail.ticket.updatedAt },
        input.context.connectionScope,
        input.operation.revision,
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
          replacement,
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
      const completed = await this.journal.completeNewTicket(
        key,
        input.context.connectionScope,
        promotion,
        input.operation.revision,
      );
      if (!completed) {
        return {
          kind: "remote_committed",
          ticketId: input.ticketId,
          pending: "local_finalize",
          message: "A newer local revision arrived during finalization.",
        };
      }
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
