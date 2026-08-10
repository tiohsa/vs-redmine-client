import * as vscode from "vscode";
import type { OfflineNewTicket, OfflineTicketUpdate } from "../../views/offlineSyncStore";
import {
  addOfflineNewTicketAsync,
  removeOfflineNewTicketAsync,
  removeOfflineTicketUpdateAsync,
  updateOfflineNewTicketAsync,
  updateOfflineTicketUpdateAsync,
  getOfflineSyncQueue,
  getOfflineNewTicket,
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
  saveNewTicket: addOfflineNewTicketAsync,
  markNewTicket: updateOfflineNewTicketAsync,
  completeNewTicket: removeOfflineNewTicketAsync,
  markTicketUpdate: updateOfflineTicketUpdateAsync,
  completeTicketUpdate: removeOfflineTicketUpdateAsync,
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
    });
    if (input.manual || prepared.status !== "queued") {
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

    let ticketId = input.operation.createdIssueId;
    let operation = input.operation;
    if (!ticketId) {
      const created = await createTicketFromContent({
        content: operation.content,
        projectId: operation.projectId,
        baseDir: operation.baseDir,
        deps: this.createDeps,
      });
      if (
        !created.createdId ||
        (created.result.status !== "created" && !created.remoteIssueMayExist)
      ) {
        return {
          kind: "failed_before_commit",
          error: new Error(created.result.message),
          saveResult: created.result,
        };
      }
      ticketId = created.createdId;
      let durable;
      try {
        durable = await this.journal.markNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          { createdIssueId: ticketId, phase: "remote_created" },
          input.context.connectionScope,
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

  private async updateOrReconcile(
    context: SyncContext,
    operation: OfflineTicketUpdate,
  ): Promise<TicketSyncOutcome> {
    return this.runInConnectionScope(
      context.connectionScope,
      () => this.updateOrReconcileAtScope(context, operation),
    );
  }

  private async updateOrReconcileAtScope(
    context: SyncContext,
    operation: OfflineTicketUpdate,
  ): Promise<TicketSyncOutcome> {
    if (operation.connectionScope && operation.connectionScope !== context.connectionScope) {
      return {
        kind: "failed_before_commit",
        error: new Error("Connection scope mismatch."),
      };
    }
    const result = await applyQueuedTicketUpdate({
      operationScope: context.connectionScope,
      update: operation,
      deps: this.updateDeps,
      deferReconciliation: true,
    });
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
      return {
        kind: "conflict",
        ticketId: operation.ticketId,
        message: result.message,
        conflictContext: result.conflictContext,
      };
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
