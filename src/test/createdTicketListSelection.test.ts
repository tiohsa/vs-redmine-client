import * as assert from "assert";
import * as vscode from "vscode";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { DashboardTicketService } from "../dashboard/services/DashboardTicketService";
import { DashboardUnsyncedService } from "../dashboard/services/DashboardUnsyncedService";
import { DashboardComposerService } from "../dashboard/services/DashboardComposerService";
import { DEFAULT_TICKET_LIST_SETTINGS, type TicketListSettings } from "../views/projectListSettings";
import type { IssuesListInput, IssuesListResult } from "../redmine/issues";
import type { Ticket } from "../redmine/types";
import type { DashboardServiceContext } from "../dashboard/services/DashboardServiceContext";
import {
  addOfflineNewTicketAsync,
  clearOfflineSyncQueueAsync,
  initializeOfflineSyncStore,
} from "../views/offlineSyncStore";
import { clearNewTicketDrafts } from "../views/newTicketDraftStore";
import { clearTicketDrafts } from "../views/ticketDraftStore";
import { clearRegistry, registerNewTicketDraft, setEditorProjectId } from "../views/ticketEditorRegistry";
import { createTestMemento } from "./helpers/vscodeMemento";
import { createMutableEditorStub } from "./helpers/editorStubs";
import { buildTicketEditorContent } from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
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

const makeTicket = (id: number, projectId = 1, overrides: Partial<Ticket> = {}): Ticket => ({
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
  ...overrides,
});

const makeContext = (
  store: DashboardStateStore,
  onTicketsRefreshed: () => void = () => undefined,
): DashboardServiceContext => ({
  store,
  notifyOperationStarted: () => undefined,
  notifySuccess: () => undefined,
  notifyError: () => undefined,
  notifyToast: () => undefined,
  onTicketsRefreshed,
});

suite("新規チケット作成後の一覧反映と自動選択", () => {
  const scope = getCurrentConnectionScope();

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

  test("DashboardTicketService.loadTickets: limit超過の新規チケットを補完し、次ページ位置とhasMoreTicketsを正しく保つ", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [];
    let totalCount = 0;
    const inputs: IssuesListInput[] = [];

    const firstPage = Array.from({ length: 50 }, (_, index) => makeTicket(index + 1));
    const page2 = [makeTicket(51), makeTicket(52), makeTicket(55)];

    const service = new DashboardTicketService({
      context: makeContext(store),
      getResolvedProject: () => ({ id: 1, name: "Project #1" }),
      getTickets: () => tickets,
      setTickets: (next) => { tickets = next; },
      getTotalCount: () => totalCount,
      setTotalCount: (next) => { totalCount = next; },
      getSettings: () => structuredClone(DEFAULT_TICKET_LIST_SETTINGS),
      loadComments: async () => undefined,
      refreshUnsynced: () => undefined,
      listIssues: async (input): Promise<IssuesListResult> => {
        inputs.push(input);
        if (input.issueIds?.includes(55)) {
          return { tickets: [makeTicket(55)], totalCount: 1, limit: input.limit, offset: 0 };
        }
        if (input.offset === 0) {
          return { tickets: firstPage, totalCount: 53, limit: input.limit, offset: 0 };
        }
        return { tickets: page2, totalCount: 53, limit: 50, offset: input.offset };
      },
    });

    await service.loadTickets(false, { ensureTicketIds: [55, 55, 10] });

    assert.strictEqual(inputs.length, 2);
    assert.deepStrictEqual(inputs[1].issueIds, [55]);
    assert.ok(tickets.some((t) => t.id === 55), "補完したチケット55が一覧に含まれること");
    assert.strictEqual(tickets.length, 51);
    assert.strictEqual(store.getState().hasMoreTickets, true);

    await service.loadMoreTickets();
    assert.strictEqual(inputs[2].offset, 50, "補完取得で次ページのoffsetがずれないこと");
    assert.strictEqual(tickets.filter((t) => t.id === 55).length, 1, "重複排除されること");
    assert.strictEqual(tickets.length, 53);
    assert.strictEqual(store.getState().hasMoreTickets, false);
  });

  test("DashboardTicketService.loadTickets: 補完のみで全件揃った場合はhasMoreTicketsがfalseになる", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [];
    let totalCount = 0;

    const firstPage = Array.from({ length: 50 }, (_, index) => makeTicket(index + 1));
    const service = new DashboardTicketService({
      context: makeContext(store),
      getResolvedProject: () => ({ id: 1, name: "Project #1" }),
      getTickets: () => tickets,
      setTickets: (next) => { tickets = next; },
      getTotalCount: () => totalCount,
      setTotalCount: (next) => { totalCount = next; },
      getSettings: () => structuredClone(DEFAULT_TICKET_LIST_SETTINGS),
      loadComments: async () => undefined,
      refreshUnsynced: () => undefined,
      listIssues: async (input) => {
        if (input.issueIds) {
          return { tickets: [makeTicket(51)], totalCount: 1, limit: input.limit, offset: 0 };
        }
        return { tickets: firstPage, totalCount: 51, limit: input.limit, offset: 0 };
      },
    });

    await service.loadTickets(false, { ensureTicketIds: [51] });
    assert.strictEqual(tickets.length, 51);
    assert.strictEqual(store.getState().hasMoreTickets, false);
  });

  test("DashboardTicketService.loadTickets: 先頭ページに既に含まれていれば追加問い合わせしない", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [];
    let totalCount = 0;
    let calls = 0;

    const service = new DashboardTicketService({
      context: makeContext(store),
      getResolvedProject: () => ({ id: 1, name: "Project #1" }),
      getTickets: () => tickets,
      setTickets: (next) => { tickets = next; },
      getTotalCount: () => totalCount,
      setTotalCount: (next) => { totalCount = next; },
      getSettings: () => structuredClone(DEFAULT_TICKET_LIST_SETTINGS),
      loadComments: async () => undefined,
      refreshUnsynced: () => undefined,
      listIssues: async (input) => {
        calls++;
        return { tickets: [makeTicket(1), makeTicket(2)], totalCount: 2, limit: input.limit, offset: 0 };
      },
    });

    await service.loadTickets(false, { ensureTicketIds: [2] });
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(tickets.map((t) => t.id), [1, 2]);
  });

  test("DashboardTicketService.loadTickets: プロジェクト未選択時でもensureTicketIdsを取得・表示する", async () => {
    const store = new DashboardStateStore();
    let tickets: Ticket[] = [];
    let totalCount = 0;

    const service = new DashboardTicketService({
      context: makeContext(store),
      getResolvedProject: () => undefined,
      getTickets: () => tickets,
      setTickets: (next) => { tickets = next; },
      getTotalCount: () => totalCount,
      setTotalCount: (next) => { totalCount = next; },
      getSettings: () => structuredClone(DEFAULT_TICKET_LIST_SETTINGS),
      loadComments: async () => undefined,
      refreshUnsynced: () => undefined,
      listIssues: async (input) => {
        assert.deepStrictEqual(input.issueIds, [77]);
        return { tickets: [makeTicket(77, 9)], totalCount: 1, limit: input.limit, offset: 0 };
      },
    });

    await service.loadTickets(false, { ensureTicketIds: [77] });
    assert.strictEqual(store.getState().selectedProject, undefined);
    assert.deepStrictEqual(store.getState().tickets.map((t) => t.id), [77]);
    assert.strictEqual(store.getState().hasMoreTickets, false);
  });

  test("DashboardController.revealCreatedTickets: 超過プロジェクトでも一覧に表示し詳細選択状態にする", async () => {
    const store = new DashboardStateStore();
    const controller = new DashboardController({
      store,
      notifyOperationStarted: () => undefined,
      notifySuccess: () => undefined,
      notifyError: () => undefined,
      notifyToast: () => undefined,
      onTicketsRefreshed: () => undefined,
    });
    controller["projectService"].getResolvedProject = () => ({ id: 1, name: "Project #1" });
    controller["projectService"].loadProjects = async () => {
      controller["cache"].projects = [{ id: 1, name: "Project #1", identifier: "p1", level: 0 }];
    };
    controller["dataService"].loadMetadataOptions = async () => {
      controller["dataService"]["metadataOptionsLoaded"] = true;
      store.update({
        metadataOptions: {
          trackers: [{ id: 1, name: "Task" }],
          priorities: [{ id: 2, name: "Normal" }],
          statuses: [{ id: 1, name: "New", isClosed: false }],
        },
      });
    };
    controller["commentService"].loadComments = async () => undefined;
    controller["metadataService"].loadEditOptions = async () => undefined;
    controller["ticketService"]["deps"].listIssues = async (input) => {
      if (input.issueIds?.includes(120)) {
        return { tickets: [makeTicket(120, 1)], totalCount: 1, limit: input.limit, offset: 0 };
      }
      return {
        tickets: Array.from({ length: 50 }, (_, index) => makeTicket(index + 1, 1)),
        totalCount: 60,
        limit: input.limit,
        offset: 0,
      };
    };

    try {
      await controller.revealCreatedTickets([120], { connectionScope: scope });

      assert.strictEqual(store.getState().selectedTicketId, 120);
      assert.strictEqual(store.getState().selectedTicket?.id, 120);
      assert.deepStrictEqual(store.getState().workPanel, { mode: "detail", ticketId: 120 });
      assert.ok(store.getState().tickets.some((t) => t.id === 120));
    } finally {
      controller.dispose();
    }
  });

  test("DashboardController.revealCreatedTickets: スコープ不一致・他プロジェクト・フィルター除外時は選択しない", async () => {
    const store = new DashboardStateStore();
    let listCalls = 0;
    const settings: TicketListSettings = structuredClone(DEFAULT_TICKET_LIST_SETTINGS);
    settings.filters.statusIds = [1];

    const controller = new DashboardController({
      store,
      notifyOperationStarted: () => undefined,
      notifySuccess: () => undefined,
      notifyError: () => undefined,
      notifyToast: () => undefined,
      onTicketsRefreshed: () => undefined,
    });
    controller["projectService"].getResolvedProject = () => ({ id: 1, name: "Project #1" });
    controller["projectService"].loadProjects = async () => {
      controller["cache"].projects = [{ id: 1, name: "Project #1", identifier: "p1", level: 0 }];
    };
    controller["dataService"].loadMetadataOptions = async () => {
      controller["dataService"]["metadataOptionsLoaded"] = true;
    };
    controller["ticketService"]["deps"].getSettings = () => settings;
    controller["ticketService"]["deps"].listIssues = async (input) => {
      listCalls++;
      if (input.issueIds?.includes(200)) {
        return { tickets: [], totalCount: 0, limit: input.limit, offset: 0 };
      }
      if (input.issueIds?.includes(201)) {
        return { tickets: [makeTicket(201, 1, { statusId: 9, statusName: "Other" })], totalCount: 1, limit: input.limit, offset: 0 };
      }
      return { tickets: [makeTicket(1, 1)], totalCount: 1, limit: input.limit, offset: 0 };
    };

    try {
      await controller.revealCreatedTickets([200], { connectionScope: "https://different-scope.example/" });
      assert.strictEqual(listCalls, 0);
      assert.strictEqual(store.getState().selectedTicketId, undefined);

      await controller.revealCreatedTickets([200], { connectionScope: scope });
      assert.strictEqual(store.getState().selectedTicketId, undefined);

      await controller.revealCreatedTickets([201], { connectionScope: scope });
      assert.strictEqual(store.getState().selectedTicketId, undefined);
      assert.ok(!store.getState().tickets.some((t) => t.id === 201));
    } finally {
      controller.dispose();
    }
  });

  test("DashboardController.revealCreatedTickets: 一覧取得中の接続切り替え後は同じIDを選択しない", async () => {
    const config = vscode.workspace.getConfiguration("redmine-client");
    const previousBaseUrl = config.inspect<unknown>("baseUrl")?.globalValue;
    const store = new DashboardStateStore();
    const controller = new DashboardController({
      store,
      notifyOperationStarted: () => undefined,
      notifySuccess: () => undefined,
      notifyError: () => undefined,
      notifyToast: () => undefined,
      onTicketsRefreshed: () => undefined,
    });
    let releaseLoad: () => void = () => undefined;
    let markLoadStarted: () => void = () => undefined;
    const loadStarted = new Promise<void>((resolve) => { markLoadStarted = resolve; });
    const loadReleased = new Promise<void>((resolve) => { releaseLoad = resolve; });
    let selectCalls = 0;
    controller["cache"].projects = [{ id: 1, name: "Project", identifier: "p1", level: 0 }];
    controller["dataService"].loadMetadataOptions = async () => undefined;
    controller["ticketService"].loadTickets = async () => {
      markLoadStarted();
      await loadReleased;
    };
    controller["ticketService"].selectTicket = async () => { selectCalls++; };

    try {
      await config.update("baseUrl", "https://old-redmine.example.com", vscode.ConfigurationTarget.Global);
      const oldScope = getCurrentConnectionScope();
      const reveal = controller.revealCreatedTickets([120], { connectionScope: oldScope });
      await loadStarted;
      await config.update("baseUrl", "https://new-redmine.example.com", vscode.ConfigurationTarget.Global);
      store.update({
        tickets: [{ id: 120, subject: "New connection ticket", syncState: "Synced", children: [], level: 0 }],
        selectedTicketId: 42,
      });
      releaseLoad();
      await reveal;

      assert.strictEqual(selectCalls, 0);
      assert.strictEqual(store.getState().selectedTicketId, 42);
    } finally {
      releaseLoad();
      controller.dispose();
      await config.update("baseUrl", previousBaseUrl, vscode.ConfigurationTarget.Global);
    }
  });

  test("DashboardUnsyncedService: 単件/一括の新規作成同期は revealCreatedTickets を呼び onTicketsRefreshed を二重発火しない", async () => {
    const store = new DashboardStateStore();
    const notices: string[] = [];
    const revealedCalls: number[][] = [];
    let refreshedCalls = 0;

    const first = await addOfflineNewTicketAsync({
      content: buildTicketEditorContent({
        subject: "Unsynced New 1",
        description: "Body",
        metadata: buildIssueMetadataFixture(),
        controlFields: { mode: "new-ticket", issue_id: null, project_id: 1 },
      }),
      projectId: 1,
      documentUri: "file:///tmp/unsynced-new-1.md",
    }, scope);

    const engine = createSyncEngine({
      tickets: {
        listIssueStatuses: async () => [{ id: 1, name: "In Progress" }],
        getProjectTrackers: async () => [{ id: 2, name: "Task" }],
        listIssuePriorities: async () => [{ id: 3, name: "Normal" }],
        createIssue: async () => 501,
        getIssueDetail: async () => ({
          ticket: makeTicket(501, 1, { subject: "Unsynced New 1" }),
          comments: [],
        }),
      },
      documents: {
        rewriteNewTicket: async () => ({ kind: "applied" }),
        findOpenDocument: () => undefined,
      },
    });

    const service = new DashboardUnsyncedService({
      context: {
        store,
        notifyOperationStarted: () => undefined,
        notifySuccess: (_id, msg) => notices.push(msg),
        notifyError: (_id, msg) => assert.fail(msg),
        notifyToast: () => undefined,
        onTicketsRefreshed: () => { refreshedCalls++; },
      },
      refreshTicketPresentation: () => undefined,
      loadComments: async () => undefined,
      revealCreatedTickets: async (ids) => {
        revealedCalls.push([...ids]);
      },
      syncEngine: engine,
    });

    await service.handleSyncOne("req-one", {
      kind: "newTicket",
      queueId: first.queueId,
      documentUri: first.documentUri,
    });

    assert.deepStrictEqual(revealedCalls, [[501]]);
    assert.strictEqual(refreshedCalls, 0);
    assert.strictEqual(notices.length, 1);

    const second = await addOfflineNewTicketAsync({
      content: buildTicketEditorContent({
        subject: "Unsynced New 2",
        description: "Body",
        metadata: buildIssueMetadataFixture(),
        controlFields: { mode: "new-ticket", issue_id: null, project_id: 1 },
      }),
      projectId: 1,
      documentUri: "file:///tmp/unsynced-new-2.md",
    }, scope);

    let nextCreatedId = 600;
    const allEngine = createSyncEngine();
    allEngine.syncAll = async () => ({
      plan: [{ kind: "newTicket", queueId: second.queueId, documentUri: second.documentUri }],
      results: [{
        key: { kind: "newTicket", queueId: second.queueId, documentUri: second.documentUri },
        outcome: { kind: "completed", ticketId: ++nextCreatedId },
      }],
      remaining: [],
      cancelled: false,
      stopReason: "completed",
    });

    const allService = new DashboardUnsyncedService({
      context: {
        store,
        notifyOperationStarted: () => undefined,
        notifySuccess: (_id, msg) => notices.push(msg),
        notifyError: (_id, msg) => assert.fail(msg),
        notifyToast: () => undefined,
        onTicketsRefreshed: () => { refreshedCalls++; },
      },
      refreshTicketPresentation: () => undefined,
      loadComments: async () => undefined,
      revealCreatedTickets: async (ids) => {
        revealedCalls.push([...ids]);
      },
      syncEngine: allEngine,
    });

    await allService.handleSyncAll("req-all");

    assert.strictEqual(revealedCalls.length, 2);
    assert.deepStrictEqual(revealedCalls[1], [601]);
    assert.strictEqual(refreshedCalls, 0);
  });

  test("DashboardComposerService: コンポーザー同期は revealCreatedTickets を呼び onTicketsRefreshed を発火しない", async () => {
    const store = new DashboardStateStore();
    const draftUri = "untitled:redmine-client-new-ticket-composer.md";
    store.update({
      workPanel: {
        mode: "newTicket",
        loading: false,
        projectId: 1,
        projectName: "Project #1",
        trackers: [{ id: 1, name: "Task" }],
        priorities: [{ id: 2, name: "Normal" }],
        statuses: [{ id: 1, name: "New" }],
        assignees: [],
        values: {
          subject: "",
          tracker: "Task",
          priority: "Normal",
          status: "New",
          start_date: "",
          due_date: "",
          description: "",
        },
        draftUri,
      },
    });

    let refreshedCalls = 0;
    const revealedCalls: Array<{ ids: number[]; scope?: string }> = [];
    const editor = createMutableEditorStub(vscode.Uri.parse(draftUri), "# Composer Subject");

    const service = new DashboardComposerService({
      context: makeContext(store, () => { refreshedCalls++; }),
      getResolvedProject: () => ({ id: 1, name: "Project #1" }),
      getTickets: () => [],
      refreshUnsynced: () => undefined,
      loadTickets: async () => undefined,
      selectTicket: async () => undefined,
      revealCreatedTickets: async (ids, options) => {
        revealedCalls.push({ ids: [...ids], scope: options?.connectionScope });
      },
    });

    await service.handleSyncNewTicketDraftFromComposer("req-comp", {
      findEditorFn: () => editor,
      syncFn: async () => ({ status: "created", message: "Ticket created." }),
      getTicketIdFn: () => 712,
    });

    assert.deepStrictEqual(revealedCalls, [{ ids: [712], scope }]);
    assert.strictEqual(refreshedCalls, 0);
    assert.strictEqual(store.getState().workPanel, undefined);
  });

  test("saveSyncExecutor(auto) と syncController.syncEditorAndNotify: 作成後に revealCreatedTickets を1回呼び失敗しても通知を壊さない", async () => {
    const uri = vscode.Uri.parse("file:///tmp/redmine-client-new-ticket-save.md");
    const content = buildTicketEditorContent({
      subject: "Auto Save Create",
      description: "Body",
      metadata: buildIssueMetadataFixture(),
      controlFields: { mode: "new-ticket", project_id: 12, issue_id: null },
    });
    const editor = createMutableEditorStub(uri, content);
    registerNewTicketDraft(editor, scope);
    setEditorProjectId(editor, 12);

    const revealedAuto: Array<{ ids: number[]; scope?: string }> = [];
    let autoRefreshCalls = 0;
    const savedStatuses: string[] = [];

    const autoPresentation: TicketPresentationPort = {
      refresh: () => { autoRefreshCalls++; },
      notifyChange: () => undefined,
      updateTicketSubject: () => undefined,
      setSelectedProjectId: async () => undefined,
      revealCreatedTickets: async (ids, connectionScope) => {
        revealedAuto.push({ ids: [...ids], scope: connectionScope });
        throw new Error("UI unavailable");
      },
    };
    const noopComments: CommentPresentationPort = {
      refresh: () => undefined,
      refreshForTicket: () => undefined,
    };
    const noopUnsynced: UnsyncedPresentationPort = {
      refresh: () => undefined,
    };
    const notifications = {
      notifyTicketSaveResult: (result: { status: string }) => { savedStatuses.push(result.status); },
      notifyCommentSaveResult: () => undefined,
    } as unknown as NotificationController;

    await performSyncOnSave(editor.document, editor, {
      ticketsPresentation: autoPresentation,
      commentsPresentation: noopComments,
      unsyncedPresentation: noopUnsynced,
      notifications,
      updateTicketListSubject: () => undefined,
      offlineSyncMode: "auto",
      syncEngine: createSyncEngine({
        tickets: {
          syncQueueItem: async () => ({ kind: "completed", ticketId: 801 }),
          syncAll: async () => ({ plan: [], results: [], remaining: [], cancelled: false }),
          resolveCommitUnknown: async () => ({ kind: "completed", ticketId: 801 }),
        },
      }),
    });

    assert.deepStrictEqual(revealedAuto, [{ ids: [801], scope }]);
    assert.strictEqual(autoRefreshCalls, 0);
    assert.deepStrictEqual(savedStatuses, ["queued"]);

    const revealedExplicit: Array<{ ids: number[]; scope?: string }> = [];
    let explicitRefreshCalls = 0;
    const explicitController = createSyncController({
      ticketsPresentation: {
        refresh: () => { explicitRefreshCalls++; },
        notifyChange: () => undefined,
        updateTicketSubject: () => undefined,
        setSelectedProjectId: async () => undefined,
        revealCreatedTickets: async (ids, connectionScope) => {
          revealedExplicit.push({ ids: [...ids], scope: connectionScope });
        },
      },
      commentsPresentation: noopComments,
      unsyncedPresentation: noopUnsynced,
      notifications,
      registerEditorDocument: () => undefined,
      syncEngine: {
        syncOne: async () => ({ kind: "completed", ticketId: 802 }),
        syncTicketEditor: async () => ({ kind: "completed", ticketId: 802 }),
      },
    });

    const status = await explicitController.syncEditorAndNotify(editor);
    assert.strictEqual(status, "uploaded");
    assert.deepStrictEqual(revealedExplicit, [{ ids: [802], scope }]);
    assert.strictEqual(explicitRefreshCalls, 0);
    assert.deepStrictEqual(savedStatuses, ["queued", "created"]);
  });
});
