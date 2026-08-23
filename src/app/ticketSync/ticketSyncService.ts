import * as vscode from "vscode";
import type {
  OfflineNewTicket,
} from "../../views/offlineSyncStore";
import {
  addOfflineNewTicketAsync,
  completeOfflineTicketUpdateAsync,
  getOfflineSyncQueue,
} from "../../views/offlineSyncStore";
import {
  compareAndRewriteDocumentWithRegisteredFields,
  type RewriteDocumentDeps,
} from "../../views/editorDocumentRewrite";
import {
  queueNewTicketDraft,
  queueTicketDraft,
} from "../../views/ticketSync/ticketQueueSync";
import { defaultCreateDeps, defaultDeps } from "../../views/ticketSync/ticketSyncDeps";
import type { TicketCreateDependencies, TicketSaveDependencies } from "../../views/ticketSync/types";
import type { DocumentPort, SyncContext } from "./ports";
import type { NewTicketLocalStatePort } from "./ports";
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
import { editorContentFromTicket } from "../../views/ticketSync/ticketRemoteContent";
import type { TicketCreateIntent } from "./syncOperationTypes";

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
  register: (input: any, ...args: any[]) => {
    let ticketId: number;
    let documentUri: string | undefined;
    let projectId: number | undefined;
    let connectionScope: string = "";

    if (typeof input === "number") {
      ticketId = input;
      if (typeof args[0] === "string") {
        documentUri = args[0];
        projectId = typeof args[1] === "number" ? args[1] : undefined;
        connectionScope = typeof args[2] === "string" ? args[2] : "";
      } else if (args[0] && typeof args[0] === "object" && "uri" in args[0]) {
        documentUri = args[0].uri.toString();
        projectId = typeof args[1] === "number" ? args[1] : undefined;
        connectionScope = typeof args[2] === "string" ? args[2] : "";
      }
    } else if (input && typeof input === "object") {
      ticketId = input.ticketId;
      documentUri = input.documentUri;
      projectId = input.projectId;
      connectionScope = input.connectionScope ?? "";
    } else {
      return;
    }

    if (!documentUri) {
      return;
    }
    removeTicketEditorByUri(vscode.Uri.parse(documentUri));
    const document = documents.findOpenDocument(documentUri);
    if (document) {
      registerTicketDocument(
        ticketId,
        document,
        "ticket",
        projectId,
        connectionScope,
      );
    }
  },
    updateDraft: (input: any, ...args: any[]) => {
      if (typeof input === "number") {
        const firstArg = args[0];
        if (firstArg && typeof firstArg === "object" && ("baseMetadata" in firstArg || "canonical" in firstArg || "metadata" in firstArg || "baseSubject" in firstArg)) {
          const canonical = firstArg.canonical ?? firstArg;
          const subject = canonical.baseSubject ?? canonical.subject ?? "";
          const description = canonical.baseDescription ?? canonical.description ?? "";
          const metadata = canonical.baseMetadata ?? canonical.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] };
          const remoteUpdatedAt = firstArg.remoteUpdatedAt ?? args[1];
          const connectionScope = typeof args[1] === "string" ? args[1] : (firstArg.connectionScope ?? args[2]);
          updateDraftAfterSave(input, subject, description, metadata, remoteUpdatedAt, connectionScope);
        } else {
          const [subject, description, metadata, remoteUpdatedAt, connectionScope] = args;
          updateDraftAfterSave(
            input,
            subject ?? "",
            description ?? "",
            metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
            remoteUpdatedAt,
            connectionScope,
          );
        }
      } else {
        updateDraftAfterSave(
          input.ticketId,
          input.canonical?.subject ?? input.subject ?? "",
          input.canonical?.description ?? input.description ?? "",
          input.canonical?.metadata ?? input.metadata ?? { tracker: "", priority: "", status: "", due_date: "", children: [] },
          input.remoteUpdatedAt,
          input.connectionScope,
        );
      }
    },
});

export class TicketSyncQueueItemNotFoundError extends Error {
  public constructor(key: TicketSyncQueueKey) {
    super(key.kind === "ticket"
      ? `Queue entry for ticket #${key.ticketId} was not found.`
      : "Queue entry for the new ticket was not found.");
    this.name = "TicketSyncQueueItemNotFoundError";
  }
}

export interface TicketSyncServiceDependencies {
  documents?: DocumentPort;
  create?: Partial<TicketCreateDependencies>;
  update?: Partial<TicketSaveDependencies>;
  rewrite?: RewriteDocumentDeps;
  newTicketLocalState?: NewTicketLocalStatePort;
  coordinator?: SyncCoordinator;
  runInConnectionScope?: <T>(
    connectionScope: string,
    operation: () => Promise<T>,
  ) => Promise<T>;
}

export class TicketSyncService {
  private readonly documents: DocumentPort;
  private readonly createDeps: TicketCreateDependencies;
  private readonly updateDeps: TicketSaveDependencies;
  private readonly newTicketLocalState?: NewTicketLocalStatePort;
  private readonly coordinator: SyncCoordinator;
  private readonly runInConnectionScope: NonNullable<
    TicketSyncServiceDependencies["runInConnectionScope"]
  >;

  public constructor(deps: TicketSyncServiceDependencies = {}) {
    this.documents = deps.documents ?? defaultDocumentPort(deps.rewrite);
    this.createDeps = { ...defaultCreateDeps, ...deps.create };
    this.updateDeps = { ...defaultDeps, ...deps.update };
    this.newTicketLocalState = deps.newTicketLocalState ?? defaultNewTicketLocalState(this.documents);
    this.runInConnectionScope = deps.runInConnectionScope ?? runWithConnectionScope;
    this.coordinator = deps.coordinator ?? createSyncCoordinator({
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
    if (input.operation.connectionScope && input.operation.connectionScope !== input.context.connectionScope) {
      return {
        kind: "failed_before_commit",
        error: new Error(`Operation connection scope ${input.operation.connectionScope} does not match context ${input.context.connectionScope}`),
      };
    }

    let operation: OfflineNewTicket;
    try {
      operation = await addOfflineNewTicketAsync(
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
    const outcome = await this.coordinator.sync(
      { kind: "newTicket", queueId: operation.queueId, documentUri: operation.documentUri },
      input.context,
      {
        deps: {
          ticketCreate: this.createDeps,
          ticketUpdate: this.updateDeps,
          documents: this.documents,
          localState: this.newTicketLocalState,
        },
        runInConnectionScope: this.runInConnectionScope,
      },
    );
    return outcome as TicketSyncOutcome;
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
            localState: this.newTicketLocalState,
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
      if (!input.manual && this.documents.rewriteTicket) {
        try {
          const detail = await this.updateDeps.getIssueDetail(input.ticketId);
          const canonical = editorContentFromTicket((detail as any).ticket ?? detail);
          await this.documents.rewriteTicket({
            documentUri: input.editor.document.uri.toString(),
            ticketId: input.ticketId,
            projectId: (detail as any).ticket?.projectId ?? (detail as any).projectId ?? 0,
            replacement: canonical,
            expected: {
              content: input.editor.document.getText(),
              operationRevision: 1,
            },
          });
        } catch {
          // ignore read-back failure on no_change
        }
      }
      try {
        await completeOfflineTicketUpdateAsync(input.ticketId, input.context.connectionScope);
      } catch {
        // ignore completion failure on no_change
      }
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
          localState: this.newTicketLocalState,
        },
        runInConnectionScope: this.runInConnectionScope,
      },
    );
    return outcome as TicketSyncOutcome;
  }

  public resolveCommitUnknown(input: {
    key: TicketSyncQueueKey;
    context: SyncContext;
    attemptGeneration?: number;
    resolution:
      | { kind: "link_created_ticket"; ticketId: number }
      | { kind: "link_remote_ticket"; ticketId: number }
      | { kind: "assume_update_committed" }
      | { kind: "retry_remote_write" }
      | { kind: "reconcile_remote" }
      | { kind: "reconcile_compensation" };
  }): Promise<TicketSyncOutcome> {
    const resolution: any = input.resolution.kind === "link_created_ticket"
      ? { kind: "link_remote_ticket", ticketId: input.resolution.ticketId, explicitLink: true }
      : (input.resolution.kind === "assume_update_committed"
        ? { kind: "assume_remote_commit" }
        : input.resolution);
    return this.coordinator.resolveCommitUnknown({
      key: input.key as any,
      context: input.context,
      attemptGeneration: input.attemptGeneration,
      resolution,
      deps: {
        ticketCreate: this.createDeps,
        ticketUpdate: this.updateDeps,
        documents: this.documents,
        localState: this.newTicketLocalState,
      },
      runInConnectionScope: this.runInConnectionScope,
    } as any) as Promise<TicketSyncOutcome>;
  }

  public async syncAll(
    context: SyncContext,
    options: { shouldContinue?: () => boolean } = {},
  ): Promise<SyncAllOutcome> {
    const outcome = await this.coordinator.syncAll(context, {
      shouldContinue: options.shouldContinue,
      deps: {
        ticketCreate: this.createDeps,
        ticketUpdate: this.updateDeps,
        documents: this.documents,
        localState: this.newTicketLocalState,
      },
    });
    return {
      plan: outcome.plan as TicketSyncQueueKey[],
      results: outcome.results as any,
      remaining: outcome.remaining as TicketSyncQueueKey[],
      cancelled: outcome.cancelled,
    };
  }
}

export const createTicketSyncService = (
  deps: TicketSyncServiceDependencies = {},
): TicketSyncService => new TicketSyncService(deps);
