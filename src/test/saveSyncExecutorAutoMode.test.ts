import * as assert from "assert";
import * as vscode from "vscode";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { TicketSyncService } from "../app/ticketSync";
import { isSaveSyncSuppressed } from "../views/saveSyncSuppression";
import { buildTicketEditorContent, parseTicketEditorContent } from "../views/ticketEditorContent";
import { performSyncOnSave } from "../app/saveSyncExecutor";
import { clearTicketDrafts, initializeTicketDraft } from "../views/ticketDraftStore";
import { clearNewTicketDrafts } from "../views/newTicketDraftStore";
import { clearOfflineSyncQueueAsync, getOfflineSyncQueue, initializeOfflineSyncStore } from "../views/offlineSyncStore";
import {
  clearRegistry,
  registerNewCommentDraft,
  registerNewTicketDraft,
  registerTicketEditor,
  setEditorCommentId,
} from "../views/ticketEditorRegistry";
import { createMutableEditorStub, createTicketContentFixture } from "./helpers/editorStubs";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createSyncEngine } from "../app/syncEngine";
import { getCurrentConnectionScope } from "../config/connectionScope";

const scope = getCurrentConnectionScope();

const makeNoopProvider = (): {
  refresh: () => void;
  notifyChange: () => void;
  refreshForTicket: (id: number) => void;
  updateTicketSubject: (id: number, s: string) => void;
  setSelectedProjectId: (id: number) => Promise<void>;
} => ({
  refresh: () => undefined,
  notifyChange: () => undefined,
  refreshForTicket: () => undefined,
  updateTicketSubject: () => undefined,
  setSelectedProjectId: async () => undefined,
});

const createObservedCommentSyncEngine = () => {
  const calls = { syncOne: 0, addComment: 0, updateComment: 0, uploadFile: 0 };
  const syncEngine = createSyncEngine({
    comments: {
      addComment: async () => { calls.addComment++; },
      updateComment: async () => { calls.updateComment++; },
      uploadFile: async () => {
        calls.uploadFile++;
        return { token: "unused", filename: "unused", contentType: "application/octet-stream" };
      },
    },
  });
  const syncOne = syncEngine.syncOne.bind(syncEngine);
  syncEngine.syncOne = async (key, context) => {
    calls.syncOne++;
    return syncOne(key, context);
  };
  return { calls, syncEngine };
};

suite("saveSyncExecutor auto/manual mode policy (RT-01, RT-02)", () => {
  setup(async () => {
    initializeOfflineSyncStore(createTestMemento(), scope);
    clearTicketDrafts(scope);
    clearNewTicketDrafts();
    await clearOfflineSyncQueueAsync(scope);
    clearRegistry();
  });

  teardown(async () => {
    clearTicketDrafts(scope);
    clearNewTicketDrafts();
    await clearOfflineSyncQueueAsync(scope);
    clearRegistry();
  });

  test("RT-02: manual モード時は Ctrl+S でキューイングのみが行われ Redmine 更新は実行されない", async () => {
    const uri = vscode.Uri.parse("file:///tmp/project-1_ticket-101.md");
    const initialMetadata = buildIssueMetadataFixture({ status: "New" });
    initializeTicketDraft(101, "Original Subject", "Original Description", initialMetadata, "2026-08-14T00:00:00Z", scope);

    const updatedContent = createTicketContentFixture("Updated Subject", "Updated Description", { status: "In Progress" });
    const editor = createMutableEditorStub(uri, updatedContent);
    registerTicketEditor(101, editor, "primary", "ticket", 1, scope);

    let updateCallCount = 0;
    const notifications: { status: string; message: string }[] = [];

    await performSyncOnSave(editor.document, editor, {
      ticketsPresentation: makeNoopProvider(),
      commentsPresentation: makeNoopProvider(),
      unsyncedPresentation: makeNoopProvider(),
      notifications: {
        notifyTicketSaveResult: (r: { status: string; message: string }) => notifications.push(r),
        notifyCommentSaveResult: () => undefined,
      } as unknown as import("../app/notificationController").NotificationController,
      updateTicketListSubject: () => undefined,
      offlineSyncMode: "manual",
      syncEngine: createSyncEngine({
        tickets: {
          syncQueueItem: async () => {
            updateCallCount++;
            return { kind: "completed", ticketId: 101 };
          },
          syncAll: async () => ({ plan: [], results: [], remaining: [], cancelled: false }),
          resolveCommitUnknown: async () => ({ kind: "completed", ticketId: 101 }),
        },
      }),
    });

    assert.strictEqual(updateCallCount, 0, "manual モードでは即時同期が呼ばれないこと");
    const queue = getOfflineSyncQueue(scope);
    assert.strictEqual(queue.tickets.size, 1, "キューにチケット更新が存在すること");
    assert.strictEqual(queue.tickets.get(101)?.subject, "Updated Subject");
  });

  test("RT-01: auto モード時は Ctrl+S でキューイング後に即座に Redmine 同期が実行される", async () => {
    const uri = vscode.Uri.parse("file:///tmp/project-1_ticket-102.md");
    const initialMetadata = buildIssueMetadataFixture({ status: "New" });
    initializeTicketDraft(102, "Original Subject", "Original Description", initialMetadata, "2026-08-14T00:00:00Z", scope);

    const updatedContent = createTicketContentFixture("Updated Subject Auto", "Updated Description Auto", { status: "In Progress" });
    const editor = createMutableEditorStub(uri, updatedContent);
    registerTicketEditor(102, editor, "primary", "ticket", 1, scope);

    let syncQueueItemCalls = 0;
    const notifications: { status: string; message: string }[] = [];

    await performSyncOnSave(editor.document, editor, {
      ticketsPresentation: makeNoopProvider(),
      commentsPresentation: makeNoopProvider(),
      unsyncedPresentation: makeNoopProvider(),
      notifications: {
        notifyTicketSaveResult: (r: { status: string; message: string }) => notifications.push(r),
        notifyCommentSaveResult: () => undefined,
      } as unknown as import("../app/notificationController").NotificationController,
      updateTicketListSubject: () => undefined,
      offlineSyncMode: "auto",
      syncEngine: createSyncEngine({
        tickets: {
          syncQueueItem: async (key) => {
            syncQueueItemCalls++;
            assert.strictEqual(key.kind, "ticket");
            assert.strictEqual((key as any).ticketId, 102);
            return { kind: "completed", ticketId: 102 };
          },
          syncAll: async () => ({ plan: [], results: [], remaining: [], cancelled: false }),
          resolveCommitUnknown: async () => ({ kind: "completed", ticketId: 102 }),
        },
      }),
    });

    assert.strictEqual(syncQueueItemCalls, 1, "auto モードでは即時同期が実行されること");
  });

  for (const mode of ["auto", "manual"] as const) {
    test(`新規下書き保存時の同期モード ${mode}`, async () => {
      const dir = await mkdtemp(join(tmpdir(), "redmine-save-mode-"));
      const uri = vscode.Uri.file(join(dir, "draft.md"));
      let listener: vscode.Disposable | undefined;
      let posts = 0;
      let reads = 0;
      const service = new TicketSyncService({
        create: {
          listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
          getProjectTrackers: async () => [{ id: 2, name: "Task" }],
          listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
          createIssue: async (request) => {
            posts++;
            assert.strictEqual(request.projectId, 12);
            return 200;
          },
          getIssueDetail: async () => {
            reads++;
            return { ticket: { id: 200, subject: "Saved subject", description: "Body", projectId: 12,
              trackerName: "Task", statusName: "In Progress", priorityName: "Normal", updatedAt: "t1" }, comments: [] };
          },
        },
      });
      try {
        await vscode.workspace.fs.writeFile(uri, new Uint8Array());
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);
        registerNewTicketDraft(editor, scope);
        const content = buildTicketEditorContent({
          subject: "Saved subject", description: "Body", metadata: buildIssueMetadataFixture(),
          controlFields: { mode: "new-ticket", project_id: 12, issue_id: null },
        });
        await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), content));
        const saved = new Promise<void>((resolve, reject) => {
          listener = vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc !== document || isSaveSyncSuppressed(doc.uri.toString())) { return; }
            void performSyncOnSave(doc, editor, {
              ticketsPresentation: makeNoopProvider(), commentsPresentation: makeNoopProvider(),
              unsyncedPresentation: makeNoopProvider(),
              notifications: { notifyTicketSaveResult: () => {}, notifyCommentSaveResult: () => {} },
              updateTicketListSubject: () => {}, offlineSyncMode: mode, syncEngine: createSyncEngine({ tickets: service }),
            }).then(resolve, reject);
          });
        });
        assert.ok(await document.save());
        await saved;
        assert.strictEqual(posts, mode === "auto" ? 1 : 0);
        if (mode === "manual") {
          assert.strictEqual(getOfflineSyncQueue(scope).newTickets.length, 1);
          await service.syncQueueItem({ kind: "newTicket", documentUri: uri.toString() }, { connectionScope: scope });
        }
        assert.strictEqual(posts, 1);
        assert.strictEqual(reads, 1);
        assert.strictEqual(parseTicketEditorContent(document.getText()).controlFields?.issue_id, 200);
        assert.strictEqual(getOfflineSyncQueue(scope).newTickets.length, 0);
      } finally {
        listener?.dispose();
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  test("finalized new-comment の metadata 破損時は registry identity があっても queue / sync しない", async () => {
    const uri = vscode.Uri.parse("file:///tmp/redmine-client-new-comment-39.md");
    const content = [
      "---",
      "mode: broken",
      "issue_id: 39",
      "journal_id: 777",
      "source_notes_hash: sha256:broken",
      "---",
      "",
      "本文",
    ].join("\n");
    const editor = createMutableEditorStub(uri, content);
    registerNewCommentDraft(39, editor, scope);
    setEditorCommentId(editor, 777);

    const notifications: { status: string; message: string }[] = [];
    const { calls, syncEngine } = createObservedCommentSyncEngine();

    await performSyncOnSave(editor.document, editor, {
      ticketsPresentation: makeNoopProvider(),
      commentsPresentation: makeNoopProvider(),
      unsyncedPresentation: makeNoopProvider(),
      notifications: {
        notifyTicketSaveResult: () => undefined,
        notifyCommentSaveResult: (result: { status: string; message: string }) =>
          notifications.push(result),
      } as unknown as import("../app/notificationController").NotificationController,
      updateTicketListSubject: () => undefined,
      offlineSyncMode: "auto",
      syncEngine,
    });

    assert.deepStrictEqual(
      calls,
      { syncOne: 0, addComment: 0, updateComment: 0, uploadFile: 0 },
      "remote mutation を呼ばないこと",
    );
    assert.strictEqual(getOfflineSyncQueue(scope).comments.length, 0, "comment queue を作らないこと");
    assert.strictEqual(notifications.length, 1);
    assert.strictEqual(notifications[0].status, "failed");
    assert.strictEqual(
      notifications[0].message,
      "Comment update metadata is invalid. Reopen the comment editor.",
    );
  });

  test("restart 相当で registry がなくても finalized marker の破損時は queue / sync しない", async () => {
    const uri = vscode.Uri.parse("file:///tmp/redmine-client-new-comment-39.md");
    const document = createMutableEditorStub(uri, [
      "---",
      "mode: broken",
      "issue_id: 39",
      "journal_id: 777",
      "last_synced_at: 2026-09-21T00:00:00.000Z",
      "---",
      "",
      "本文",
    ].join("\n")).document;

    const notifications: { status: string; message: string }[] = [];
    const { calls, syncEngine } = createObservedCommentSyncEngine();

    await performSyncOnSave(document, undefined, {
      ticketsPresentation: makeNoopProvider(),
      commentsPresentation: makeNoopProvider(),
      unsyncedPresentation: makeNoopProvider(),
      notifications: {
        notifyTicketSaveResult: () => undefined,
        notifyCommentSaveResult: (result: { status: string; message: string }) =>
          notifications.push(result),
      } as unknown as import("../app/notificationController").NotificationController,
      updateTicketListSubject: () => undefined,
      offlineSyncMode: "auto",
      syncEngine,
    });

    assert.deepStrictEqual(
      calls,
      { syncOne: 0, addComment: 0, updateComment: 0, uploadFile: 0 },
      "restart 後も remote mutation を呼ばないこと",
    );
    assert.strictEqual(getOfflineSyncQueue(scope).comments.length, 0, "restart 後も comment queue を作らないこと");
    assert.strictEqual(notifications.length, 1);
    assert.strictEqual(notifications[0].status, "failed");
  });

  test("RT-03: auto モードでの同期失敗 (commit_unknown / recovery_required) が presentation される", async () => {
    const uri = vscode.Uri.parse("file:///tmp/project-1_ticket-103.md");
    const initialMetadata = buildIssueMetadataFixture({ status: "New" });
    initializeTicketDraft(103, "Original Subject", "Original Description", initialMetadata, "2026-08-14T00:00:00Z", scope);

    const updatedContent = createTicketContentFixture("Updated Subject Unknown", "Updated Description Unknown", { status: "In Progress" });
    const editor = createMutableEditorStub(uri, updatedContent);
    registerTicketEditor(103, editor, "primary", "ticket", 1, scope);

    const notifications: { status: string; message: string }[] = [];

    await performSyncOnSave(editor.document, editor, {
      ticketsPresentation: makeNoopProvider(),
      commentsPresentation: makeNoopProvider(),
      unsyncedPresentation: makeNoopProvider(),
      notifications: {
        notifyTicketSaveResult: (r: { status: string; message: string }) => notifications.push(r),
        notifyCommentSaveResult: () => undefined,
      } as unknown as import("../app/notificationController").NotificationController,
      updateTicketListSubject: () => undefined,
      offlineSyncMode: "auto",
      syncEngine: createSyncEngine({
        tickets: {
          syncQueueItem: async () => ({
            kind: "commit_unknown",
            operationId: "op-103",
            ticketId: 103,
            message: "Request timed out, status unknown",
          }),
          syncAll: async () => ({ plan: [], results: [], remaining: [], cancelled: false }),
          resolveCommitUnknown: async () => ({ kind: "completed", ticketId: 103 }),
        },
      }),
    });

    const hasWarning = notifications.some((n) => n.status === "warning" || n.status === "error" || n.status === "commit_unknown" || n.status === "failed");
    assert.strictEqual(hasWarning, true, "commit_unknown の Outcome が Presentation / 通知されたこと");
  });

  test("RT-04: auto モードでの conflict Outcome が捨てられずに presentation される", async () => {
    const uri = vscode.Uri.parse("file:///tmp/project-1_ticket-104.md");
    const initialMetadata = buildIssueMetadataFixture({ status: "New" });
    initializeTicketDraft(104, "Original Subject", "Original Description", initialMetadata, "2026-08-14T00:00:00Z", scope);

    const updatedContent = createTicketContentFixture("Updated Subject Conflict", "Updated Description Conflict", { status: "In Progress" });
    const editor = createMutableEditorStub(uri, updatedContent);
    registerTicketEditor(104, editor, "primary", "ticket", 1, scope);

    const notifications: { status: string; message: string }[] = [];

    await performSyncOnSave(editor.document, editor, {
      ticketsPresentation: makeNoopProvider(),
      commentsPresentation: makeNoopProvider(),
      unsyncedPresentation: makeNoopProvider(),
      notifications: {
        notifyTicketSaveResult: (r: { status: string; message: string }) => notifications.push(r),
        notifyCommentSaveResult: () => undefined,
      } as unknown as import("../app/notificationController").NotificationController,
      updateTicketListSubject: () => undefined,
      offlineSyncMode: "auto",
      syncEngine: createSyncEngine({
        tickets: {
          syncQueueItem: async () => ({
            kind: "conflict",
            ticketId: 104,
            message: "Remote content has been modified by someone else",
          }),
          syncAll: async () => ({ plan: [], results: [], remaining: [], cancelled: false }),
          resolveCommitUnknown: async () => ({ kind: "completed", ticketId: 104 }),
        },
      }),
    });

    const hasConflictNotification = notifications.some((n) => n.status === "conflict" || n.status === "warning" || n.status === "error");
    assert.strictEqual(hasConflictNotification, true, "conflict Outcome が Presentation / 通知されたこと");
  });
});
