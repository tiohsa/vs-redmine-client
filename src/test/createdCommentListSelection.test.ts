import * as assert from "assert";
import * as vscode from "vscode";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { DashboardUnsyncedService } from "../dashboard/services/DashboardUnsyncedService";
import type { Ticket } from "../redmine/types";
import type { DashboardServiceContext } from "../dashboard/services/DashboardServiceContext";
import {
  addOfflineCommentUpdateAsync,
  clearOfflineSyncQueueAsync,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { clearCommentDrafts } from "../views/commentDraftStore";
import {
  clearRegistry,
  registerCommentDocument,
  registerNewCommentDraft,
  setEditorCommentId,
} from "../views/ticketEditorRegistry";
import { createTestMemento } from "./helpers/vscodeMemento";
import { createMutableEditorStub } from "./helpers/editorStubs";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { createSyncEngine } from "../app/syncEngine";
import { performSyncOnSave } from "../app/saveSyncExecutor";
import { createSyncController } from "../app/syncController";
import type {
  CommentPresentationPort,
  TicketPresentationPort,
  UnsyncedPresentationPort,
} from "../app/presentationPorts";
import type { NotificationController } from "../app/notificationController";

const makeTicket = (id: number, projectId = 1): Ticket => ({
  id,
  subject: `Ticket #${id}`,
  description: "Description",
  projectId,
  projectName: `Project #${projectId}`,
  statusId: 1,
  statusName: "New",
  priorityId: 2,
  priorityName: "Normal",
  trackerId: 1,
  trackerName: "Task",
  updatedAt: "2026-11-21T00:00:00Z",
});

const makeContext = (
  store: DashboardStateStore,
  notices: string[] = [],
  onTicketsRefreshed: () => void = () => undefined,
): DashboardServiceContext => ({
  store,
  notifyOperationStarted: () => undefined,
  notifySuccess: (_id, message) => notices.push(message),
  notifyError: (_id, message) => assert.fail(message),
  notifyToast: () => undefined,
  onTicketsRefreshed,
});

suite("新規コメント作成後の自動選択と個別コメント同期", () => {
  const scope = getCurrentConnectionScope();

  setup(async () => {
    initializeOfflineSyncStore(createTestMemento(), scope);
    clearCommentDrafts();
    await clearOfflineSyncQueueAsync(scope);
    clearRegistry();
  });

  teardown(async () => {
    clearCommentDrafts();
    await clearOfflineSyncQueueAsync(scope);
    clearRegistry();
  });

  test("DashboardController.revealCreatedComment: チケット選択・コメント再読込とスコープ/一覧外ガード", async () => {
    const store = new DashboardStateStore();
    const controller = new DashboardController({
      store,
      notifyOperationStarted: () => undefined,
      notifySuccess: () => undefined,
      notifyError: () => undefined,
      notifyToast: () => undefined,
      onTicketsRefreshed: () => undefined,
    });

    const loadedCommentsFor: Array<{ ticketId: number; commentId?: number }> = [];
    controller["projectService"].loadProjects = async () => {
      controller["cache"].projects = [{ id: 1, name: "Project #1", identifier: "p1", level: 0 }];
    };
    controller["dataService"].loadMetadataOptions = async () => undefined;
    controller["metadataService"].loadEditOptions = async () => undefined;
    controller["ticketService"].loadTickets = async (_throwOnError, options) => {
      const target = options?.ensureTicketIds?.[0];
      if (target === 120) {
        controller["cache"].tickets = [makeTicket(120, 1)];
        store.update({
          tickets: [{ id: 120, subject: "Ticket #120", syncState: "Synced", children: [], level: 0 }],
        });
      } else {
        controller["cache"].tickets = [];
        store.update({ tickets: [] });
      }
    };
    controller["commentService"].loadComments = async (ticketId, _throwOnError, selection) => {
      loadedCommentsFor.push({ ticketId, commentId: selection?.commentId });
      store.updateNested("comments", {
        ticketId,
        loading: false,
        selectedCommentId: selection?.commentId,
        selectedCommentUri: undefined,
        items: selection?.commentId
          ? [{
              id: selection.commentId,
              authorName: "Taro",
              body: "Created comment",
              editableByCurrentUser: true,
              hasUnsyncedEdit: false,
            }]
          : [],
      });
    };

    await controller.revealCreatedComment(120, 901, { connectionScope: "https://other.example/" });
    assert.strictEqual(store.getState().selectedTicketId, undefined);
    assert.strictEqual(store.getState().comments.selectedCommentId, undefined);

    await controller.revealCreatedComment(999, 901, { connectionScope: scope });
    assert.strictEqual(store.getState().selectedTicketId, undefined);

    await controller.revealCreatedComment(120, 901, { connectionScope: scope });
    assert.strictEqual(store.getState().selectedTicketId, 120);
    assert.strictEqual(store.getState().comments.selectedCommentId, 901);
    assert.deepStrictEqual(loadedCommentsFor, [{ ticketId: 120, commentId: 901 }]);

    await controller.revealCreatedComment(120, 902, { connectionScope: scope });
    assert.strictEqual(store.getState().comments.selectedCommentId, 902);
    assert.deepStrictEqual(loadedCommentsFor, [
      { ticketId: 120, commentId: 901 },
      { ticketId: 120, commentId: 902 },
    ]);

    controller.dispose();
  });

  test("saveSyncExecutor(auto) と syncController.syncEditorAndNotify: 新規コメント作成後のみ revealCreatedComment を呼ぶ", async () => {
    const newUri = vscode.Uri.parse("untitled:redmine-client-new-comment-50.md");
    const newEditor = createMutableEditorStub(newUri, "New comment body");
    registerNewCommentDraft(50, newEditor, scope);

    const revealedAuto: Array<{ ticketId: number; commentId: number; scope?: string }> = [];
    const savedStatuses: string[] = [];

    const noopTickets: TicketPresentationPort = {
      refresh: () => undefined,
      notifyChange: () => undefined,
      updateTicketSubject: () => undefined,
      setSelectedProjectId: async () => undefined,
    };
    const noopUnsynced: UnsyncedPresentationPort = {
      refresh: () => undefined,
    };
    const notifications = {
      notifyTicketSaveResult: () => undefined,
      notifyCommentSaveResult: (result: { status: string }) => { savedStatuses.push(result.status); },
    } as unknown as NotificationController;

    const newSyncEngine = createSyncEngine();
    newSyncEngine.syncOne = async () => ({ kind: "completed", ticketId: 50, commentId: 701 });

    await performSyncOnSave(newEditor.document, newEditor, {
      ticketsPresentation: noopTickets,
      commentsPresentation: {
        refresh: () => undefined,
        refreshForTicket: () => undefined,
        revealCreatedComment: async (ticketId, commentId, connectionScope) => {
          revealedAuto.push({ ticketId, commentId, scope: connectionScope });
          throw new Error("UI unavailable");
        },
      },
      unsyncedPresentation: noopUnsynced,
      notifications,
      updateTicketListSubject: () => undefined,
      offlineSyncMode: "auto",
      syncEngine: newSyncEngine,
    });

    assert.deepStrictEqual(revealedAuto, [{ ticketId: 50, commentId: 701, scope }]);
    assert.deepStrictEqual(savedStatuses, ["queued"]);

    const editUri = vscode.Uri.parse("untitled:redmine-client-comment-50.md");
    const editEditor = createMutableEditorStub(editUri, "Updated comment body");
    registerCommentDocument(50, 701, editEditor.document, 1, scope);
    setEditorCommentId(editEditor, 701);

    const editSyncEngine = createSyncEngine();
    editSyncEngine.syncOne = async () => ({ kind: "completed", ticketId: 50, commentId: 701 });
    const revealedAutoEdit: Array<{ ticketId: number; commentId: number; scope?: string }> = [];

    await performSyncOnSave(editEditor.document, editEditor, {
      ticketsPresentation: noopTickets,
      commentsPresentation: {
        refresh: () => undefined,
        refreshForTicket: () => undefined,
        revealCreatedComment: async (ticketId, commentId, connectionScope) => {
          revealedAutoEdit.push({ ticketId, commentId, scope: connectionScope });
        },
      },
      unsyncedPresentation: noopUnsynced,
      notifications,
      updateTicketListSubject: () => undefined,
      offlineSyncMode: "auto",
      syncEngine: editSyncEngine,
    });
    assert.strictEqual(revealedAutoEdit.length, 0, "既存コメント更新では revealCreatedComment を呼ばないこと");

    const revealedExplicit: Array<{ ticketId: number; commentId: number; scope?: string }> = [];
    const explicitController = createSyncController({
      ticketsPresentation: noopTickets,
      commentsPresentation: {
        refresh: () => undefined,
        refreshForTicket: () => undefined,
        revealCreatedComment: async (ticketId, commentId, connectionScope) => {
          revealedExplicit.push({ ticketId, commentId, scope: connectionScope });
        },
      },
      unsyncedPresentation: noopUnsynced,
      notifications,
      registerEditorDocument: () => undefined,
      syncEngine: {
        syncOne: async () => ({ kind: "completed", ticketId: 50, commentId: 702 }),
      },
    });

    const newExplicitEditor = createMutableEditorStub(
      vscode.Uri.parse("untitled:redmine-client-new-comment-explicit-50.md"),
      "Explicit new comment",
    );
    registerNewCommentDraft(50, newExplicitEditor, scope);
    const status = await explicitController.syncEditorAndNotify(newExplicitEditor);
    assert.strictEqual(status, "uploaded");
    assert.deepStrictEqual(revealedExplicit, [{ ticketId: 50, commentId: 702, scope }]);
  });

  test("DashboardUnsyncedService.handleSyncSelectedComment: キュー同期・新規作成選択・未同期なし通知を処理する", async () => {
    const store = new DashboardStateStore();
    const notices: string[] = [];
    let refreshedCalls = 0;
    const revealedComments: Array<{ ticketId: number; commentId: number }> = [];

    const draftUri = "file:///tmp/new-comment-draft-10.md";
    await addOfflineCommentUpdateAsync({
      ticketId: 10,
      body: "Queued new comment",
      documentUri: draftUri,
    }, scope);

    const syncEngine = createSyncEngine();
    syncEngine.syncOne = async () => ({ kind: "completed", ticketId: 10, commentId: 888 });

    const service = new DashboardUnsyncedService({
      context: makeContext(store, notices, () => { refreshedCalls++; }),
      refreshTicketPresentation: () => undefined,
      loadComments: async () => undefined,
      revealCreatedComment: async (ticketId, commentId) => {
        revealedComments.push({ ticketId, commentId });
      },
      syncEngine,
    });

    await service.handleSyncSelectedComment("req-new-cm", { ticketId: 10, documentUri: draftUri });
    assert.deepStrictEqual(revealedComments, [{ ticketId: 10, commentId: 888 }]);
    assert.strictEqual(refreshedCalls, 0);
    assert.strictEqual(notices.length, 1);

    await service.handleSyncSelectedComment("req-none-cm", { ticketId: 10, commentId: 999 });
    assert.strictEqual(notices.length, 2);
    assert.strictEqual(notices[1], "No unsynced changes to sync.");
  });
});
