import * as vscode from "vscode";
import type {
  NewTicketSyncPhase,
  OfflineNewTicket,
  OfflineTicketUpdate,
  TicketUpdateSyncPhase,
} from "../../views/offlineSyncStore";
import {
  addOfflineNewTicketAsync,
  completeOfflineNewTicketAsync,
  completeOfflineTicketUpdateAsync,
  getOfflineSyncQueue,
  getOfflineNewTicket,
  transitionOfflineNewTicketLifecycleAsync,
  transitionOfflineTicketUpdateLifecycleAsync,
} from "../../views/offlineSyncStore";
import { rewriteDocumentWithRegisteredFields, type RewriteDocumentDeps } from "../../views/editorDocumentRewrite";
import { createTicketFromContent } from "../../views/ticketSync/ticketCreateSync";
import {
  applyQueuedTicketUpdate,
  queueNewTicketDraft,
  queueTicketDraft,
} from "../../views/ticketSync/ticketQueueSync";
import { defaultCreateDeps, defaultDeps } from "../../views/ticketSync/ticketSyncDeps";
import type { TicketCreateDependencies, TicketSaveDependencies } from "../../views/ticketSync/types";
import type { DocumentPort, SyncContext, SyncJournal } from "./ports";
import type { NewTicketLocalStatePort } from "./ports";
import { NewTicketFinalizer } from "./newTicketFinalizer";
import { TicketReconciler } from "./ticketReconciler";
import type {
  SyncAllOutcome,
  TicketSyncOutcome,
  TicketSyncQueueKey,
} from "./ticketSyncOutcome";
import { runWithConnectionScope } from "../../redmine/client";
import { getProjectIdForEditor } from "../../views/ticketEditorRegistry";
import { resolveEditorBaseDir } from "../../utils/editorBaseDir";
import type { TicketSaveResult } from "../../views/ticketSaveTypes";
import { updateDraftAfterSave } from "../../views/ticketDraftStore";
import {
  registerTicketDocument,
  removeTicketEditorByUri,
} from "../../views/ticketEditorRegistry";

const defaultJournal: SyncJournal = {
  getNewTicket: getOfflineNewTicket,
  getTicketUpdate: (ticketId, scope) => getOfflineSyncQueue(scope).tickets.get(ticketId),
  saveNewTicket: addOfflineNewTicketAsync,
  transitionNewTicket: transitionOfflineNewTicketLifecycleAsync,
  completeNewTicket: completeOfflineNewTicketAsync,
  transitionTicketUpdate: transitionOfflineTicketUpdateLifecycleAsync,
  completeTicketUpdate: completeOfflineTicketUpdateAsync,
};

const newTicketExpectation = (
  operation: OfflineNewTicket,
  sourcePhase: NewTicketSyncPhase,
) => {
  if (operation.revision === undefined) {
    throw new Error("New ticket operation is missing its normalized revision.");
  }
  return {
    operationId: operation.operationId ?? operation.queueId,
    revision: operation.revision,
    sourcePhase,
  };
};

const ticketUpdateExpectation = (
  operation: OfflineTicketUpdate,
  sourcePhase: TicketUpdateSyncPhase,
) => {
  if (operation.revision === undefined) {
    throw new Error("Ticket update operation is missing its normalized revision.");
  }
  return {
    operationId: operation.operationId ?? `ticket:${operation.ticketId}`,
    revision: operation.revision,
    sourcePhase,
  };
};

const defaultDocumentPort = (rewriteDeps: RewriteDocumentDeps = {}): DocumentPort => ({
  rewriteNewTicket: ({ documentUri, ticketId, projectId, replacement }) =>
    rewriteDocumentWithRegisteredFields(
      documentUri,
      ticketId,
      rewriteDeps,
      projectId,
      replacement,
    ),
  rewriteTicket: ({ documentUri, ticketId, projectId, replacement }) =>
    rewriteDocumentWithRegisteredFields(
      documentUri,
      ticketId,
      rewriteDeps,
      projectId,
      replacement,
    ),
  findOpenDocument: (uri) =>
    vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri),
});

const defaultNewTicketLocalState = (
  documents: DocumentPort,
): NewTicketLocalStatePort => ({
  register: ({ ticketId, documentUri, projectId, connectionScope }) => {
    if (!documentUri) {
      return;
    }
    const document = documents.findOpenDocument(documentUri);
    if (!document) {
      return;
    }
    removeTicketEditorByUri(vscode.Uri.parse(documentUri));
    registerTicketDocument(
      ticketId,
      document,
      "ticket",
      projectId,
      connectionScope,
    );
  },
  updateDraft: ({ ticketId, canonical, remoteUpdatedAt, connectionScope }) => {
    updateDraftAfterSave(
      ticketId,
      canonical.subject,
      canonical.description,
      canonical.metadata,
      remoteUpdatedAt,
      connectionScope,
    );
  },
});

const newTicketFlights = new Map<string, Promise<TicketSyncOutcome>>();
const ticketUpdateFlights = new Map<string, Promise<TicketSyncOutcome>>();

export class TicketSyncQueueItemNotFoundError extends Error {
  public constructor(key: TicketSyncQueueKey) {
    super(key.kind === "ticket"
      ? `Queue entry for ticket #${key.ticketId} was not found.`
      : "Queue entry for the new ticket was not found.");
    this.name = "TicketSyncQueueItemNotFoundError";
  }
}

export interface TicketSyncServiceDependencies {
  journal?: SyncJournal;
  documents?: DocumentPort;
  create?: Partial<TicketCreateDependencies>;
  update?: Partial<TicketSaveDependencies>;
  rewrite?: RewriteDocumentDeps;
  newTicketLocalState?: NewTicketLocalStatePort;
  runInConnectionScope?: <T>(
    connectionScope: string,
    operation: () => Promise<T>,
  ) => Promise<T>;
}

export class TicketSyncService {
  private readonly journal: SyncJournal;
  private readonly documents: DocumentPort;
  private readonly createDeps: TicketCreateDependencies;
  private readonly updateDeps: TicketSaveDependencies;
  private readonly newTicketFinalizer: NewTicketFinalizer;
  private readonly ticketReconciler: TicketReconciler;
  private readonly runInConnectionScope: NonNullable<
    TicketSyncServiceDependencies["runInConnectionScope"]
  >;

  public constructor(deps: TicketSyncServiceDependencies = {}) {
    this.journal = deps.journal ?? defaultJournal;
    this.documents = deps.documents ?? defaultDocumentPort(deps.rewrite);
    this.createDeps = { ...defaultCreateDeps, ...deps.create };
    this.updateDeps = { ...defaultDeps, ...deps.update };
    this.runInConnectionScope = deps.runInConnectionScope ?? runWithConnectionScope;
    this.newTicketFinalizer = new NewTicketFinalizer(
      this.journal,
      this.documents,
      deps.newTicketLocalState ?? defaultNewTicketLocalState(this.documents),
    );
    this.ticketReconciler = new TicketReconciler(this.journal, this.documents);
  }

  public async syncNewTicket(input: {
    context: SyncContext;
    operation: Omit<OfflineNewTicket, "queueId"> & { queueId?: string };
  }): Promise<TicketSyncOutcome> {
    let operation: OfflineNewTicket;
    try {
      operation = await this.journal.saveNewTicket(
        {
          ...input.operation,
          connectionScope: input.context.connectionScope,
        },
        input.context.connectionScope,
      );
    } catch (error) {
      return {
        kind: "failed_before_commit",
        error: error instanceof Error ? error : new Error("Sync journal persistence failed."),
      };
    }
    return this.createOrResume({
      context: input.context,
      operation,
    });
  }

  public async syncEditor(input: {
    context: SyncContext;
    editor: vscode.TextEditor;
    ticketId: number;
    newTicket: boolean;
    manual: boolean;
    projectId?: number;
  }): Promise<TicketSyncOutcome> {
    if (input.newTicket) {
      if (input.manual) {
        const queued = await queueNewTicketDraft({
          editor: input.editor,
          operationScope: input.context.connectionScope,
        });
        return this.preparationOutcome(queued, input.ticketId);
      }
      return this.syncNewTicket({
        context: input.context,
        operation: {
          content: input.editor.document.getText(),
          projectId: input.projectId ?? getProjectIdForEditor(input.editor),
          documentUri: input.editor.document.uri.toString(),
          baseDir: resolveEditorBaseDir({ editor: input.editor }),
        },
      });
    }

    const prepared = await queueTicketDraft({
      ticketId: input.ticketId,
      content: input.editor.document.getText(),
      editor: input.editor,
      operationScope: input.context.connectionScope,
      queueUnchanged: !input.manual,
    });
    if (input.manual || (prepared.status !== "queued" && prepared.status !== "no_change")) {
      return this.preparationOutcome(prepared, input.ticketId);
    }
    return this.syncQueueItem(
      { kind: "ticket", ticketId: input.ticketId },
      input.context,
    );
  }

  private preparationOutcome(
    result: TicketSaveResult,
    ticketId: number,
  ): TicketSyncOutcome {
    switch (result.status) {
      case "queued":
        return { kind: "queued" };
      case "no_change":
        return { kind: "no_change", ticketId, saveResult: result };
      case "conflict":
        return {
          kind: "conflict",
          ticketId,
          message: result.message,
          conflictContext: result.conflictContext,
        };
      case "success":
      case "created":
        return { kind: "completed", ticketId, saveResult: result };
      default:
        return {
          kind: "failed_before_commit",
          error: new Error(result.message),
          saveResult: result,
        };
    }
  }

  public async createOrResume(input: {
    context: SyncContext;
    operation: OfflineNewTicket;
  }): Promise<TicketSyncOutcome> {
    const operationKey = [
      input.context.connectionScope,
      input.operation.operationId ?? input.operation.queueId ?? input.operation.documentUri,
    ].join("::");
    const existing = newTicketFlights.get(operationKey);
    if (existing) {
      return existing;
    }
    const flight = this.createOrResumeInternal(input);
    newTicketFlights.set(operationKey, flight);
    try {
      return await flight;
    } finally {
      if (newTicketFlights.get(operationKey) === flight) {
        newTicketFlights.delete(operationKey);
      }
    }
  }

  private async createOrResumeInternal(input: {
    context: SyncContext;
    operation: OfflineNewTicket;
  }): Promise<TicketSyncOutcome> {
    return this.runInConnectionScope(
      input.context.connectionScope,
      () => this.createOrResumeWithScope(input),
    );
  }

  private async createOrResumeWithScope(input: {
    context: SyncContext;
    operation: OfflineNewTicket;
  }): Promise<TicketSyncOutcome> {
    if (
      input.operation.connectionScope &&
      input.operation.connectionScope !== input.context.connectionScope
    ) {
      return {
        kind: "failed_before_commit",
        error: new Error("Connection scope mismatch."),
      };
    }

    const operationId = input.operation.operationId ?? input.operation.queueId;
    if (
      input.operation.phase === "remote_write_started" ||
      input.operation.phase === "commit_unknown"
    ) {
      return {
        kind: "commit_unknown",
        operationId,
        ticketId: input.operation.createdIssueId,
        message: "The previous remote create may have committed. Resolve it before retrying.",
      };
    }

    let ticketId = input.operation.createdIssueId;
    let operation = input.operation;
    if (!ticketId && operation.phase === "queued") {
      const preparing = await this.journal.transitionNewTicket(
        { queueId: operation.queueId, documentUri: operation.documentUri },
        { kind: "begin_preparation" },
        input.context.connectionScope,
        newTicketExpectation(operation, "queued"),
      );
      if (!preparing) {
        return {
          kind: "failed_before_commit",
          error: new Error("New ticket operation changed before preparation."),
        };
      }
      operation = preparing;
    }
    if (!ticketId) {
      const created = await createTicketFromContent({
        content: operation.content,
        projectId: operation.projectId,
        baseDir: operation.baseDir,
        deps: this.createDeps,
        beforeRemoteWrite: async () => {
          const started = await this.journal.transitionNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            { kind: "start_normal_remote_write" },
            input.context.connectionScope,
            newTicketExpectation(operation, "preparing"),
          );
          if (!started) {
            throw new Error("New ticket operation disappeared before remote create.");
          }
          operation = started;
        },
      });
      if (created.remoteCommitUnknown) {
        try {
          await this.journal.transitionNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            { kind: "mark_commit_unknown" },
            input.context.connectionScope,
            newTicketExpectation(operation, "remote_write_started"),
          );
        } catch {
          // remote_write_started is already durable and is treated as commit_unknown on restart.
        }
        return {
          kind: "commit_unknown",
          operationId,
          message: "The remote create result is unknown. Automatic retry is disabled.",
        };
      }
      if (
        !created.createdId ||
        (created.result.status !== "created" && !created.remoteIssueMayExist)
      ) {
        try {
          if (operation.phase === "preparing") {
            await this.journal.transitionNewTicket(
              { queueId: operation.queueId, documentUri: operation.documentUri },
              { kind: "abort_before_remote_write" },
              input.context.connectionScope,
              newTicketExpectation(operation, "preparing"),
            );
          }
        } catch {
          // A durable remote_write_started remains safe-side if it had been reached.
        }
        return {
          kind: "failed_before_commit",
          error: new Error(created.result.message),
          saveResult: created.result,
        };
      }
      ticketId = created.createdId;
      let durable;
      try {
        durable = await this.journal.transitionNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          { kind: "record_remote_created", ticketId },
          input.context.connectionScope,
          newTicketExpectation(operation, "remote_write_started"),
        );
      } catch (error) {
        return {
          kind: "remote_committed",
          ticketId,
          pending: "local_finalize",
          message: error instanceof Error
            ? `Issue #${ticketId} was created, but its journal barrier failed: ${error.message}`
            : `Issue #${ticketId} was created, but its journal barrier failed.`,
        };
      }
      if (!durable) {
        return {
          kind: "remote_committed",
          ticketId,
          pending: "local_finalize",
          message: "Created issue could not be recorded in the sync journal.",
        };
      }
      operation = durable;
    }

    return this.newTicketFinalizer.finalize({
      context: input.context,
      operation,
      ticketId,
      deps: this.createDeps,
    });
  }

  public async syncQueueItem(
    key: TicketSyncQueueKey,
    context: SyncContext,
  ): Promise<TicketSyncOutcome> {
    if (key.kind === "newTicket") {
      const operation = getOfflineNewTicket(key, context.connectionScope);
      if (!operation) {
        return {
          kind: "failed_before_commit",
          error: new TicketSyncQueueItemNotFoundError(key),
        };
      }
      return this.createOrResume({ context, operation });
    }

    const operation = getOfflineSyncQueue(context.connectionScope).tickets.get(key.ticketId);
    if (!operation) {
      return {
        kind: "failed_before_commit",
        error: new TicketSyncQueueItemNotFoundError(key),
      };
    }
    const operationKey = `${context.connectionScope}::ticket::${operation.ticketId}`;
    const existing = ticketUpdateFlights.get(operationKey);
    if (existing) {
      return existing;
    }
    const flight = this.updateOrReconcile(context, operation);
    ticketUpdateFlights.set(operationKey, flight);
    try {
      return await flight;
    } finally {
      if (ticketUpdateFlights.get(operationKey) === flight) {
        ticketUpdateFlights.delete(operationKey);
      }
    }
  }

  public async resolveCommitUnknown(input: {
    key: TicketSyncQueueKey;
    context: SyncContext;
    resolution:
      | { kind: "link_created_ticket"; ticketId: number }
      | { kind: "assume_update_committed" }
      | { kind: "retry_remote_write" };
  }): Promise<TicketSyncOutcome> {
    return this.runInConnectionScope(input.context.connectionScope, async () => {
      if (input.key.kind === "newTicket") {
        let operation = this.journal.getNewTicket(
          input.key,
          input.context.connectionScope,
        );
        if (!operation) {
          return {
            kind: "failed_before_commit",
            error: new TicketSyncQueueItemNotFoundError(input.key),
          };
        }
        if (operation.phase === "remote_write_started") {
          return {
            kind: "commit_unknown",
            operationId: operation.operationId ?? operation.queueId,
            ticketId: operation.createdIssueId,
            message: "A remote create is already in flight or requires restart recovery.",
          };
        }
        if (operation.phase !== "commit_unknown") {
          return this.createOrResume({ context: input.context, operation });
        }
        if (input.resolution.kind === "retry_remote_write") {
          return this.retryNewTicketRemoteWrite(input.context, operation);
        }
        if (input.resolution.kind !== "link_created_ticket") {
          return {
            kind: "failed_before_commit",
            error: new Error("A new-ticket recovery requires a verified ticket ID."),
          };
        }
        if (!this.createDeps.getIssueDetail) {
          return {
            kind: "failed_before_commit",
            error: new Error("Remote ticket verification is unavailable."),
          };
        }
        let detail;
        try {
          detail = await this.createDeps.getIssueDetail(input.resolution.ticketId);
        } catch (error) {
          return {
            kind: "failed_before_commit",
            error: error instanceof Error ? error : new Error("Remote ticket verification failed."),
          };
        }
        if (
          operation.projectId !== undefined &&
          detail.ticket.projectId !== undefined &&
          operation.projectId !== detail.ticket.projectId
        ) {
          return {
            kind: "failed_before_commit",
            error: new Error("The selected ticket belongs to a different project."),
          };
        }
        const linked = await this.journal.transitionNewTicket(
          input.key,
          { kind: "link_created_ticket", ticketId: input.resolution.ticketId },
          input.context.connectionScope,
          newTicketExpectation(operation, "commit_unknown"),
        );
        if (!linked) {
          return {
            kind: "failed_before_commit",
            error: new TicketSyncQueueItemNotFoundError(input.key),
          };
        }
        return this.newTicketFinalizer.finalize({
          context: input.context,
          operation: linked,
          ticketId: input.resolution.ticketId,
          deps: this.createDeps,
          detail,
        });
      }

      let operation = this.journal.getTicketUpdate(
        input.key.ticketId,
        input.context.connectionScope,
      );
      if (!operation) {
        return {
          kind: "failed_before_commit",
          error: new TicketSyncQueueItemNotFoundError(input.key),
        };
      }
      if (input.resolution.kind === "link_created_ticket") {
        return {
          kind: "failed_before_commit",
          error: new Error("An existing-ticket recovery cannot link another ticket ID."),
        };
      }
      if (operation.phase === "remote_write_started") {
        return {
          kind: "commit_unknown",
          operationId: operation.operationId ?? `ticket:${operation.ticketId}`,
          ticketId: operation.ticketId,
          message: "A remote update is already in flight or requires restart recovery.",
        };
      }
      if (operation.phase !== "commit_unknown") {
        return this.updateOrReconcile(input.context, operation);
      }
      if (input.resolution.kind === "retry_remote_write") {
        return this.updateOrReconcile(input.context, operation, true);
      }
      const resolved = await this.journal.transitionTicketUpdate(
        operation.ticketId,
        { kind: "assume_update_committed" },
        input.context.connectionScope,
        ticketUpdateExpectation(operation, "commit_unknown"),
      );
      return resolved
        ? this.updateOrReconcile(input.context, resolved)
        : {
          kind: "failed_before_commit",
          error: new TicketSyncQueueItemNotFoundError(input.key),
        };
    });
  }

  private async retryNewTicketRemoteWrite(
    context: SyncContext,
    initialOperation: OfflineNewTicket,
  ): Promise<TicketSyncOutcome> {
    let operation = initialOperation;
    const operationId = operation.operationId ?? operation.queueId;
    const created = await createTicketFromContent({
      content: operation.content,
      projectId: operation.projectId,
      baseDir: operation.baseDir,
      deps: this.createDeps,
      beforeRemoteWrite: async () => {
        const started = await this.journal.transitionNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          { kind: "start_explicit_retry_remote_write" },
          context.connectionScope,
          newTicketExpectation(operation, "commit_unknown"),
        );
        if (!started) {
          throw new Error("New ticket recovery changed before the explicit retry.");
        }
        operation = started;
      },
    });
    if (created.remoteCommitUnknown) {
      try {
        await this.journal.transitionNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          { kind: "mark_commit_unknown" },
          context.connectionScope,
          newTicketExpectation(operation, "remote_write_started"),
        );
      } catch {
        // remote_write_started remains a conservative commit-unknown checkpoint.
      }
      return {
        kind: "commit_unknown",
        operationId,
        message: "The explicit retry result is unknown. Automatic retry is disabled.",
      };
    }
    if (!created.createdId || created.result.status !== "created") {
      if (operation.phase === "remote_write_started") {
        try {
          await this.journal.transitionNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            { kind: "mark_commit_unknown" },
            context.connectionScope,
            newTicketExpectation(operation, "remote_write_started"),
          );
        } catch {
          // Keep the durable remote-write checkpoint.
        }
      }
      return {
        kind: "commit_unknown",
        operationId,
        message: created.result.message,
      };
    }
    const ticketId = created.createdId;
    const durable = await this.journal.transitionNewTicket(
      { queueId: operation.queueId, documentUri: operation.documentUri },
      { kind: "record_remote_created", ticketId },
      context.connectionScope,
      newTicketExpectation(operation, "remote_write_started"),
    );
    if (!durable) {
      return {
        kind: "remote_committed",
        ticketId,
        pending: "local_finalize",
        message: "Created issue could not be recorded in the sync journal.",
      };
    }
    return this.newTicketFinalizer.finalize({
      context,
      operation: durable,
      ticketId,
      deps: this.createDeps,
    });
  }

  private async updateOrReconcile(
    context: SyncContext,
    operation: OfflineTicketUpdate,
    explicitRetry = false,
  ): Promise<TicketSyncOutcome> {
    return this.runInConnectionScope(
      context.connectionScope,
      () => this.updateOrReconcileAtScope(context, operation, explicitRetry),
    );
  }

  private async updateOrReconcileAtScope(
    context: SyncContext,
    operation: OfflineTicketUpdate,
    explicitRetry: boolean,
  ): Promise<TicketSyncOutcome> {
    if (operation.connectionScope && operation.connectionScope !== context.connectionScope) {
      return {
        kind: "failed_before_commit",
        error: new Error("Connection scope mismatch."),
      };
    }
    const operationId = operation.operationId ?? `ticket:${operation.ticketId}`;
    if (!explicitRetry && (
      operation.phase === "remote_write_started" ||
      operation.phase === "commit_unknown"
    )) {
      return {
        kind: "commit_unknown",
        operationId,
        ticketId: operation.ticketId,
        message: "The previous remote update may have committed. Resolve it before retrying.",
      };
    }
    if (explicitRetry && operation.phase !== "commit_unknown") {
      return {
        kind: "failed_before_commit",
        error: new Error("Ticket update is no longer eligible for explicit retry."),
      };
    }
    if (operation.phase === "queued") {
      const preparing = await this.journal.transitionTicketUpdate(
        operation.ticketId,
        { kind: "begin_preparation" },
        context.connectionScope,
        ticketUpdateExpectation(operation, "queued"),
      );
      if (!preparing) {
        return {
          kind: "failed_before_commit",
          error: new Error("Ticket update operation changed before preparation."),
        };
      }
      operation = preparing;
    }
    let remoteWriteStarted = false;
    const result = await applyQueuedTicketUpdate({
      operationScope: context.connectionScope,
      update: operation,
      deps: this.updateDeps,
      deferReconciliation: true,
      beforeRemoteWrite: async () => {
        const sourcePhase = explicitRetry ? "commit_unknown" : "preparing";
        const started = await this.journal.transitionTicketUpdate(
          operation.ticketId,
          {
            kind: explicitRetry
              ? "start_explicit_retry_remote_write"
              : "start_normal_remote_write",
          },
          context.connectionScope,
          ticketUpdateExpectation(operation, sourcePhase),
        );
        if (!started) {
          throw new Error("Ticket update operation disappeared before remote update.");
        }
        operation = started;
        remoteWriteStarted = true;
      },
      afterRemoteWrite: async (createdChildIds) => {
        const committed = await this.journal.transitionTicketUpdate(
          operation.ticketId,
          { kind: "record_remote_commit", createdChildIds },
          context.connectionScope,
          ticketUpdateExpectation(operation, "remote_write_started"),
        );
        if (!committed) {
          throw new Error("Ticket update commit could not be recorded.");
        }
        operation = committed;
      },
    });
    if (result.remoteCommitUnknown) {
      try {
        await this.journal.transitionTicketUpdate(
          operation.ticketId,
          { kind: "mark_commit_unknown" },
          context.connectionScope,
          ticketUpdateExpectation(operation, "remote_write_started"),
        );
      } catch {
        // remote_write_started remains a conservative commit-unknown checkpoint.
      }
      return {
        kind: "commit_unknown",
        operationId,
        ticketId: operation.ticketId,
        message: "The remote update result is unknown. Automatic retry is disabled.",
      };
    }
    if (result.status === "success" || result.status === "no_change") {
      const current = getOfflineSyncQueue(context.connectionScope).tickets.get(
        operation.ticketId,
      ) ?? operation;
      const remoteCommitted = result.status === "success" && (
        current.phase === "remote_committed" ||
        current.phase === "reconciliation_pending" ||
        current.phase === "local_finalize_pending"
      );
      return this.ticketReconciler.reconcile({
        context,
        operation: current,
        deps: this.updateDeps,
        remoteCommitted,
        noChange: result.status === "no_change",
        completionResult: result,
      });
    }
    if (result.status === "conflict") {
      if (explicitRetry) {
        return {
          kind: "commit_unknown",
          operationId,
          ticketId: operation.ticketId,
          message: result.message,
        };
      }
      try {
        await this.journal.transitionTicketUpdate(
          operation.ticketId,
          { kind: "abort_before_remote_write" },
          context.connectionScope,
          ticketUpdateExpectation(operation, "preparing"),
        );
      } catch {
        // Keep the conflict outcome even when its local cleanup cannot be persisted.
      }
      return {
        kind: "conflict",
        ticketId: operation.ticketId,
        message: result.message,
        conflictContext: result.conflictContext,
      };
    }
    if (explicitRetry) {
      if (remoteWriteStarted && operation.phase === "remote_write_started") {
        try {
          await this.journal.transitionTicketUpdate(
            operation.ticketId,
            { kind: "mark_commit_unknown" },
            context.connectionScope,
            ticketUpdateExpectation(operation, "remote_write_started"),
          );
        } catch {
          // Keep the durable remote-write checkpoint.
        }
      }
      return {
        kind: "commit_unknown",
        operationId,
        ticketId: operation.ticketId,
        message: result.message,
      };
    }
    try {
      if (operation.phase === "preparing") {
        await this.journal.transitionTicketUpdate(
          operation.ticketId,
          { kind: "abort_before_remote_write" },
          context.connectionScope,
          ticketUpdateExpectation(operation, "preparing"),
        );
      }
    } catch {
      // Preserve the safe-side remote_write_started checkpoint if it had been reached.
    }
    const pending = getOfflineSyncQueue(context.connectionScope).tickets.get(
      operation.ticketId,
    );
    if (
      pending?.phase === "remote_committed" ||
      pending?.phase === "reconciliation_pending" ||
      pending?.phase === "local_finalize_pending"
    ) {
      return {
        kind: "remote_committed",
        ticketId: operation.ticketId,
        pending: pending.phase === "local_finalize_pending"
          ? "local_finalize"
          : "remote_reconcile",
        message: result.message,
      };
    }
    return {
      kind: "failed_before_commit",
      error: new Error(result.message),
      saveResult: result,
    };
  }

  public async syncAll(
    context: SyncContext,
    options: { shouldContinue?: () => boolean } = {},
  ): Promise<SyncAllOutcome> {
    const queue = getOfflineSyncQueue(context.connectionScope);
    const keys: TicketSyncQueueKey[] = [
      ...queue.newTickets.map((operation) => ({
        kind: "newTicket" as const,
        queueId: operation.queueId,
        documentUri: operation.documentUri,
      })),
      ...Array.from(queue.tickets.keys()).map((ticketId) => ({
        kind: "ticket" as const,
        ticketId,
      })),
    ];
    const results: SyncAllOutcome["results"] = [];
    for (const key of keys) {
      if (options.shouldContinue && !options.shouldContinue()) {
        return { results, cancelled: true };
      }
      results.push({ key, outcome: await this.syncQueueItem(key, context) });
    }
    return { results, cancelled: false };
  }
}

export const createTicketSyncService = (
  deps: TicketSyncServiceDependencies = {},
): TicketSyncService => new TicketSyncService(deps);
