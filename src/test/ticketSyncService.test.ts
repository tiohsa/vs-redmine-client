import * as assert from "assert";
import { TicketSyncService } from "../app/ticketSync";
import {
  addOfflineTicketUpdate,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createTestMemento } from "./helpers/vscodeMemento";

const SCOPE = "https://redmine.example/";
const DOCUMENT_URI = "file:///tmp/durable-new-ticket.md";

const content = buildTicketEditorContent({
  subject: "Durable ticket",
  description: "Body",
  metadata: buildIssueMetadataFixture(),
  controlFields: {
    mode: "new-ticket",
    issue_id: null,
    project_id: 12,
  },
});

const metadataDeps = {
  deleteIssue: async () => undefined,
  listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
  listTrackers: async () => [{ id: 2, name: "Task" }],
  listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
  searchUsers: async () => [],
  uploadFile: async () => ({ token: "t", filename: "f", contentType: "text/plain" }),
  getProjectTrackers: async () => [{ id: 2, name: "Task" }],
};

const issueDetail = (id: number) => ({
  ticket: {
    id,
    subject: "Canonical subject",
    description: "Canonical body",
    projectId: 12,
    trackerName: "Task",
    priorityName: "Normal",
    statusName: "Closed",
    updatedAt: "t2",
  },
  comments: [],
});

suite("TicketSyncService durable lifecycle", () => {
  test("create 成功後の rewrite 失敗で createdIssueId を保持し retry は POST しない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let createCalls = 0;
    let rewriteSucceeds = false;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          return 101;
        },
        getIssueDetail: async () => issueDetail(101),
      },
      documents: {
        rewriteNewTicket: async () => rewriteSucceeds,
        findOpenDocument: () => undefined,
      },
    });

    const first = await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });

    assert.strictEqual(first.kind, "remote_committed");
    assert.strictEqual(createCalls, 1);
    const pending = getOfflineSyncQueue(SCOPE).newTickets[0];
    assert.strictEqual(pending.createdIssueId, 101);
    assert.strictEqual(pending.phase, "local_finalize_pending");

    rewriteSucceeds = true;
    const retried = await service.syncQueueItem({
      context: { connectionScope: SCOPE },
      item: { kind: "newTicket", operation: pending },
    });

    assert.strictEqual(retried.kind, "completed");
    assert.strictEqual(createCalls, 1);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).newTickets.length, 0);
  });

  test("new ticket local finalize は Markdown → registry → draft の順で完了する", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const steps: string[] = [];
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => 150,
        getIssueDetail: async () => issueDetail(150),
      },
      documents: {
        rewriteNewTicket: async () => {
          steps.push("markdown");
          return true;
        },
        findOpenDocument: () => undefined,
      },
      newTicketLocalState: {
        register: () => {
          steps.push("registry");
        },
        updateDraft: () => {
          steps.push("draft");
        },
      },
    });

    const outcome = await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });

    assert.strictEqual(outcome.kind, "completed");
    assert.deepStrictEqual(steps, ["markdown", "registry", "draft"]);
  });

  test("process restart 後も createdIssueId を復元し POST せず finalize する", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
    let createCalls = 0;
    const firstService = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          return 202;
        },
        getIssueDetail: async () => issueDetail(202),
      },
      documents: {
        rewriteNewTicket: async () => false,
        findOpenDocument: () => undefined,
      },
    });
    await firstService.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });

    initializeOfflineSyncStore(memento, SCOPE);
    const restored = getOfflineSyncQueue(SCOPE).newTickets[0];
    const resumedService = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          return 999;
        },
        getIssueDetail: async () => issueDetail(202),
      },
      documents: {
        rewriteNewTicket: async () => true,
        findOpenDocument: () => undefined,
      },
    });
    const outcome = await resumedService.syncQueueItem({
      context: { connectionScope: SCOPE },
      item: { kind: "newTicket", operation: restored },
    });

    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(createCalls, 1);
  });

  test("Sync All は保存済み createdIssueId を使い POST しない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let createCalls = 0;
    let rewriteSucceeds = false;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          return 250;
        },
        getIssueDetail: async () => issueDetail(250),
      },
      documents: {
        rewriteNewTicket: async () => rewriteSucceeds,
        findOpenDocument: () => undefined,
      },
    });
    await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    const pending = getOfflineSyncQueue(SCOPE).newTickets[0];

    rewriteSucceeds = true;
    const outcomes = await service.syncAll({
      context: { connectionScope: SCOPE },
      newTickets: [pending],
      tickets: [],
    });

    assert.strictEqual(outcomes[0].kind, "completed");
    assert.strictEqual(createCalls, 1);
  });

  test("同一 operation の並行同期は single-flight で POST を1回にする", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let createCalls = 0;
    let releaseCreate: (() => void) | undefined;
    let markCreateStarted: (() => void) | undefined;
    const createStarted = new Promise<void>((resolve) => { markCreateStarted = resolve; });
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          markCreateStarted?.();
          await new Promise<void>((resolve) => { releaseCreate = resolve; });
          return 275;
        },
        getIssueDetail: async () => issueDetail(275),
      },
      documents: {
        rewriteNewTicket: async () => true,
        findOpenDocument: () => undefined,
      },
    });
    const input = {
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    };
    const first = service.syncNewTicket(input);
    const second = service.syncNewTicket(input);
    await createStarted;
    assert.strictEqual(createCalls, 1);
    releaseCreate?.();
    const outcomes = await Promise.all([first, second]);
    assert.deepStrictEqual(outcomes.map((outcome) => outcome.kind), ["completed", "completed"]);
    assert.strictEqual(createCalls, 1);
  });

  test("POST 成功後の GET 失敗は reconciliation_pending となり retry は GET のみ", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let createCalls = 0;
    let getCalls = 0;
    let getSucceeds = false;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          return 303;
        },
        getIssueDetail: async () => {
          getCalls++;
          if (!getSucceeds) {
            throw new Error("temporary read failure");
          }
          return issueDetail(303);
        },
      },
      documents: {
        rewriteNewTicket: async () => true,
        findOpenDocument: () => undefined,
      },
    });

    const first = await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    assert.strictEqual(first.kind, "remote_committed");
    const pending = getOfflineSyncQueue(SCOPE).newTickets[0];
    assert.strictEqual(pending.phase, "reconciliation_pending");
    assert.strictEqual(pending.remoteUpdatedAt, undefined);

    getSucceeds = true;
    const retried = await service.syncQueueItem({
      context: { connectionScope: SCOPE },
      item: { kind: "newTicket", operation: pending },
    });
    assert.strictEqual(retried.kind, "completed");
    assert.strictEqual(createCalls, 1);
    assert.strictEqual(getCalls, 2);
  });

  test("operation の connection scope と context が異なる場合は fail closed", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          throw new Error("must not create");
        },
      },
      documents: {
        rewriteNewTicket: async () => true,
        findOpenDocument: () => undefined,
      },
    });

    const outcome = await service.createOrResume({
      context: { connectionScope: "https://b.example/" },
      operation: {
        queueId: "q1",
        content,
        connectionScope: "https://a.example/",
      },
    });
    assert.strictEqual(outcome.kind, "failed_before_commit");
  });

  test("接続先Aで開始後に設定がBへ変わってもAの execution context で完了する", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let configuredScope = SCOPE;
    let executionScope: string | undefined;
    let observedExecutionScope: string | undefined;
    const service = new TicketSyncService({
      runInConnectionScope: async (scope, operation) => {
        executionScope = scope;
        try {
          return await operation();
        } finally {
          executionScope = undefined;
        }
      },
      create: {
        ...metadataDeps,
        createIssue: async () => {
          configuredScope = "https://b.example/";
          await Promise.resolve();
          observedExecutionScope = executionScope;
          return 390;
        },
        getIssueDetail: async () => issueDetail(390),
      },
      documents: {
        rewriteNewTicket: async () => true,
        findOpenDocument: () => undefined,
      },
    });

    const outcome = await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });

    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(configuredScope, "https://b.example/");
    assert.strictEqual(observedExecutionScope, SCOPE);
  });

  test("PUT 成功後の GET 失敗を保持し retry は PUT を再送しない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const ticketMetadata = buildIssueMetadataFixture();
    addOfflineTicketUpdate(404, {
      ticketId: 404,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: ticketMetadata,
      subject: "Title",
      description: "New",
      metadata: ticketMetadata,
      connectionScope: SCOPE,
      phase: "queued",
    }, SCOPE);
    let updateCalls = 0;
    let getCalls = 0;
    let getSucceeds = false;
    const service = new TicketSyncService({
      update: {
        updateIssue: async () => {
          updateCalls++;
        },
        getIssueDetail: async () => {
          getCalls++;
          if (!getSucceeds) {
            throw new Error("read-back failed");
          }
          return issueDetail(404);
        },
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
    });
    const queued = getOfflineSyncQueue(SCOPE).tickets.get(404)!;

    const first = await service.syncQueueItem({
      context: { connectionScope: SCOPE },
      item: { kind: "ticket", operation: queued },
    });
    assert.strictEqual(first.kind, "remote_committed");
    const pending = getOfflineSyncQueue(SCOPE).tickets.get(404)!;
    assert.strictEqual(pending.phase, "reconciliation_pending");
    assert.strictEqual(pending.remoteUpdatedAt, undefined);

    getSucceeds = true;
    const retried = await service.syncQueueItem({
      context: { connectionScope: SCOPE },
      item: { kind: "ticket", operation: pending },
    });
    assert.strictEqual(retried.kind, "completed");
    assert.strictEqual(updateCalls, 1);
    assert.strictEqual(getCalls, 2);
  });
});
