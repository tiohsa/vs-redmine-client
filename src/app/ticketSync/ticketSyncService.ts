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
  planOfflineSyncEffectAsync,
  transitionOfflineSyncEffectAsync,
} from "../../views/offlineSyncStore";
import {
  compareAndRewriteDocumentWithRegisteredFields,
  type RewriteDocumentDeps,
} from "../../views/editorDocumentRewrite";
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
import {
  createSyncCoordinator,
  SyncCoordinator,
} from "./syncCoordinator";
import {
  TicketCreateHandler,
  TicketUpdateHandler,
} from "./operationHandlers";
import { parseTicketEditorContent } from "../../views/ticketEditorContent";
import type { TicketCreateIntent } from "./syncOperationTypes";

const defaultJournal: SyncJournal = {
  planEffect: planOfflineSyncEffectAsync,
  transitionEffect: transitionOfflineSyncEffectAsync,
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

const childEffectsRequireRecovery = (
  effects: OfflineNewTicket["effects"] | OfflineTicketUpdate["effects"],
  operationFailed: boolean,
): boolean => (effects ?? []).some((effect) =>
  effect.kind === "child_create" && (
    effect.state === "commit_unknown" ||
    effect.state === "compensation_started" ||
    effect.state === "compensation_unknown" ||
    (operationFailed && effect.state === "committed")
  )
);

const defaultDocumentPort = (rewriteDeps: RewriteDocumentDeps = {}): DocumentPort => ({
  rewriteNewTicket: ({ documentUri, ticketId, projectId, replacement, expected }) =>
    compareAndRewriteDocumentWithRegisteredFields({
      documentUri,
      ticketId,
      deps: rewriteDeps,
      projectId,
      replacement,
      expected,
    }),
  rewriteTicket: ({ documentUri, ticketId, projectId, replacement, expected }) =>
    compareAndRewriteDocumentWithRegisteredFields({
      documentUri,
      ticketId,
      deps: rewriteDeps,
      projectId,
      replacement,
      expected,
    }),
  findOpenDocument: (uri) =>
    (rewriteDeps.textDocuments ?? vscode.workspace.textDocuments).find((document) => document.uri.toString() === uri),
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
  private readonly coordinator: SyncCoordinator;
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
    this.coordinator = createSyncCoordinator({
      handlers: {
        ticketCreate: new TicketCreateHandler(),
        ticketUpdate: new TicketUpdateHandler(),
      },
    });
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
    uploads?: any[];
    attachments?: any[];
  }): Promise<TicketSyncOutcome> {
    if (input.newTicket) {
      if (input.manual) {
        const queued = await queueNewTicketDraft({
          editor: input.editor,
          operationScope: input.context.connectionScope,
        });
        return this.preparationOutcome(queued, input.ticketId);
      }
      const rawAttachments = input.attachments ?? input.uploads ?? [];
      const attachments = rawAttachments.map((a: any) => {
        if (a.token) {
          return { kind: "token" as const, token: a.token, filename: a.filename, contentType: a.contentType ?? a.content_type };
        }
        if (a.filePath || a.fsPath) {
          return { kind: "file" as const, filePath: a.filePath ?? a.fsPath, filename: a.filename, contentType: a.contentType };
        }
        return { kind: "clipboard" as const, filename: a.filename, contentType: a.contentType };
      });
      const parsed = parseTicketEditorContent(input.editor.document.getText(), {
        allowMissingMetadata: true,
        fallbackMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
      });
      const projectId = input.projectId ?? parsed.controlFields?.project_id ?? getProjectIdForEditor(input.editor) ?? 0;
      const intent: TicketCreateIntent = {
        projectId,
        subject: parsed.subject,
        description: parsed.description,
        metadata: parsed.metadata,
        layout: parsed.layout,
        metadataBlock: parsed.metadataBlock,
        controlFields: parsed.controlFields,
        baseDir: resolveEditorBaseDir({ editor: input.editor }),
        documentUri: input.editor.document.uri.toString(),
        attachments: attachments.length > 0 ? attachments : undefined,
      };

      const repo = this.coordinator.getRepository();
      const docUri = input.editor.document.uri.toString();
      const queueId = `editor:${docUri}`;
      const existing = repo.getOperation({ kind: "newTicket", documentUri: docUri }, input.context.connectionScope);

      if (!existing) {
        await repo.saveOperation({
          operationId: `${input.context.connectionScope}:newTicket:${queueId}`,
          kind: "ticket_create",
          key: { kind: "newTicket", queueId, documentUri: docUri },
          connectionScope: input.context.connectionScope,
          phase: "queued",
          revision: 1,
          intentRevision: 1,
          version: 1,
          persistenceVersion: 1,
          projectId,
          documentUri: docUri,
          intent,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }, input.context.connectionScope);
      }

      const syncKey = existing?.key ?? { kind: "newTicket", queueId, documentUri: docUri };
      const outcome = await this.coordinator.sync(
        syncKey,
        input.context,
        {
          deps: {
            ticketCreate: this.createDeps,
            documents: this.documents,
          },
        },
      );
      return outcome as TicketSyncOutcome;
    }

    const prepared = await queueTicketDraft({
      ticketId: input.ticketId,
      content: input.editor.document.getText(),
      editor: input.editor,
      operationScope: input.context.connectionScope,
      queueUnchanged: !input.manual,
    });
    if (prepared.status === "no_change") {
      const op = this.journal.getTicketUpdate(input.ticketId, input.context.connectionScope) ?? {
        ticketId: input.ticketId,
        baseSubject: "",
        baseDescription: "",
        baseMetadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
        subject: "",
        description: "",
        metadata: { tracker: "", priority: "", status: "", due_date: "", children: [] },
        connectionScope: input.context.connectionScope,
        phase: "queued" as const,
        revision: 1,
        documentUri: input.editor.document.uri.toString(),
      };
      await this.ticketReconciler.reconcile({
        context: input.context,
        operation: op,
        deps: this.updateDeps,
        remoteCommitted: false,
        noChange: true,
        completionResult: prepared,
      });
      return { kind: "no_change", ticketId: input.ticketId, saveResult: prepared };
    }
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

    const operationId = input.operation.operationId ?? input.operation.queueId;
    const newTicketEffects = input.operation.effects ?? [];
    const newTicketChildFailed = newTicketEffects.some((effect) =>
      effect.kind === "child_create" && effect.state === "failed"
    );
    const newTicketRemoteEffectCommitted = newTicketEffects.some((effect) =>
      (effect.kind === "ticket_create" || effect.kind === "child_create") &&
      effect.state === "committed"
    );
    if (input.operation.createdIssueId !== undefined && (
      newTicketEffects.some((effect) =>
        effect.kind === "child_create" && (
          effect.state === "commit_unknown" ||
          effect.state === "compensation_started" ||
          effect.state === "compensation_unknown"
        )
      ) || (newTicketChildFailed && newTicketRemoteEffectCommitted)
    )) {
      return {
        kind: "remote_committed",
        ticketId: input.operation.createdIssueId,
        pending: "remote_reconcile",
        message: "Created ticket compensation requires explicit recovery.",
      };
    }
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
        afterParentCreate: async (createdTicketId) => {
          const durable = await this.journal.transitionNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            { kind: "record_remote_created", ticketId: createdTicketId },
            input.context.connectionScope,
            newTicketExpectation(operation, "remote_write_started"),
          );
          if (!durable) {
            throw new Error("Created ticket could not be recorded in the sync journal.");
          }
          operation = durable;
          ticketId = createdTicketId;
        },
        existingChildId: ({ ordinal }) => operation.effects?.find((effect) =>
          effect.kind === "child_create" &&
          effect.target.ordinal === ordinal &&
          effect.state === "committed"
        )?.remoteId,
        beforeChildCreate: async ({ ordinal }) => {
          const effectId = `child-create:${ordinal}`;
          const planned = await this.journal.planEffect(
            operationId,
            {
              effectId,
              kind: "child_create",
              operationRevision: operation.revision!,
              state: "planned",
              target: { parentTicketId: ticketId, ordinal },
            },
            input.context.connectionScope,
            operation.revision!,
          );
          if (!planned) {
            throw new Error("Child create effect could not be planned.");
          }
          const started = await this.journal.transitionEffect(
            operationId,
            effectId,
            { kind: "start" },
            input.context.connectionScope,
            { operationRevision: operation.revision!, sourceState: "planned" },
          );
          if (!started) {
            throw new Error("Child create effect could not be started.");
          }
          operation = this.journal.getNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            input.context.connectionScope,
          ) ?? operation;
        },
        afterChildCreate: async ({ ordinal, childId }) => {
          const committed = await this.journal.transitionEffect(
            operationId,
            `child-create:${ordinal}`,
            { kind: "commit", remoteId: childId },
            input.context.connectionScope,
            { operationRevision: operation.revision!, sourceState: "started" },
          );
          if (!committed) {
            throw new Error("Child create effect could not be committed.");
          }
          operation = this.journal.getNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            input.context.connectionScope,
          ) ?? operation;
        },
        afterChildCreateFailure: async ({ ordinal, error, commitUnknown }) => {
          const failed = await this.journal.transitionEffect(
            operationId,
            `child-create:${ordinal}`,
            commitUnknown
              ? {
                kind: "mark_commit_unknown",
                detail: error instanceof Error ? error.message : "Child create result is unknown.",
              }
              : {
                kind: "mark_failed",
                detail: error instanceof Error ? error.message : "Child create failed.",
              },
            input.context.connectionScope,
            { operationRevision: operation.revision!, sourceState: "started" },
          );
          if (!failed) {
            throw new Error("Child create result could not be recorded.");
          }
          operation = this.journal.getNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            input.context.connectionScope,
          ) ?? operation;
          if (!commitUnknown) { return; }
          const pending = await this.journal.transitionNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            { kind: "mark_compensation_pending" },
            input.context.connectionScope,
            newTicketExpectation(operation, operation.phase!),
          );
          if (!pending) {
            throw new Error("Child recovery phase could not be recorded.");
          }
          operation = pending;
        },
        beforeChildCompensation: async ({ ordinal }) => {
          const compensating = await this.journal.transitionEffect(
            operationId,
            `child-create:${ordinal}`,
            { kind: "start_compensation" },
            input.context.connectionScope,
            { operationRevision: operation.revision!, sourceState: "committed" },
          );
          if (!compensating) {
            throw new Error("Child compensation could not be started.");
          }
          operation = this.journal.getNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            input.context.connectionScope,
          ) ?? operation;
        },
        afterChildCompensation: async ({ ordinal, error }) => {
          const compensated = await this.journal.transitionEffect(
            operationId,
            `child-create:${ordinal}`,
            error
              ? { kind: "mark_compensation_unknown", detail: error instanceof Error
                ? error.message
                : "Child compensation failed." }
              : { kind: "complete_compensation" },
            input.context.connectionScope,
            { operationRevision: operation.revision!, sourceState: "compensation_started" },
          );
          if (!compensated) {
            throw new Error("Child compensation result could not be recorded.");
          }
          operation = this.journal.getNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            input.context.connectionScope,
          ) ?? operation;
          if (error) {
            const pending = await this.journal.transitionNewTicket(
              { queueId: operation.queueId, documentUri: operation.documentUri },
              { kind: "mark_compensation_pending" },
              input.context.connectionScope,
              newTicketExpectation(operation, operation.phase!),
            );
            if (!pending) {
              throw new Error("Compensation pending phase could not be recorded.");
            }
            operation = pending;
          }
        },
        beforeParentCompensation: async () => {
          const compensating = await this.journal.transitionEffect(
            operationId,
            "ticket-create",
            { kind: "start_compensation" },
            input.context.connectionScope,
            { operationRevision: operation.revision!, sourceState: "committed" },
          );
          if (!compensating) {
            throw new Error("Parent compensation could not be started.");
          }
          operation = this.journal.getNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            input.context.connectionScope,
          ) ?? operation;
        },
        afterParentCompensation: async ({ error }) => {
          const compensated = await this.journal.transitionEffect(
            operationId,
            "ticket-create",
            error
              ? { kind: "mark_compensation_unknown", detail: error instanceof Error
                ? error.message
                : "Parent compensation failed." }
              : { kind: "complete_compensation" },
            input.context.connectionScope,
            { operationRevision: operation.revision!, sourceState: "compensation_started" },
          );
          if (!compensated) {
            throw new Error("Parent compensation result could not be recorded.");
          }
          operation = this.journal.getNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            input.context.connectionScope,
          ) ?? operation;
          if (error && operation.phase === "remote_created") {
            const pending = await this.journal.transitionNewTicket(
              { queueId: operation.queueId, documentUri: operation.documentUri },
              { kind: "mark_compensation_pending" },
              input.context.connectionScope,
              newTicketExpectation(operation, "remote_created"),
            );
            if (!pending) {
              throw new Error("Compensation pending phase could not be recorded.");
            }
            operation = pending;
          }
        },
        afterCompensationComplete: async () => {
          const reset = await this.journal.transitionNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            { kind: "complete_compensation" },
            input.context.connectionScope,
            newTicketExpectation(operation, "remote_created"),
          );
          if (!reset) { throw new Error("Completed compensation could not be recorded."); }
          operation = reset;
          ticketId = undefined;
        },
      });
      if (created.remoteCommitUnknown) {
        try {
          const currentInQueue = this.journal.getNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            input.context.connectionScope,
          ) ?? operation;
          await this.journal.transitionNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            { kind: "mark_commit_unknown" },
            input.context.connectionScope,
            newTicketExpectation(currentInQueue, "remote_write_started"),
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
      if (childEffectsRequireRecovery(
        operation.effects,
        created.result.status !== "created",
      )) {
        return {
          kind: "remote_committed",
          ticketId,
          pending: "remote_reconcile",
          message: "Created ticket compensation requires explicit recovery.",
        };
      }
      if (operation.phase !== "remote_created") {
        return {
          kind: "remote_committed",
          ticketId,
          pending: "local_finalize",
          message: "Created issue could not be recorded in the sync journal.",
        };
      }
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
    const outcome = await this.coordinator.sync(
      key as any,
      context,
      {
        deps: {
          ticketCreate: this.createDeps,
          ticketUpdate: this.updateDeps,
          documents: this.documents,
        },
      },
    );
    return outcome as TicketSyncOutcome;
  }

  public resolveCommitUnknown(input: {
    key: TicketSyncQueueKey;
    context: SyncContext;
    resolution:
      | { kind: "link_created_ticket"; ticketId: number }
      | { kind: "link_remote_ticket"; ticketId: number }
      | { kind: "assume_update_committed" }
      | { kind: "retry_remote_write" }
      | { kind: "reconcile_remote" };
  }): Promise<TicketSyncOutcome> {
    const resolution: any = input.resolution.kind === "link_created_ticket"
      ? { kind: "link_remote_ticket", ticketId: input.resolution.ticketId }
      : (input.resolution.kind === "assume_update_committed"
        ? { kind: "reconcile_remote" }
        : input.resolution);
    return this.coordinator.resolveCommitUnknown({
      key: input.key as any,
      context: input.context,
      resolution,
      deps: {
        ticketCreate: this.createDeps,
        ticketUpdate: this.updateDeps,
        documents: this.documents,
      },
    }) as Promise<TicketSyncOutcome>;
  }


  private async retryNewTicketRemoteWrite(
    context: SyncContext,
    initialOperation: OfflineNewTicket,
  ): Promise<TicketSyncOutcome> {
    let operation = initialOperation;
    const operationId = operation.operationId ?? operation.queueId;
    let ticketId = operation.createdIssueId;
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
      afterParentCreate: async (createdTicketId) => {
        const durable = await this.journal.transitionNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          { kind: "record_remote_created", ticketId: createdTicketId },
          context.connectionScope,
          newTicketExpectation(operation, "remote_write_started"),
        );
        if (!durable) {
          throw new Error("Created ticket could not be recorded in the sync journal.");
        }
        operation = durable;
        ticketId = createdTicketId;
      },
      existingChildId: ({ ordinal }) => operation.effects?.find((effect) =>
        effect.kind === "child_create" &&
        effect.target.ordinal === ordinal &&
        effect.state === "committed"
      )?.remoteId,
      beforeChildCreate: async ({ ordinal }) => {
        const effectId = `child-create:${ordinal}`;
        const planned = await this.journal.planEffect(
          operationId,
          {
            effectId,
            kind: "child_create",
            operationRevision: operation.revision!,
            state: "planned",
            target: { parentTicketId: ticketId, ordinal },
          },
          context.connectionScope,
          operation.revision!,
        );
        if (!planned) { throw new Error("Child create effect could not be planned."); }
        const started = await this.journal.transitionEffect(
          operationId,
          effectId,
          { kind: "start" },
          context.connectionScope,
          { operationRevision: operation.revision!, sourceState: "planned" },
        );
        if (!started) { throw new Error("Child create effect could not be started."); }
        operation = this.journal.getNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          context.connectionScope,
        ) ?? operation;
      },
      afterChildCreate: async ({ ordinal, childId }) => {
        const committed = await this.journal.transitionEffect(
          operationId,
          `child-create:${ordinal}`,
          { kind: "commit", remoteId: childId },
          context.connectionScope,
          { operationRevision: operation.revision!, sourceState: "started" },
        );
        if (!committed) { throw new Error("Child create effect could not be committed."); }
        operation = this.journal.getNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          context.connectionScope,
        ) ?? operation;
      },
      afterChildCreateFailure: async ({ ordinal, error, commitUnknown }) => {
        const failed = await this.journal.transitionEffect(
          operationId,
          `child-create:${ordinal}`,
          commitUnknown
            ? {
              kind: "mark_commit_unknown",
              detail: error instanceof Error ? error.message : "Child create result is unknown.",
            }
            : {
              kind: "mark_failed",
              detail: error instanceof Error ? error.message : "Child create failed.",
            },
          context.connectionScope,
          { operationRevision: operation.revision!, sourceState: "started" },
        );
        if (!failed) { throw new Error("Child create result could not be recorded."); }
        operation = this.journal.getNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          context.connectionScope,
        ) ?? operation;
        if (!commitUnknown) { return; }
        const pending = await this.journal.transitionNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          { kind: "mark_compensation_pending" },
          context.connectionScope,
          newTicketExpectation(operation, operation.phase!),
        );
        if (!pending) { throw new Error("Child recovery phase could not be recorded."); }
        operation = pending;
      },
      beforeChildCompensation: async ({ ordinal }) => {
        const compensating = await this.journal.transitionEffect(
          operationId,
          `child-create:${ordinal}`,
          { kind: "start_compensation" },
          context.connectionScope,
          { operationRevision: operation.revision!, sourceState: "committed" },
        );
        if (!compensating) { throw new Error("Child compensation could not be started."); }
        operation = this.journal.getNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          context.connectionScope,
        ) ?? operation;
      },
      afterChildCompensation: async ({ ordinal, error }) => {
        const compensated = await this.journal.transitionEffect(
          operationId,
          `child-create:${ordinal}`,
          error
            ? { kind: "mark_compensation_unknown", detail: error instanceof Error
              ? error.message
              : "Child compensation failed." }
            : { kind: "complete_compensation" },
          context.connectionScope,
          { operationRevision: operation.revision!, sourceState: "compensation_started" },
        );
        if (!compensated) { throw new Error("Child compensation result could not be recorded."); }
        operation = this.journal.getNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          context.connectionScope,
        ) ?? operation;
        if (error) {
          const pending = await this.journal.transitionNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            { kind: "mark_compensation_pending" },
            context.connectionScope,
            newTicketExpectation(operation, operation.phase!),
          );
          if (!pending) { throw new Error("Compensation pending phase could not be recorded."); }
          operation = pending;
        }
      },
      beforeParentCompensation: async () => {
        const compensating = await this.journal.transitionEffect(
          operationId,
          "ticket-create",
          { kind: "start_compensation" },
          context.connectionScope,
          { operationRevision: operation.revision!, sourceState: "committed" },
        );
        if (!compensating) { throw new Error("Parent compensation could not be started."); }
        operation = this.journal.getNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          context.connectionScope,
        ) ?? operation;
      },
      afterParentCompensation: async ({ error }) => {
        const compensated = await this.journal.transitionEffect(
          operationId,
          "ticket-create",
          error
            ? { kind: "mark_compensation_unknown", detail: error instanceof Error
              ? error.message
              : "Parent compensation failed." }
            : { kind: "complete_compensation" },
          context.connectionScope,
          { operationRevision: operation.revision!, sourceState: "compensation_started" },
        );
        if (!compensated) { throw new Error("Parent compensation result could not be recorded."); }
        operation = this.journal.getNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          context.connectionScope,
        ) ?? operation;
        if (error && operation.phase === "remote_created") {
          const pending = await this.journal.transitionNewTicket(
            { queueId: operation.queueId, documentUri: operation.documentUri },
            { kind: "mark_compensation_pending" },
            context.connectionScope,
            newTicketExpectation(operation, "remote_created"),
          );
          if (!pending) { throw new Error("Compensation pending phase could not be recorded."); }
          operation = pending;
        }
      },
      afterCompensationComplete: async () => {
        const reset = await this.journal.transitionNewTicket(
          { queueId: operation.queueId, documentUri: operation.documentUri },
          { kind: "complete_compensation" },
          context.connectionScope,
          newTicketExpectation(operation, "remote_created"),
        );
        if (!reset) { throw new Error("Completed compensation could not be recorded."); }
        operation = reset;
        ticketId = undefined;
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
    if (operation.createdIssueId !== undefined && childEffectsRequireRecovery(
      operation.effects,
      created.result.status !== "created",
    )) {
      return {
        kind: "remote_committed",
        ticketId: operation.createdIssueId!,
        pending: "remote_reconcile",
        message: "Created ticket child recovery requires explicit resolution.",
      };
    }
    if (!created.createdId || created.result.status !== "created") {
      if (operation.phase === "queued" && !created.remoteIssueMayExist) {
        return {
          kind: "failed_before_commit",
          error: new Error(created.result.message),
          saveResult: created.result,
        };
      }
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
    ticketId = created.createdId;
    if (operation.phase !== "remote_created") {
      return {
        kind: "remote_committed",
        ticketId,
        pending: "local_finalize",
        message: "Created issue could not be recorded in the sync journal.",
      };
    }
    return this.newTicketFinalizer.finalize({
      context,
      operation,
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
    const updateEffects = operation.effects ?? [];
    const failedChildEffect = updateEffects.some((effect) =>
      effect.kind === "child_create" && effect.state === "failed"
    );
    const committedChildEffect = updateEffects.some((effect) =>
      effect.kind === "child_create" && effect.state === "committed"
    );
    if (
      updateEffects.some((effect) =>
        effect.kind === "child_create" && (
          effect.state === "commit_unknown" ||
          effect.state === "compensation_started" ||
          effect.state === "compensation_unknown"
        )
      ) || (failedChildEffect && committedChildEffect)
    ) {
      return {
        kind: "remote_committed",
        ticketId: operation.ticketId,
        pending: "remote_reconcile",
        message: "Child ticket compensation requires explicit recovery.",
      };
    }
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
      existingChildId: ({ ordinal }) => operation.effects?.find((effect) =>
        effect.kind === "child_create" &&
        effect.target.ordinal === ordinal &&
        effect.state === "committed"
      )?.remoteId,
      beforeChildCreate: async ({ ordinal }) => {
        const effectId = `child-create:${ordinal}`;
        const planned = await this.journal.planEffect(
          operationId,
          {
            effectId,
            kind: "child_create",
            operationRevision: operation.revision!,
            state: "planned",
            target: { parentTicketId: operation.ticketId, ordinal },
          },
          context.connectionScope,
          operation.revision!,
        );
        if (!planned) { throw new Error("Child create effect could not be planned."); }
        const started = await this.journal.transitionEffect(
          operationId,
          effectId,
          { kind: "start" },
          context.connectionScope,
          { operationRevision: operation.revision!, sourceState: "planned" },
        );
        if (!started) { throw new Error("Child create effect could not be started."); }
        operation = getOfflineSyncQueue(context.connectionScope).tickets.get(
          operation.ticketId,
        ) ?? operation;
      },
      afterChildCreate: async ({ ordinal, childId }) => {
        const committed = await this.journal.transitionEffect(
          operationId,
          `child-create:${ordinal}`,
          { kind: "commit", remoteId: childId },
          context.connectionScope,
          { operationRevision: operation.revision!, sourceState: "started" },
        );
        if (!committed) { throw new Error("Child create effect could not be committed."); }
        operation = getOfflineSyncQueue(context.connectionScope).tickets.get(
          operation.ticketId,
        ) ?? operation;
      },
      afterChildCreateFailure: async ({ ordinal, error, commitUnknown }) => {
        const failed = await this.journal.transitionEffect(
          operationId,
          `child-create:${ordinal}`,
          commitUnknown
            ? {
              kind: "mark_commit_unknown",
              detail: error instanceof Error ? error.message : "Child create result is unknown.",
            }
            : {
              kind: "mark_failed",
              detail: error instanceof Error ? error.message : "Child create failed.",
            },
          context.connectionScope,
          { operationRevision: operation.revision!, sourceState: "started" },
        );
        if (!failed) {
          throw new Error("Child create result could not be recorded.");
        }
        operation = getOfflineSyncQueue(context.connectionScope).tickets.get(
          operation.ticketId,
        ) ?? operation;
        if (!commitUnknown) { return; }
        const pending = await this.journal.transitionTicketUpdate(
          operation.ticketId,
          { kind: "mark_compensation_pending" },
          context.connectionScope,
          ticketUpdateExpectation(operation, operation.phase!),
        );
        if (!pending) {
          throw new Error("Child recovery phase could not be recorded.");
        }
        operation = pending;
      },
      beforeChildCompensation: async ({ ordinal }) => {
        const compensating = await this.journal.transitionEffect(
          operationId,
          `child-create:${ordinal}`,
          { kind: "start_compensation" },
          context.connectionScope,
          { operationRevision: operation.revision!, sourceState: "committed" },
        );
        if (!compensating) {
          throw new Error("Child compensation could not be started.");
        }
        operation = getOfflineSyncQueue(context.connectionScope).tickets.get(
          operation.ticketId,
        ) ?? operation;
      },
      afterChildCompensation: async ({ ordinal, error }) => {
        const compensated = await this.journal.transitionEffect(
          operationId,
          `child-create:${ordinal}`,
          error
            ? { kind: "mark_compensation_unknown", detail: error instanceof Error
              ? error.message
              : "Child compensation failed." }
            : { kind: "complete_compensation" },
          context.connectionScope,
          { operationRevision: operation.revision!, sourceState: "compensation_started" },
        );
        if (!compensated) {
          throw new Error("Child compensation result could not be recorded.");
        }
        operation = getOfflineSyncQueue(context.connectionScope).tickets.get(
          operation.ticketId,
        ) ?? operation;
        if (error) {
          const pending = await this.journal.transitionTicketUpdate(
            operation.ticketId,
            { kind: "mark_compensation_pending" },
            context.connectionScope,
            ticketUpdateExpectation(operation, operation.phase!),
          );
          if (!pending) { throw new Error("Compensation pending phase could not be recorded."); }
          operation = pending;
        }
      },
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
      if (operation.phase === "reconciliation_pending") {
        return {
          kind: "remote_committed",
          ticketId: operation.ticketId,
          pending: "remote_reconcile",
          message: "A child ticket create result is unknown. Automatic retry is disabled.",
        };
      }
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
    const beforeCleanup = getOfflineSyncQueue(context.connectionScope).tickets.get(
      operation.ticketId,
    ) ?? operation;
    if (childEffectsRequireRecovery(beforeCleanup.effects, true)) {
      return {
        kind: "remote_committed",
        ticketId: operation.ticketId,
        pending: "remote_reconcile",
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
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      if (options.shouldContinue && !options.shouldContinue()) {
        return {
          plan: keys,
          results,
          remaining: keys.slice(index),
          cancelled: true,
        };
      }
      results.push({ key, outcome: await this.syncQueueItem(key, context) });
    }
    return { plan: keys, results, remaining: [], cancelled: false };
  }
}

export const createTicketSyncService = (
  deps: TicketSyncServiceDependencies = {},
): TicketSyncService => new TicketSyncService(deps);
