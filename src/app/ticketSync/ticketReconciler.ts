import type { OfflineTicketUpdate } from "../../views/offlineSyncStore";
import { editorContentFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import { updateDraftAfterSave } from "../../views/ticketDraftStore";
import type { TicketSaveDependencies } from "../../views/ticketSync/types";
import type { TicketSaveResult } from "../../views/ticketSaveTypes";
import type { DocumentPort, SyncContext, SyncJournal } from "./ports";
import type { TicketSyncOutcome } from "./ticketSyncOutcome";
import { rebaseTicketEditorContent } from "./ticketIntentRebase";

const lifecycleExpectation = (operation: OfflineTicketUpdate) => {
  if (operation.revision === undefined || operation.phase === undefined) {
    throw new Error("Ticket update operation is missing normalized lifecycle fields.");
  }
  return {
    operationId: operation.operationId ?? `ticket:${operation.ticketId}`,
    revision: operation.revision,
    sourcePhase: operation.phase,
  };
};

export class TicketReconciler {
  public constructor(
    private readonly journal: SyncJournal,
    private readonly documents: DocumentPort,
  ) {}

  public async reconcile(input: {
    context: SyncContext;
    operation: OfflineTicketUpdate;
    deps: TicketSaveDependencies;
    remoteCommitted: boolean;
    noChange: boolean;
    completionResult?: TicketSaveResult;
  }): Promise<TicketSyncOutcome> {
    let detail;
    try {
      detail = await input.deps.getIssueDetail(input.operation.ticketId);
    } catch (error) {
      if (input.remoteCommitted) {
        try {
          await this.journal.transitionTicketUpdate(
            input.operation.ticketId,
            { kind: "mark_reconciliation_pending" },
            input.context.connectionScope,
            lifecycleExpectation(input.operation),
          );
        } catch {
          // Preserve the remote-committed outcome if journal persistence also fails.
        }
        return {
          kind: "remote_committed",
          ticketId: input.operation.ticketId,
          pending: "remote_reconcile",
          message: error instanceof Error ? error.message : "Remote read-back failed.",
        };
      }
      return {
        kind: "failed_before_commit",
        error: error instanceof Error ? error : new Error("Remote read-back failed."),
      };
    }

    if (!detail.ticket.updatedAt) {
      if (input.remoteCommitted) {
        try {
          await this.journal.transitionTicketUpdate(
            input.operation.ticketId,
            { kind: "mark_reconciliation_pending" },
            input.context.connectionScope,
            lifecycleExpectation(input.operation),
          );
        } catch {
          // Preserve the remote-committed outcome.
        }
        return {
          kind: "remote_committed",
          ticketId: input.operation.ticketId,
          pending: "remote_reconcile",
          message: "Remote read-back did not include an updated revision.",
        };
      }
      return {
        kind: "failed_before_commit",
        error: new Error("Remote read-back did not include an updated revision."),
      };
    }

    const canonical = editorContentFromTicket(detail.ticket, {
      layout: input.operation.layout,
      metadataBlock: input.operation.metadataBlock,
      controlFields: input.operation.controlFields,
    });
    const latestOperation = this.journal.getTicketUpdate(
      input.operation.ticketId,
      input.context.connectionScope,
    ) ?? input.operation;
    const next = latestOperation.nextIntent;
    const replacement = next
      ? rebaseTicketEditorContent(
        {
          subject: input.operation.subject,
          description: input.operation.description,
          metadata: input.operation.metadata,
          layout: input.operation.layout,
          metadataBlock: input.operation.metadataBlock,
          controlFields: input.operation.controlFields,
        },
        canonical,
        {
          subject: next.subject,
          description: next.description,
          metadata: next.metadata,
          layout: next.layout,
          metadataBlock: next.metadataBlock,
          controlFields: next.controlFields,
        },
      )
      : canonical;

    if (input.remoteCommitted) {
      try {
        await this.journal.transitionTicketUpdate(
          input.operation.ticketId,
          { kind: "mark_local_finalize_pending", remoteUpdatedAt: detail.ticket.updatedAt },
          input.context.connectionScope,
          lifecycleExpectation(input.operation),
        );
      } catch (error) {
        return {
          kind: "remote_committed",
          ticketId: input.operation.ticketId,
          pending: "local_finalize",
          message: error instanceof Error ? error.message : "Sync journal persistence failed.",
        };
      }
    }

    try {
      if (input.operation.documentUri && this.documents.rewriteTicket) {
        const rewritten = await this.documents.rewriteTicket({
          documentUri: input.operation.documentUri,
          ticketId: input.operation.ticketId,
          projectId: detail.ticket.projectId,
          replacement,
        });
        if (!rewritten) {
          if (input.remoteCommitted) {
            return {
              kind: "remote_committed",
              ticketId: input.operation.ticketId,
              pending: "local_finalize",
              message: "File rewrite or save failed.",
            };
          }
          return {
            kind: "failed_before_commit",
            error: new Error("File rewrite or save failed."),
          };
        }
      }

      updateDraftAfterSave(
        input.operation.ticketId,
        canonical.subject,
        canonical.description,
        canonical.metadata,
        detail.ticket.updatedAt,
        input.context.connectionScope,
      );
    } catch (error) {
      return input.remoteCommitted
        ? {
          kind: "remote_committed",
          ticketId: input.operation.ticketId,
          pending: "local_finalize",
          message: error instanceof Error ? error.message : "Local finalization failed.",
        }
        : {
          kind: "failed_before_commit",
          error: error instanceof Error ? error : new Error("Local finalization failed."),
        };
    }

    try {
      const completed = await this.journal.completeTicketUpdate(
        input.operation.ticketId,
        input.context.connectionScope,
        { canonical, remoteUpdatedAt: detail.ticket.updatedAt },
        input.operation.revision,
      );
      if (!completed) {
        return {
          kind: "remote_committed",
          ticketId: input.operation.ticketId,
          pending: "local_finalize",
          message: "A newer local revision arrived during finalization.",
        };
      }
    } catch (error) {
      return input.remoteCommitted
        ? {
          kind: "remote_committed",
          ticketId: input.operation.ticketId,
          pending: "local_finalize",
          message: error instanceof Error ? error.message : "Journal completion failed.",
        }
        : {
          kind: "failed_before_commit",
          error: error instanceof Error ? error : new Error("Journal completion failed."),
        };
    }

    return input.noChange
      ? {
        kind: "no_change",
        ticketId: input.operation.ticketId,
        saveResult: input.completionResult,
      }
      : {
        kind: "completed",
        ticketId: input.operation.ticketId,
        saveResult: input.completionResult,
      };
  }
}
