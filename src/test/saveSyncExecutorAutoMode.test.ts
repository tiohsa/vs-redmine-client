import * as assert from "assert";
import * as vscode from "vscode";
import { performSyncOnSave } from "../app/saveSyncExecutor";
import { clearTicketDrafts, initializeTicketDraft } from "../views/ticketDraftStore";
import { clearNewTicketDrafts } from "../views/newTicketDraftStore";
import { clearOfflineSyncQueue, getOfflineSyncQueue, initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { clearRegistry, registerTicketEditor, registerNewTicketDraft } from "../views/ticketEditorRegistry";
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

suite("saveSyncExecutor auto/manual mode policy (RT-01, RT-02)", () => {
  setup(() => {
    initializeOfflineSyncStore(createTestMemento(), scope);
    clearTicketDrafts(scope);
    clearNewTicketDrafts();
    clearOfflineSyncQueue(scope);
    clearRegistry();
  });

  teardown(() => {
    clearTicketDrafts(scope);
    clearNewTicketDrafts();
    clearOfflineSyncQueue(scope);
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

  test("New Ticket Draft は auto モードでも保存時は queueOnly であり即時 create は行われない (Q-01 / D-001)", async () => {
    const uri = vscode.Uri.parse("untitled:redmine-client-new-ticket.md");
    const content = createTicketContentFixture("New Ticket Subject", "New Ticket Body", { tracker: "Bug" });
    const editor = createMutableEditorStub(uri, content);
    registerNewTicketDraft(editor, scope);

    let syncCalls = 0;
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
          syncQueueItem: async () => {
            syncCalls++;
            return { kind: "completed", ticketId: 200 };
          },
          syncAll: async () => ({ plan: [], results: [], remaining: [], cancelled: false }),
          resolveCommitUnknown: async () => ({ kind: "completed", ticketId: 200 }),
        },
      }),
    });

    assert.strictEqual(syncCalls, 0, "New Ticket Draft は auto でも即時 create されないこと");
    const queue = getOfflineSyncQueue(scope);
    assert.strictEqual(queue.newTickets.length, 1, "新規チケットキューに追加されていること");
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

