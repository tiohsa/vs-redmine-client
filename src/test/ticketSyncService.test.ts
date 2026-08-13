import * as assert from "assert";
import * as vscode from "vscode";
import { TicketSyncService } from "../app/ticketSync";
import {
  addOfflineNewTicketAsync,
  addOfflineNewTicket,
  addOfflineTicketUpdate,
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createTestMemento } from "./helpers/vscodeMemento";
import { syncUnsyncedFile } from "../commands/syncUnsyncedFile";
import { runOfflineSync } from "../commands/offlineSync";
import { getCurrentConnectionScope } from "../config/connectionScope";
import {
  initializeDraftStore,
  initializeTicketDraft,
} from "../views/ticketDraftStore";
import { createInMemoryDraftStorage } from "../views/draftPersistence";

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
  test("direct editor no_change も共通reconcilerでremote canonicalを反映する", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    initializeDraftStore(createInMemoryDraftStorage(), SCOPE);
    const metadata = buildIssueMetadataFixture();
    initializeTicketDraft(99, "Durable ticket", "Body", metadata, "t1", SCOPE);
    const document = {
      uri: vscode.Uri.parse("file:///tmp/no-change.md"),
      getText: () => content,
    } as unknown as vscode.TextDocument;
    const editor = { document } as vscode.TextEditor;
    let getCalls = 0;
    let rewrittenStatus: string | undefined;
    const service = new TicketSyncService({
      update: {
        getIssueDetail: async () => {
          getCalls++;
          return issueDetail(99);
        },
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        rewriteTicket: async ({ replacement }) => {
          rewrittenStatus = replacement.metadata.status;
          return { kind: "applied" };
        },
        findOpenDocument: () => undefined,
      },
    });

    const outcome = await service.syncEditor({
      context: { connectionScope: SCOPE },
      editor,
      ticketId: 99,
      newTicket: false,
      manual: false,
    });

    assert.strictEqual(outcome.kind, "no_change");
    assert.strictEqual(getCalls, 1);
    assert.strictEqual(rewrittenStatus, "Closed");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.size, 0);
  });

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
        rewriteNewTicket: async () => ({ kind: rewriteSucceeds ? "applied" : "write_failed" }),
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
    const retried = await service.syncQueueItem(
      { kind: "newTicket", documentUri: pending.documentUri },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(retried.kind, "completed");
    assert.strictEqual(createCalls, 1);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).newTickets.length, 0);
  });

  test("I-06/I-07 new-ticket preflight 中の後続保存は freeze 済み active revision を上書きしない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let releasePreflight: (() => void) | undefined;
    let preflightReached: (() => void) | undefined;
    let createCalls = 0;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        listIssueStatuses: async () => {
          preflightReached?.();
          await new Promise<void>((resolve) => { releasePreflight = resolve; });
          return [{ id: 1, name: "In Progress" }];
        },
        createIssue: async () => {
          createCalls++;
          return 111;
        },
        getIssueDetail: async () => issueDetail(111),
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "write_failed" }),
        findOpenDocument: () => undefined,
      },
    });
    const started = service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    await new Promise<void>((resolve) => { preflightReached = resolve; });

    const active = getOfflineSyncQueue(SCOPE).newTickets[0];
    assert.strictEqual(active.phase, "preparing");
    addOfflineNewTicket({
      content: content.replace("Durable ticket", "Later local edit"),
      projectId: 12,
      documentUri: DOCUMENT_URI,
    }, SCOPE);
    const frozen = getOfflineSyncQueue(SCOPE).newTickets[0];
    assert.strictEqual(frozen.content, content);
    assert.ok(frozen.nextIntent?.content.includes("Later local edit"));

    releasePreflight?.();
    await started;
    assert.strictEqual(createCalls, 1);
  });

  test("new-ticket preflight abort は後続保存を queued active へ昇格し POST しない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let releasePreflight: (() => void) | undefined;
    let preflightReached: (() => void) | undefined;
    let createCalls = 0;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        listIssueStatuses: async () => {
          preflightReached?.();
          await new Promise<void>((resolve) => { releasePreflight = resolve; });
          throw new Error("metadata unavailable");
        },
        createIssue: async () => {
          createCalls++;
          return 112;
        },
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => undefined,
      },
    });
    const started = service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    await new Promise<void>((resolve) => { preflightReached = resolve; });
    const laterContent = content.replace("Durable ticket", "Latest local edit");
    addOfflineNewTicket({
      content: laterContent,
      projectId: 12,
      documentUri: DOCUMENT_URI,
    }, SCOPE);

    releasePreflight?.();
    const outcome = await started;
    const operation = getOfflineSyncQueue(SCOPE).newTickets[0];

    assert.strictEqual(outcome.kind, "failed_before_commit");
    assert.strictEqual(createCalls, 0);
    assert.strictEqual(operation.content, laterContent);
    assert.strictEqual(operation.phase, "queued");
    assert.strictEqual(operation.nextIntent, undefined);
  });

  test("existing-ticket conflict は後続保存を queued active にして recovery pending を残さない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const metadata = buildIssueMetadataFixture();
    addOfflineTicketUpdate(113, {
      ticketId: 113,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: metadata,
      lastKnownRemoteUpdatedAt: "t1",
      subject: "Title",
      description: "A",
      metadata,
      connectionScope: SCOPE,
      phase: "queued",
    }, SCOPE);
    let releaseRemoteRead: (() => void) | undefined;
    let remoteReadReached: (() => void) | undefined;
    let updateCalls = 0;
    const service = new TicketSyncService({
      update: {
        updateIssue: async () => { updateCalls++; },
        getIssueDetail: async () => {
          remoteReadReached?.();
          await new Promise<void>((resolve) => { releaseRemoteRead = resolve; });
          return issueDetail(113);
        },
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
    });
    const syncing = service.syncQueueItem(
      { kind: "ticket", ticketId: 113 }, { connectionScope: SCOPE },
    );
    await new Promise<void>((resolve) => { remoteReadReached = resolve; });
    addOfflineTicketUpdate(113, {
      ticketId: 113,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: metadata,
      subject: "Title",
      description: "B",
      metadata,
      connectionScope: SCOPE,
    }, SCOPE);

    releaseRemoteRead?.();
    const outcome = await syncing;
    const operation = getOfflineSyncQueue(SCOPE).tickets.get(113);

    assert.strictEqual(outcome.kind, "conflict");
    assert.strictEqual(updateCalls, 0);
    assert.strictEqual(operation?.description, "B");
    assert.strictEqual(operation?.phase, "queued");
    assert.strictEqual(operation?.nextIntent, undefined);
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
          return { kind: "applied" };
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

  test("I-03/I-04 new ticket parent/child ID は次の dependent POST より前に durable 化する", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const childContent = buildTicketEditorContent({
      subject: "Parent with children",
      description: "Body",
      metadata: {
        ...buildIssueMetadataFixture(),
        children: ["Child one", "Child two"],
      },
      controlFields: { mode: "new-ticket", issue_id: null, project_id: 12 },
    });
    let createCalls = 0;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          const queued = getOfflineSyncQueue(SCOPE).newTickets[0];
          if (createCalls === 1) { return 600; }
          if (createCalls === 2) {
            assert.strictEqual(queued.createdIssueId, 600);
            assert.strictEqual(
              queued.effects?.find((effect) => effect.kind === "ticket_create")?.state,
              "committed",
            );
            return 601;
          }
          assert.strictEqual(
            queued.effects?.find((effect) => effect.effectId === "child-create:0")?.remoteId,
            601,
          );
          assert.strictEqual(
            queued.effects?.find((effect) => effect.effectId === "child-create:0")?.state,
            "committed",
          );
          return 602;
        },
        getIssueDetail: async () => issueDetail(600),
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => undefined,
      },
    });

    const outcome = await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content: childContent, projectId: 12, documentUri: DOCUMENT_URI },
    });

    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(createCalls, 3);
  });

  test("I-05 new ticket child compensation failure は durable recovery state を保持する", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
    const content = buildTicketEditorContent({
      subject: "Parent compensation",
      description: "Body",
      metadata: {
        ...buildIssueMetadataFixture(),
        children: ["Child one", "Child two"],
      },
    });
    let createCalls = 0;
    let deleteCalls = 0;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          if (createCalls === 1) { return 610; }
          if (createCalls === 2) { return 611; }
          throw new Error("Redmine request failed (400): invalid child");
        },
        deleteIssue: async () => {
          deleteCalls++;
          throw new Error("transport timeout during DELETE");
        },
        getIssueDetail: async () => issueDetail(610),
      },
    });

    const first = await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    initializeOfflineSyncStore(memento, SCOPE);
    const queued = getOfflineSyncQueue(SCOPE).newTickets[0];
    const afterRestart = await service.syncQueueItem(
      { kind: "newTicket", queueId: queued.queueId, documentUri: queued.documentUri },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(first.kind, "remote_committed");
    assert.strictEqual(afterRestart.kind, "remote_committed");
    assert.strictEqual(createCalls, 3);
    assert.ok(deleteCalls >= 1);
    assert.strictEqual(
      getOfflineSyncQueue(SCOPE).newTickets[0].effects?.find(
        (effect) => effect.effectId === "child-create:0",
      )?.state,
      "compensation_unknown",
    );
  });

  test("new ticket child known failure の補償成功後はdeleted parent IDを復旧対象にしない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const content = buildTicketEditorContent({
      subject: "Compensated parent",
      description: "Body",
      metadata: {
        ...buildIssueMetadataFixture(),
        children: ["Child one", "Child two"],
      },
    });
    let createCalls = 0;
    const deleted: number[] = [];
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          if (createCalls === 1) { return 640; }
          if (createCalls === 2) { return 641; }
          throw new Error("Redmine request failed (400): invalid child");
        },
        deleteIssue: async (ticketId) => { deleted.push(ticketId); },
      },
    });

    const outcome = await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    const queued = getOfflineSyncQueue(SCOPE).newTickets[0];

    assert.strictEqual(outcome.kind, "failed_before_commit");
    assert.deepStrictEqual(deleted, [641, 640]);
    assert.strictEqual(queued.phase, "queued");
    assert.strictEqual(queued.createdIssueId, undefined);
    assert.deepStrictEqual(queued.effects, []);
  });

  test("new ticket child POST timeout は commit_unknown となり自動再送・補償しない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const content = buildTicketEditorContent({
      subject: "Parent child timeout",
      description: "Body",
      metadata: { ...buildIssueMetadataFixture(), children: ["Maybe created"] },
    });
    let createCalls = 0;
    let deleteCalls = 0;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          if (createCalls === 1) { return 620; }
          throw new Error("transport timeout");
        },
        deleteIssue: async () => { deleteCalls++; },
        getIssueDetail: async () => issueDetail(620),
      },
    });

    const first = await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    const queued = getOfflineSyncQueue(SCOPE).newTickets[0];
    const retried = await service.syncQueueItem(
      { kind: "newTicket", queueId: queued.queueId, documentUri: queued.documentUri },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(first.kind, "remote_committed");
    assert.strictEqual(retried.kind, "remote_committed");
    assert.strictEqual(createCalls, 2);
    assert.strictEqual(deleteCalls, 0);
    assert.strictEqual(
      getOfflineSyncQueue(SCOPE).newTickets[0].effects?.find(
        (effect) => effect.effectId === "child-create:0",
      )?.state,
      "commit_unknown",
    );
  });

  test("I-16 50 children のeffect ledgerはprimary+50のbounded recordに収まる", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const children = Array.from({ length: 50 }, (_, index) => `Child ${index + 1}`);
    const content = buildTicketEditorContent({
      subject: "Bounded children",
      description: "Body",
      metadata: { ...buildIssueMetadataFixture(), children },
    });
    let nextId = 700;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => nextId++,
        getIssueDetail: async () => issueDetail(700),
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "write_failed" }),
        findOpenDocument: () => undefined,
      },
    });

    const outcome = await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });

    assert.strictEqual(outcome.kind, "remote_committed");
    const effects = getOfflineSyncQueue(SCOPE).newTickets[0].effects ?? [];
    assert.strictEqual(effects.length, 51);
    assert.strictEqual(new Set(effects.map((effect) => effect.effectId)).size, 51);
  });

  for (const failure of ["editor_edit", "document_save"] as const) {
    test(`I-20 ${failure}=false は remote-created operation を completed にしない`, async () => {
      initializeOfflineSyncStore(createTestMemento(), SCOPE);
      let createCalls = 0;
      let currentContent = content;
      const document = {
        uri: vscode.Uri.parse(DOCUMENT_URI),
        getText: () => currentContent,
        isDirty: true,
      } as unknown as vscode.TextDocument;
      const editor = {
        document,
        edit: async (callback: (builder: vscode.TextEditorEdit) => void) => {
          if (failure === "editor_edit") {
            return false;
          }
          callback({
            replace: (_range: vscode.Range, replacement: string) => {
              currentContent = replacement;
            },
          } as vscode.TextEditorEdit);
          return true;
        },
      } as unknown as vscode.TextEditor;
      const service = new TicketSyncService({
        create: {
          ...metadataDeps,
          createIssue: async () => {
            createCalls++;
            return 175;
          },
          getIssueDetail: async () => issueDetail(175),
        },
        rewrite: {
          textDocuments: [document],
          textEditors: [editor],
          saveDocument: async () => failure !== "document_save",
        },
      });

      const outcome = await service.syncEditor({
        context: { connectionScope: SCOPE },
        editor,
        ticketId: 0,
        newTicket: true,
        manual: false,
        projectId: 12,
      });

      assert.strictEqual(outcome.kind, "remote_committed");
      assert.strictEqual(
        outcome.kind === "remote_committed" ? outcome.pending : undefined,
        "local_finalize",
      );
      assert.strictEqual(createCalls, 1);
      const pending = getOfflineSyncQueue(SCOPE).newTickets[0];
      assert.strictEqual(pending.createdIssueId, 175);
      assert.strictEqual(pending.phase, "local_finalize_pending");
    });
  }

  test("I-14 process restart 後も createdIssueId を復元し POST せず finalize する", async () => {
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
        rewriteNewTicket: async () => ({ kind: "write_failed" }),
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
        rewriteNewTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => undefined,
      },
    });
    const outcome = await resumedService.syncQueueItem(
      { kind: "newTicket", documentUri: restored.documentUri },
      { connectionScope: SCOPE },
    );

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
        rewriteNewTicket: async () => ({ kind: rewriteSucceeds ? "applied" : "write_failed" }),
        findOpenDocument: () => undefined,
      },
    });
    await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    const pending = getOfflineSyncQueue(SCOPE).newTickets[0];

    rewriteSucceeds = true;
    const outcomes = await service.syncAll({ connectionScope: SCOPE });

    assert.strictEqual(outcomes.results[0].outcome.kind, "completed");
    assert.strictEqual(createCalls, 1);
  });

  test("Sync This File rewrite失敗後の Sync All は同じ issue をfinalizeする", async () => {
    const commandScope = getCurrentConnectionScope();
    initializeOfflineSyncStore(createTestMemento(), commandScope);
    await addOfflineNewTicketAsync({
      content,
      projectId: 12,
      documentUri: DOCUMENT_URI,
      connectionScope: commandScope,
    }, commandScope);
    let createCalls = 0;
    let rewriteSucceeds = false;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          return 260;
        },
        getIssueDetail: async () => issueDetail(260),
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: rewriteSucceeds ? "applied" : "write_failed" }),
        findOpenDocument: () => undefined,
      },
    });

    const first = await syncUnsyncedFile(
      { syncKey: { kind: "newTicket", documentUri: DOCUMENT_URI } },
      { createTicketSyncService: () => service },
    );

    assert.strictEqual(first?.status, "failed");
    assert.strictEqual(createCalls, 1);
    const pending = getOfflineSyncQueue(commandScope).newTickets[0];
    assert.strictEqual(pending.createdIssueId, 260);
    assert.strictEqual(pending.phase, "local_finalize_pending");

    rewriteSucceeds = true;
    const all = await runOfflineSync({ createTicketSyncService: () => service });

    assert.strictEqual(all.status, "success");
    assert.strictEqual(createCalls, 1);
    assert.strictEqual(getOfflineSyncQueue(commandScope).newTickets.length, 0);
  });

  test("I-01 同一 operation の並行同期は single-flight で POST を1回にする", async () => {
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
        rewriteNewTicket: async () => ({ kind: "applied" }),
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

  test("I-10 POST 成功後の GET 失敗は reconciliation_pending となり retry は GET のみ", async () => {
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
        rewriteNewTicket: async () => ({ kind: "applied" }),
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
    const retried = await service.syncQueueItem(
      { kind: "newTicket", documentUri: pending.documentUri },
      { connectionScope: SCOPE },
    );
    assert.strictEqual(retried.kind, "completed");
    assert.strictEqual(createCalls, 1);
    assert.strictEqual(getCalls, 2);
  });

  test("I-02 POST timeout は commit_unknown として restart 後も自動再送しない", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
    let createCalls = 0;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          throw new Error("Request timed out after 30000ms");
        },
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => undefined,
      },
    });

    const first = await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    assert.strictEqual(first.kind, "commit_unknown");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).newTickets[0].phase, "commit_unknown");

    initializeOfflineSyncStore(memento, SCOPE);
    const retried = await service.syncQueueItem(
      { kind: "newTicket", documentUri: DOCUMENT_URI },
      { connectionScope: SCOPE },
    );
    assert.strictEqual(retried.kind, "commit_unknown");
    assert.strictEqual(createCalls, 1);
  });

  test("new-ticket Explicit Retry は nextIntent ではなく commit_unknown active revision をPOSTする", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const postedSubjects: string[] = [];
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async (fields) => {
          postedSubjects.push(fields.subject);
          if (postedSubjects.length === 1) {
            throw new Error("Request timed out after 30000ms");
          }
          return 776;
        },
        getIssueDetail: async () => issueDetail(776),
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => undefined,
      },
    });

    await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    const laterContent = content.replace("Durable ticket", "Later local intent");
    addOfflineNewTicket({
      content: laterContent,
      projectId: 12,
      documentUri: DOCUMENT_URI,
    }, SCOPE);

    const outcome = await service.resolveCommitUnknown({
      key: { kind: "newTicket", documentUri: DOCUMENT_URI },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });

    assert.strictEqual(outcome.kind, "completed");
    assert.deepStrictEqual(postedSubjects, ["Durable ticket", "Durable ticket"]);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.get(776)?.subject, "Later local intent");
  });

  test("new-ticket Explicit Retry も parent/child ID をdependent POST前にdurable化する", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const childContent = buildTicketEditorContent({
      subject: "Retry parent",
      description: "Body",
      metadata: { ...buildIssueMetadataFixture(), children: ["Retry child"] },
    });
    let createCalls = 0;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          if (createCalls === 1) { throw new Error("Request timed out after 30000ms"); }
          if (createCalls === 2) { return 630; }
          const queued = getOfflineSyncQueue(SCOPE).newTickets[0];
          assert.strictEqual(queued.createdIssueId, 630);
          assert.strictEqual(
            queued.effects?.find((effect) => effect.kind === "ticket_create")?.state,
            "committed",
          );
          assert.strictEqual(
            queued.effects?.find((effect) => effect.effectId === "child-create:0")?.state,
            "started",
          );
          return 631;
        },
        getIssueDetail: async () => issueDetail(630),
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => undefined,
      },
    });

    const first = await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content: childContent, projectId: 12, documentUri: DOCUMENT_URI },
    });
    assert.strictEqual(first.kind, "commit_unknown");

    const retried = await service.resolveCommitUnknown({
      key: { kind: "newTicket", documentUri: DOCUMENT_URI },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });

    assert.strictEqual(retried.kind, "completed");
    assert.strictEqual(createCalls, 3);
  });

  test("new-ticket Retry preflight failure は commit_unknown active と nextIntent を保持する", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let createCalls = 0;
    let failRetryPreflight = false;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        listIssueStatuses: async () => {
          if (failRetryPreflight) {
            throw new Error("retry metadata unavailable");
          }
          return [{ id: 1, name: "In Progress" }];
        },
        createIssue: async () => {
          createCalls++;
          throw new Error("Request timed out after 30000ms");
        },
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => undefined,
      },
    });

    await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    const laterContent = content.replace("Durable ticket", "Later local intent");
    addOfflineNewTicket({ content: laterContent, projectId: 12, documentUri: DOCUMENT_URI }, SCOPE);
    failRetryPreflight = true;

    const outcome = await service.resolveCommitUnknown({
      key: { kind: "newTicket", documentUri: DOCUMENT_URI },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });
    const pending = getOfflineSyncQueue(SCOPE).newTickets[0];

    assert.strictEqual(outcome.kind, "commit_unknown");
    assert.strictEqual(createCalls, 1);
    assert.strictEqual(pending.phase, "commit_unknown");
    assert.strictEqual(pending.content, content);
    assert.strictEqual(pending.nextIntent?.content, laterContent);
  });

  test("同一 new-ticket Explicit Retry の並行3回は remote write を1回にする", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let createCalls = 0;
    let releaseRetry: (() => void) | undefined;
    let notifyRetryStarted: (() => void) | undefined;
    const retryStarted = new Promise<void>((resolve) => { notifyRetryStarted = resolve; });
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          if (createCalls === 1) {
            throw new Error("Request timed out after 30000ms");
          }
          notifyRetryStarted?.();
          await new Promise<void>((resolve) => { releaseRetry = resolve; });
          return 778;
        },
        getIssueDetail: async () => issueDetail(778),
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => undefined,
      },
    });
    await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    const retry = () => service.resolveCommitUnknown({
      key: { kind: "newTicket" as const, documentUri: DOCUMENT_URI },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" as const },
    });

    const retries = [retry(), retry(), retry()];
    await retryStarted;
    assert.strictEqual(createCalls, 2);
    releaseRetry?.();
    await Promise.all(retries);
    assert.strictEqual(createCalls, 2);
  });

  test("new-ticket Retry と Link の競合では source phase を取得した一方だけが進む", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let createCalls = 0;
    let holdRetryPreflight = false;
    let releasePreflight: (() => void) | undefined;
    let notifyPreflight: (() => void) | undefined;
    const preflightReached = new Promise<void>((resolve) => { notifyPreflight = resolve; });
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        listIssueStatuses: async () => {
          if (holdRetryPreflight) {
            notifyPreflight?.();
            await new Promise<void>((resolve) => { releasePreflight = resolve; });
          }
          return [{ id: 1, name: "In Progress" }];
        },
        createIssue: async () => {
          createCalls++;
          throw new Error("Request timed out after 30000ms");
        },
        getIssueDetail: async (ticketId) => issueDetail(ticketId),
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => undefined,
      },
    });
    await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    holdRetryPreflight = true;
    const retry = service.resolveCommitUnknown({
      key: { kind: "newTicket", documentUri: DOCUMENT_URI },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });
    await preflightReached;
    const link = service.resolveCommitUnknown({
      key: { kind: "newTicket", documentUri: DOCUMENT_URI },
      context: { connectionScope: SCOPE },
      resolution: { kind: "link_created_ticket", ticketId: 779 },
    });
    releasePreflight?.();
    const outcomes = await Promise.all([retry, link]);

    assert.strictEqual(createCalls, 1);
    assert.strictEqual(outcomes.filter((outcome) => outcome.kind === "completed").length, 1);
  });

  test("new-ticket Retry が remote_write_started を取得後は Link が割り込まない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let createCalls = 0;
    let releaseRetry: (() => void) | undefined;
    let notifyRetryStarted: (() => void) | undefined;
    const retryStarted = new Promise<void>((resolve) => { notifyRetryStarted = resolve; });
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          if (createCalls === 1) {
            throw new Error("Request timed out after 30000ms");
          }
          notifyRetryStarted?.();
          await new Promise<void>((resolve) => { releaseRetry = resolve; });
          return 780;
        },
        getIssueDetail: async (ticketId) => issueDetail(ticketId),
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => undefined,
      },
    });
    await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    const retry = service.resolveCommitUnknown({
      key: { kind: "newTicket", documentUri: DOCUMENT_URI },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });
    await retryStarted;

    const link = await service.resolveCommitUnknown({
      key: { kind: "newTicket", documentUri: DOCUMENT_URI },
      context: { connectionScope: SCOPE },
      resolution: { kind: "link_created_ticket", ticketId: 781 },
    });
    assert.strictEqual(link.kind, "commit_unknown");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).newTickets[0].phase, "remote_write_started");

    releaseRetry?.();
    const retried = await retry;
    assert.strictEqual(retried.kind, "completed");
    assert.strictEqual(createCalls, 2);
  });

  test("commit_unknown new ticket はverified issue IDをlinkしてPOSTなしでfinalizeできる", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let createCalls = 0;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          throw new Error("Request timed out after 30000ms");
        },
        getIssueDetail: async (ticketId) => issueDetail(ticketId),
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => undefined,
      },
    });
    await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });

    const outcome = await service.resolveCommitUnknown({
      key: { kind: "newTicket", documentUri: DOCUMENT_URI },
      context: { connectionScope: SCOPE },
      resolution: { kind: "link_created_ticket", ticketId: 777 },
    });

    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(outcome.kind === "completed" ? outcome.ticketId : undefined, 777);
    assert.strictEqual(createCalls, 1);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).newTickets.length, 0);
  });

  test("new ticket finalize 待ち中の後続編集を作成済みticketの次revisionへ昇格する", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let createCalls = 0;
    let rewriteSucceeds = false;
    let rewrittenSubject: string | undefined;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          return 304;
        },
        getIssueDetail: async () => issueDetail(304),
      },
      documents: {
        rewriteNewTicket: async ({ replacement }) => {
          rewrittenSubject = replacement.subject;
          return { kind: rewriteSucceeds ? "applied" : "write_failed" };
        },
        findOpenDocument: () => undefined,
      },
    });
    await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });
    const laterContent = buildTicketEditorContent({
      subject: "Edited after create",
      description: "Later body",
      metadata: buildIssueMetadataFixture(),
      controlFields: { mode: "new-ticket", issue_id: null, project_id: 12 },
    });
    addOfflineNewTicket({
      content: laterContent,
      projectId: 12,
      documentUri: DOCUMENT_URI,
    }, SCOPE);

    rewriteSucceeds = true;
    const outcome = await service.syncQueueItem(
      { kind: "newTicket", documentUri: DOCUMENT_URI },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(createCalls, 1);
    assert.strictEqual(rewrittenSubject, "Edited after create");
    const queue = getOfflineSyncQueue(SCOPE);
    assert.strictEqual(queue.newTickets.length, 0);
    const promoted = queue.tickets.get(304);
    assert.strictEqual(promoted?.phase, "queued");
    assert.strictEqual(promoted?.baseSubject, "Canonical subject");
    assert.strictEqual(promoted?.subject, "Edited after create");
  });

  test("I-12 operation の connection scope と context が異なる場合は fail closed", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => {
          throw new Error("must not create");
        },
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
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
        rewriteNewTicket: async () => ({ kind: "applied" }),
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

    const first = await service.syncQueueItem(
      { kind: "ticket", ticketId: queued.ticketId },
      { connectionScope: SCOPE },
    );
    assert.strictEqual(first.kind, "remote_committed");
    const pending = getOfflineSyncQueue(SCOPE).tickets.get(404)!;
    assert.strictEqual(pending.phase, "reconciliation_pending");
    assert.strictEqual(pending.remoteUpdatedAt, undefined);

    getSucceeds = true;
    const retried = await service.syncQueueItem(
      { kind: "ticket", ticketId: pending.ticketId },
      { connectionScope: SCOPE },
    );
    assert.strictEqual(retried.kind, "completed");
    assert.strictEqual(updateCalls, 1);
    assert.strictEqual(getCalls, 2);
  });

  test("legacy persisted existing ticket は strict lifecycle を通り PUT 1回で完了する", async () => {
    const memento = createTestMemento();
    const ticketMetadata = buildIssueMetadataFixture();
    void memento.update(`redmine.offlineSyncQueue.${encodeURIComponent(SCOPE)}`, {
      tickets: [[411, {
        ticketId: 411,
        baseSubject: "Title",
        baseDescription: "Old",
        baseMetadata: ticketMetadata,
        subject: "Title",
        description: "New",
        metadata: ticketMetadata,
      }]],
      comments: [],
      newTickets: [],
    });
    initializeOfflineSyncStore(memento, SCOPE);
    let updateCalls = 0;
    const service = new TicketSyncService({
      update: {
        updateIssue: async () => { updateCalls++; },
        getIssueDetail: async () => issueDetail(411),
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
    });

    const outcome = await service.syncQueueItem(
      { kind: "ticket", ticketId: 411 },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(updateCalls, 1);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.has(411), false);
  });

  test("PUT timeout は commit_unknown として通常retryでPUTを再送しない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const ticketMetadata = buildIssueMetadataFixture();
    addOfflineTicketUpdate(406, {
      ticketId: 406,
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
    const service = new TicketSyncService({
      update: {
        updateIssue: async () => {
          updateCalls++;
          throw new Error("Network request failed: socket closed");
        },
        getIssueDetail: async () => issueDetail(406),
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
    });

    const first = await service.syncQueueItem(
      { kind: "ticket", ticketId: 406 },
      { connectionScope: SCOPE },
    );
    const retried = await service.syncQueueItem(
      { kind: "ticket", ticketId: 406 },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(first.kind, "commit_unknown");
    assert.strictEqual(retried.kind, "commit_unknown");
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.get(406)?.phase, "commit_unknown");
    assert.strictEqual(updateCalls, 1);
  });

  test("child POST 成功後の parent PUT timeout は child を durable 化して再作成しない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const ticketMetadata = {
      ...buildIssueMetadataFixture(),
      children: ["Durable child"],
    };
    addOfflineTicketUpdate(420, {
      ticketId: 420,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: { ...ticketMetadata, children: [] },
      subject: "Title",
      description: "New",
      metadata: ticketMetadata,
      connectionScope: SCOPE,
      phase: "queued",
    }, SCOPE);
    let childCreateCalls = 0;
    let childDeleteCalls = 0;
    let parentUpdateCalls = 0;
    const service = new TicketSyncService({
      update: {
        ...metadataDeps,
        createIssue: async () => {
          childCreateCalls++;
          return 910;
        },
        deleteIssue: async () => { childDeleteCalls++; },
        updateIssue: async () => {
          parentUpdateCalls++;
          throw new Error("transport timeout");
        },
        getIssueDetail: async () => issueDetail(420),
      },
    });

    const first = await service.syncQueueItem(
      { kind: "ticket", ticketId: 420 },
      { connectionScope: SCOPE },
    );
    const retried = await service.syncQueueItem(
      { kind: "ticket", ticketId: 420 },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(
      first.kind,
      "commit_unknown",
      first.kind === "failed_before_commit" ? first.error.message : undefined,
    );
    assert.strictEqual(retried.kind, "commit_unknown");
    assert.strictEqual(childCreateCalls, 1);
    assert.strictEqual(childDeleteCalls, 0);
    assert.strictEqual(parentUpdateCalls, 1);
    const effects = getOfflineSyncQueue(SCOPE).tickets.get(420)?.effects ?? [];
    assert.strictEqual(effects.find((effect) => effect.kind === "child_create")?.state, "committed");
    assert.strictEqual(effects.find((effect) => effect.kind === "child_create")?.remoteId, 910);
    assert.strictEqual(effects.find((effect) => effect.kind === "ticket_update")?.state, "commit_unknown");
  });

  test("existing ticket child POST timeout は child commit_unknown となり自動再送しない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const metadata = { ...buildIssueMetadataFixture(), children: ["Maybe child"] };
    addOfflineTicketUpdate(422, {
      ticketId: 422,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: { ...metadata, children: [] },
      subject: "Title",
      description: "New",
      metadata,
      connectionScope: SCOPE,
      phase: "queued",
    }, SCOPE);
    let createCalls = 0;
    let deleteCalls = 0;
    const service = new TicketSyncService({
      update: {
        ...metadataDeps,
        createIssue: async () => { createCalls++; throw new Error("transport timeout"); },
        deleteIssue: async () => { deleteCalls++; },
        updateIssue: async () => { throw new Error("parent must not update"); },
        getIssueDetail: async () => issueDetail(422),
      },
    });

    const first = await service.syncQueueItem(
      { kind: "ticket", ticketId: 422 },
      { connectionScope: SCOPE },
    );
    const retried = await service.syncQueueItem(
      { kind: "ticket", ticketId: 422 },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(first.kind, "remote_committed");
    assert.strictEqual(retried.kind, "remote_committed");
    assert.strictEqual(createCalls, 1);
    assert.strictEqual(deleteCalls, 0);
    assert.strictEqual(
      getOfflineSyncQueue(SCOPE).tickets.get(422)?.effects?.find(
        (effect) => effect.effectId === "child-create:0",
      )?.state,
      "commit_unknown",
    );
  });

  test("I-14 restart 後の preparing は committed childを再POSTせずparent PUTへ進む", async () => {
    const memento = createTestMemento();
    const metadata = { ...buildIssueMetadataFixture(), children: ["Existing child"] };
    const payload = {
      ticketId: 423,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: { ...metadata, children: [] },
      subject: "Title",
      description: "New",
      metadata,
    };
    void memento.update(`redmine.offlineSyncQueue.${encodeURIComponent(SCOPE)}`, {
      version: 3,
      operations: [{
        operationId: "ticket:423",
        kind: "ticketUpdate",
        connectionScope: SCOPE,
        revision: 2,
        phase: "preparing",
        createdAt: 1,
        effects: [{
          effectId: "ticket-update",
          kind: "ticket_update",
          operationRevision: 2,
          state: "planned",
          target: { ticketId: 423 },
        }, {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 2,
          state: "committed",
          target: { parentTicketId: 423, ordinal: 0 },
          remoteId: 923,
        }],
        payload,
      }],
    });
    initializeOfflineSyncStore(memento, SCOPE);
    let childCreateCalls = 0;
    let parentUpdateCalls = 0;
    const service = new TicketSyncService({
      update: {
        ...metadataDeps,
        createIssue: async () => { childCreateCalls++; return 999; },
        updateIssue: async () => { parentUpdateCalls++; },
        getIssueDetail: async () => issueDetail(423),
      },
    });

    const outcome = await service.syncQueueItem(
      { kind: "ticket", ticketId: 423 },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(childCreateCalls, 0);
    assert.strictEqual(parentUpdateCalls, 1);
  });

  test("child compensation failure は durable recovery state を保持する", async () => {
    const memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
    const ticketMetadata = {
      ...buildIssueMetadataFixture(),
      children: ["Child one", "Child two"],
    };
    addOfflineTicketUpdate(421, {
      ticketId: 421,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: { ...ticketMetadata, children: [] },
      subject: "Title",
      description: "New",
      metadata: ticketMetadata,
      connectionScope: SCOPE,
      phase: "queued",
    }, SCOPE);
    let createCalls = 0;
    let deleteCalls = 0;
    const service = new TicketSyncService({
      update: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          if (createCalls === 1) { return 911; }
          throw new Error("Redmine request failed (400): invalid child");
        },
        deleteIssue: async () => {
          deleteCalls++;
          throw new Error("transport timeout during DELETE");
        },
        updateIssue: async () => { throw new Error("parent must not update"); },
        getIssueDetail: async () => issueDetail(421),
      },
    });

    const first = await service.syncQueueItem(
      { kind: "ticket", ticketId: 421 },
      { connectionScope: SCOPE },
    );
    initializeOfflineSyncStore(memento, SCOPE);
    const afterRestart = await service.syncQueueItem(
      { kind: "ticket", ticketId: 421 },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(first.kind, "remote_committed");
    assert.strictEqual(afterRestart.kind, "remote_committed");
    assert.strictEqual(createCalls, 2);
    assert.strictEqual(deleteCalls, 1);
    const childEffect = getOfflineSyncQueue(SCOPE).tickets.get(421)?.effects?.find(
      (effect) => effect.effectId === "child-create:0",
    );
    assert.strictEqual(childEffect?.remoteId, 911);
    assert.strictEqual(childEffect?.state, "compensation_unknown");
  });

  test("compensation started checkpoint失敗でもcommitted childをabort cleanupで消さない", async () => {
    const persisted = createTestMemento();
    const memento = {
      get: persisted.get,
      keys: persisted.keys,
      update: async (key: string, value: unknown): Promise<void> => {
        if (JSON.stringify(value).includes('"compensation_started"')) {
          throw new Error("checkpoint unavailable");
        }
        await persisted.update(key, value);
      },
    };
    initializeOfflineSyncStore(memento, SCOPE);
    const metadata = {
      ...buildIssueMetadataFixture(),
      children: ["Child one", "Child two"],
    };
    addOfflineTicketUpdate(424, {
      ticketId: 424,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: { ...metadata, children: [] },
      subject: "Title",
      description: "New",
      metadata,
      connectionScope: SCOPE,
      phase: "queued",
    }, SCOPE);
    let createCalls = 0;
    const service = new TicketSyncService({
      update: {
        ...metadataDeps,
        createIssue: async () => {
          createCalls++;
          if (createCalls === 1) { return 924; }
          throw new Error("Redmine request failed (400): invalid child");
        },
        updateIssue: async () => { throw new Error("parent must not update"); },
        getIssueDetail: async () => issueDetail(424),
      },
    });

    const first = await service.syncQueueItem(
      { kind: "ticket", ticketId: 424 },
      { connectionScope: SCOPE },
    );
    initializeOfflineSyncStore(memento, SCOPE);
    const afterRestart = await service.syncQueueItem(
      { kind: "ticket", ticketId: 424 },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(first.kind, "remote_committed");
    assert.strictEqual(afterRestart.kind, "remote_committed");
    assert.strictEqual(createCalls, 2);
    const committed = getOfflineSyncQueue(SCOPE).tickets.get(424)?.effects?.find(
      (effect) => effect.effectId === "child-create:0",
    );
    assert.strictEqual(committed?.state, "committed");
    assert.strictEqual(committed?.remoteId, 924);
  });

  test("existing-ticket Explicit Retry は nextIntent ではなく commit_unknown active revision をPUTする", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const ticketMetadata = buildIssueMetadataFixture();
    addOfflineTicketUpdate(408, {
      ticketId: 408,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: ticketMetadata,
      lastKnownRemoteUpdatedAt: "t1",
      subject: "Title",
      description: "Active A",
      metadata: ticketMetadata,
      connectionScope: SCOPE,
      phase: "queued",
    }, SCOPE);
    const sentDescriptions: unknown[] = [];
    const service = new TicketSyncService({
      update: {
        updateIssue: async ({ fields }) => {
          sentDescriptions.push(fields.description);
          if (sentDescriptions.length === 1) {
            throw new Error("Network request failed: socket closed");
          }
        },
        getIssueDetail: async () => ({
          ...issueDetail(408),
          ticket: { ...issueDetail(408).ticket, updatedAt: "t1" },
        }),
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
    });
    await service.syncQueueItem(
      { kind: "ticket", ticketId: 408 }, { connectionScope: SCOPE },
    );
    addOfflineTicketUpdate(408, {
      ticketId: 408,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: ticketMetadata,
      lastKnownRemoteUpdatedAt: "t1",
      subject: "Title",
      description: "Later B",
      metadata: ticketMetadata,
      connectionScope: SCOPE,
    }, SCOPE);

    await service.resolveCommitUnknown({
      key: { kind: "ticket", ticketId: 408 },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });

    assert.deepStrictEqual(sentDescriptions, ["Active A", "Active A"]);
  });

  test("existing-ticket Retry preflight failure は commit_unknown active と nextIntent を保持する", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const ticketMetadata = buildIssueMetadataFixture();
    addOfflineTicketUpdate(409, {
      ticketId: 409,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: ticketMetadata,
      lastKnownRemoteUpdatedAt: "t1",
      subject: "Title",
      description: "Active A",
      metadata: ticketMetadata,
      connectionScope: SCOPE,
      phase: "queued",
    }, SCOPE);
    let updateCalls = 0;
    let failRetryPreflight = false;
    const service = new TicketSyncService({
      update: {
        updateIssue: async () => {
          updateCalls++;
          throw new Error("Network request failed: socket closed");
        },
        getIssueDetail: async () => {
          if (failRetryPreflight) {
            throw new Error("retry remote preflight unavailable");
          }
          return {
            ...issueDetail(409),
            ticket: { ...issueDetail(409).ticket, updatedAt: "t1" },
          };
        },
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
    });
    await service.syncQueueItem(
      { kind: "ticket", ticketId: 409 }, { connectionScope: SCOPE },
    );
    addOfflineTicketUpdate(409, {
      ticketId: 409,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: ticketMetadata,
      lastKnownRemoteUpdatedAt: "t1",
      subject: "Title",
      description: "Later B",
      metadata: { ...ticketMetadata, status: "Changed status" },
      connectionScope: SCOPE,
    }, SCOPE);
    failRetryPreflight = true;

    const outcome = await service.resolveCommitUnknown({
      key: { kind: "ticket", ticketId: 409 },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });
    const pending = getOfflineSyncQueue(SCOPE).tickets.get(409);

    assert.strictEqual(outcome.kind, "commit_unknown");
    assert.strictEqual(updateCalls, 1);
    assert.strictEqual(pending?.phase, "commit_unknown");
    assert.strictEqual(pending?.description, "Active A");
    assert.strictEqual(pending?.nextIntent?.description, "Later B");
  });

  test("existing-ticket Retry と Assume の競合では source phase を取得した一方だけが進む", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const ticketMetadata = buildIssueMetadataFixture();
    addOfflineTicketUpdate(410, {
      ticketId: 410,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: ticketMetadata,
      lastKnownRemoteUpdatedAt: "t1",
      subject: "Title",
      description: "Active A",
      metadata: ticketMetadata,
      connectionScope: SCOPE,
      phase: "queued",
    }, SCOPE);
    let updateCalls = 0;
    let holdRetryPreflight = false;
    let retryPreflightBlocked = false;
    let releasePreflight: (() => void) | undefined;
    let notifyPreflight: (() => void) | undefined;
    const preflightReached = new Promise<void>((resolve) => { notifyPreflight = resolve; });
    const remoteDetail = {
      ...issueDetail(410),
      ticket: { ...issueDetail(410).ticket, updatedAt: "t1" },
    };
    const service = new TicketSyncService({
      update: {
        updateIssue: async () => {
          updateCalls++;
          throw new Error("Network request failed: socket closed");
        },
        getIssueDetail: async () => {
          if (holdRetryPreflight && !retryPreflightBlocked) {
            retryPreflightBlocked = true;
            notifyPreflight?.();
            await new Promise<void>((resolve) => { releasePreflight = resolve; });
          }
          return remoteDetail;
        },
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
    });
    await service.syncQueueItem(
      { kind: "ticket", ticketId: 410 }, { connectionScope: SCOPE },
    );
    holdRetryPreflight = true;
    const retry = service.resolveCommitUnknown({
      key: { kind: "ticket", ticketId: 410 },
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_remote_write" },
    });
    await preflightReached;
    const assume = service.resolveCommitUnknown({
      key: { kind: "ticket", ticketId: 410 },
      context: { connectionScope: SCOPE },
      resolution: { kind: "assume_update_committed" },
    });
    releasePreflight?.();
    const outcomes = await Promise.all([retry, assume]);

    assert.strictEqual(updateCalls, 1);
    assert.strictEqual(outcomes.filter((outcome) => outcome.kind === "completed").length, 1);
  });

  test("commit_unknown existing update は明示的assume-committedでGETから再開する", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const ticketMetadata = buildIssueMetadataFixture();
    addOfflineTicketUpdate(407, {
      ticketId: 407,
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
    const service = new TicketSyncService({
      update: {
        updateIssue: async () => {
          updateCalls++;
          throw new Error("Network request failed: socket closed");
        },
        getIssueDetail: async () => {
          getCalls++;
          return issueDetail(407);
        },
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
    });
    await service.syncQueueItem(
      { kind: "ticket", ticketId: 407 },
      { connectionScope: SCOPE },
    );

    const outcome = await service.resolveCommitUnknown({
      key: { kind: "ticket", ticketId: 407 },
      context: { connectionScope: SCOPE },
      resolution: { kind: "assume_update_committed" },
    });

    assert.strictEqual(outcome.kind, "completed");
    assert.strictEqual(updateCalls, 1);
    assert.strictEqual(getCalls, 1);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.has(407), false);
  });

  test("PUT後のreconciliation待ち中の後続編集を次revisionとして保持する", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    const ticketMetadata = buildIssueMetadataFixture();
    addOfflineTicketUpdate(405, {
      ticketId: 405,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: ticketMetadata,
      subject: "Title",
      description: "Sent revision",
      metadata: ticketMetadata,
      connectionScope: SCOPE,
      phase: "queued",
      documentUri: "file:///tmp/ticket-405.md",
    }, SCOPE);
    let updateCalls = 0;
    let getSucceeds = false;
    let rewrittenDescription: string | undefined;
    const service = new TicketSyncService({
      update: {
        updateIssue: async () => { updateCalls++; },
        getIssueDetail: async () => {
          if (!getSucceeds) {
            throw new Error("read-back failed");
          }
          return issueDetail(405);
        },
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        rewriteTicket: async ({ replacement }) => {
          rewrittenDescription = replacement.description;
          return { kind: "applied" };
        },
        findOpenDocument: () => undefined,
      },
    });
    await service.syncQueueItem(
      { kind: "ticket", ticketId: 405 },
      { connectionScope: SCOPE },
    );
    addOfflineTicketUpdate(405, {
      ...getOfflineSyncQueue(SCOPE).tickets.get(405)!,
      description: "Edited while pending",
      phase: "queued",
    }, SCOPE);

    getSucceeds = true;
    const reconciled = await service.syncQueueItem(
      { kind: "ticket", ticketId: 405 },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(reconciled.kind, "completed");
    assert.strictEqual(updateCalls, 1);
    assert.strictEqual(rewrittenDescription, "Edited while pending");
    const promoted = getOfflineSyncQueue(SCOPE).tickets.get(405);
    assert.strictEqual(promoted?.phase, "queued");
    assert.strictEqual(promoted?.baseDescription, "Canonical body");
    assert.strictEqual(promoted?.description, "Edited while pending");
  });

  test("I-08/I-09 new ticket finalizer は snapshot 後に編集された document を上書きしない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    let documentContent = content;
    let localStateFinalized = false;
    const service = new TicketSyncService({
      create: {
        ...metadataDeps,
        createIssue: async () => 501,
        getIssueDetail: async () => issueDetail(501),
      },
      documents: {
        rewriteNewTicket: async ({ expected }) => {
          assert.strictEqual(expected.content, content);
          assert.strictEqual(expected.operationRevision, 1);
          documentContent = `${content}\nEdited after finalizer snapshot`;
          return documentContent === expected.content
            ? { kind: "applied" }
            : { kind: "stale_source" };
        },
        findOpenDocument: () => undefined,
      },
      newTicketLocalState: {
        register: () => { localStateFinalized = true; },
        updateDraft: () => { localStateFinalized = true; },
      },
    });

    const outcome = await service.syncNewTicket({
      context: { connectionScope: SCOPE },
      operation: { content, projectId: 12, documentUri: DOCUMENT_URI },
    });

    assert.strictEqual(outcome.kind, "remote_committed");
    assert.strictEqual(
      outcome.kind === "remote_committed" ? outcome.pending : undefined,
      "local_finalize",
    );
    assert.match(documentContent, /Edited after finalizer snapshot/);
    assert.strictEqual(localStateFinalized, false);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).newTickets[0].phase, "local_finalize_pending");
  });

  test("existing ticket finalizer は snapshot 後に編集された document を上書きしない", async () => {
    initializeOfflineSyncStore(createTestMemento(), SCOPE);
    initializeDraftStore(createInMemoryDraftStorage(), SCOPE);
    const ticketMetadata = buildIssueMetadataFixture();
    const sourceContent = buildTicketEditorContent({
      subject: "Title",
      description: "Sent revision",
      metadata: ticketMetadata,
      controlFields: { mode: "ticket-update", issue_id: 502, project_id: 12 },
    });
    addOfflineTicketUpdate(502, {
      ticketId: 502,
      baseSubject: "Title",
      baseDescription: "Old",
      baseMetadata: ticketMetadata,
      subject: "Title",
      description: "Sent revision",
      metadata: ticketMetadata,
      controlFields: { mode: "ticket-update", issue_id: 502, project_id: 12 },
      connectionScope: SCOPE,
      phase: "queued",
      documentUri: "file:///tmp/ticket-502.md",
    }, SCOPE);
    let documentContent = sourceContent;
    const service = new TicketSyncService({
      update: {
        updateIssue: async () => undefined,
        getIssueDetail: async () => issueDetail(502),
        listIssueStatuses: async () => [],
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        searchUsers: async () => [],
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        rewriteTicket: async ({ expected }) => {
          assert.strictEqual(expected.content, sourceContent);
          assert.strictEqual(expected.operationRevision, 1);
          documentContent = `${sourceContent}\nEdited after finalizer snapshot`;
          return documentContent === expected.content
            ? { kind: "applied" }
            : { kind: "stale_source" };
        },
        findOpenDocument: () => undefined,
      },
    });

    const outcome = await service.syncQueueItem(
      { kind: "ticket", ticketId: 502 },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(outcome.kind, "remote_committed");
    assert.strictEqual(
      outcome.kind === "remote_committed" ? outcome.pending : undefined,
      "local_finalize",
    );
    assert.match(documentContent, /Edited after finalizer snapshot/);
    assert.strictEqual(getOfflineSyncQueue(SCOPE).tickets.get(502)?.phase, "local_finalize_pending");
  });
});
