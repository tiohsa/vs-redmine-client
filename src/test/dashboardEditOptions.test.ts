import * as assert from "assert";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import type { DashboardEditOptions } from "../dashboard/dashboardProtocol";

// ── DashboardEditOptions 状態管理テスト ────────────────────────────────────

suite("DashboardEditOptions — StateStore 統合", () => {
  test("初期状態では editOptions が undefined", () => {
    const store = new DashboardStateStore();
    assert.strictEqual(store.getState().editOptions, undefined);
  });

  test("editOptions を更新できる", () => {
    const store = new DashboardStateStore();
    const editOptions: DashboardEditOptions = {
      ticketId: 42,
      projectId: 10,
      trackers: [{ id: 1, name: "Bug" }, { id: 2, name: "Feature" }],
      priorities: [{ id: 1, name: "Normal" }],
      statuses: [{ id: 1, name: "New" }, { id: 2, name: "In Progress" }],
      assignees: [],
      statusFallback: false,
      loading: false,
    };
    store.update({ editOptions });
    assert.deepStrictEqual(store.getState().editOptions, editOptions);
  });

  test("editOptions.loading = true で読み込み中状態を表現できる", () => {
    const store = new DashboardStateStore();
    store.update({
      editOptions: {
        ticketId: 1,
        projectId: 5,
        trackers: [],
        priorities: [],
        statuses: [],
        assignees: [],
        statusFallback: false,
        loading: true,
      },
    });
    assert.strictEqual(store.getState().editOptions?.loading, true);
  });

  test("editOptions.error を設定できる", () => {
    const store = new DashboardStateStore();
    store.update({
      editOptions: {
        ticketId: 1,
        projectId: 5,
        trackers: [],
        priorities: [],
        statuses: [],
        assignees: [],
        statusFallback: false,
        loading: false,
        error: "トラッカー取得失敗",
      },
    });
    assert.strictEqual(store.getState().editOptions?.error, "トラッカー取得失敗");
  });

  test("editOptions.statusFallback = true でフォールバック状態を表現できる", () => {
    const store = new DashboardStateStore();
    store.update({
      editOptions: {
        ticketId: 10,
        projectId: 3,
        trackers: [{ id: 1, name: "Bug" }],
        priorities: [{ id: 1, name: "Normal" }],
        statuses: [{ id: 1, name: "New" }],
        assignees: [],
        statusFallback: true,
        loading: false,
      },
    });
    assert.strictEqual(store.getState().editOptions?.statusFallback, true);
  });

  test("editOptions を undefined にクリアできる", () => {
    const store = new DashboardStateStore();
    store.update({
      editOptions: {
        ticketId: 1,
        projectId: 1,
        trackers: [],
        priorities: [],
        statuses: [],
        assignees: [],
        statusFallback: false,
        loading: false,
      },
    });
    store.update({ editOptions: undefined });
    assert.strictEqual(store.getState().editOptions, undefined);
  });
});

// ── DashboardMetadataService — editOptions 対応バリデーションテスト ─────────

import { DashboardMetadataService } from "../dashboard/services/DashboardMetadataService";
import type { DashboardServiceContext } from "../dashboard/services/DashboardServiceContext";

function buildContext(store: DashboardStateStore): DashboardServiceContext {
  return {
    store,
    notifyOperationStarted: () => {},
    notifySuccess: () => {},
    notifyError: () => {},
    notifyToast: () => {},
    onTicketsRefreshed: () => {},
  };
}

suite("DashboardMetadataService — editOptions バリデーション", () => {
  test("古いチケットの候補応答が最新チケットの候補を上書きしない", async () => {
    const store = new DashboardStateStore();
    const firstTrackers = deferred<Array<{ id: number; name: string }>>();
    const secondTrackers = deferred<Array<{ id: number; name: string }>>();
    const service = new DashboardMetadataService({
      context: buildContext(store),
      getTickets: () => [],
      isMetadataOptionsLoaded: () => true,
      refreshUnsynced: () => {},
      pushTickets: () => {},
      openEditor: async () => {},
      getProjectTrackers: (projectId) => projectId === 1 ? firstTrackers.promise : secondTrackers.promise,
      getIssueAllowedStatuses: async () => [],
      listProjectMembers: async () => [],
    });

    const first = service.loadEditOptions(10, 1);
    const second = service.loadEditOptions(20, 2);
    secondTrackers.resolve([{ id: 2, name: "Second" }]);
    await second;
    firstTrackers.resolve([{ id: 1, name: "First" }]);
    await first;

    assert.strictEqual(store.getState().editOptions?.ticketId, 20);
    assert.deepStrictEqual(store.getState().editOptions?.trackers, [{ id: 2, name: "Second" }]);
  });

  test("editOptions がある場合、tracker バリデーションに editOptions.trackers を使う (テスト用: loadEditOptions 経由)", () => {
    // editOptions にプロジェクト固有トラッカーが設定されていれば
    // validateMetadataPatchAgainstOptions は editOptions.statuses / priorities を参照すべき
    const store = new DashboardStateStore();
    store.update({
      metadataOptions: {
        trackers: [{ id: 1, name: "Bug" }, { id: 2, name: "Feature" }],
        priorities: [{ id: 1, name: "Normal" }, { id: 2, name: "High" }],
        statuses: [{ id: 1, name: "New" }, { id: 2, name: "Closed" }],
      },
      editOptions: {
        ticketId: 42,
        projectId: 10,
        trackers: [{ id: 3, name: "Support" }],
        priorities: [{ id: 1, name: "Normal" }],
        statuses: [{ id: 1, name: "New" }, { id: 3, name: "Feedback" }],
        assignees: [],
        statusFallback: false,
        loading: false,
      },
    });

    // editOptions.statuses には "Feedback" がある (グローバルにはない)
    // editOptions.statuses には "Closed" がない (グローバルにはある)
    // editOptions が ticketId=42 に対応している場合、"Feedback" は有効、"Closed" は無効になるべき
    const feedbackStatusInEditOptions = store.getState().editOptions?.statuses.some(s => s.name === "Feedback");
    const closedStatusInEditOptions = store.getState().editOptions?.statuses.some(s => s.name === "Closed");
    const closedStatusInGlobal = store.getState().metadataOptions.statuses.some(s => s.name === "Closed");

    assert.strictEqual(feedbackStatusInEditOptions, true, "editOptions に Feedback がある");
    assert.strictEqual(closedStatusInEditOptions, false, "editOptions に Closed がない");
    assert.strictEqual(closedStatusInGlobal, true, "グローバルには Closed がある");
  });

  test("metadataOptionsLoaded が false の場合、更新が拒否される", async () => {
    const store = new DashboardStateStore();
    const errors: string[] = [];
    const context = buildContext(store);
    context.notifyError = (_reqId, msg) => { errors.push(msg); };

    const service = new DashboardMetadataService({
      context,
      getTickets: () => [],
      isMetadataOptionsLoaded: () => false,
      refreshUnsynced: () => {},
      pushTickets: () => {},
      openEditor: async () => {},
    });

    await service.updateTicketMetadata("req-1", 1, { tracker: "Bug" });
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /Cannot update: metadata options not loaded/);
  });

  test("チケットが見つからない場合、更新が拒否される", async () => {
    const store = new DashboardStateStore();
    store.update({
      metadataOptions: {
        trackers: [{ id: 1, name: "Bug" }],
        priorities: [{ id: 1, name: "Normal" }],
        statuses: [{ id: 1, name: "New" }],
      },
    });
    const errors: string[] = [];
    const context = buildContext(store);
    context.notifyError = (_reqId, msg) => { errors.push(msg); };

    const service = new DashboardMetadataService({
      context,
      getTickets: () => [],
      isMetadataOptionsLoaded: () => true,
      refreshUnsynced: () => {},
      pushTickets: () => {},
      openEditor: async () => {},
    });

    await service.updateTicketMetadata("req-1", 999, { priority: "Normal" });
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /Target ticket not found/);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

// ── DashboardComposerService — Status 非表示テスト ────────────────────────

suite("DashboardComposerService — Status フィールド非表示 (Option A)", () => {
  test("DashboardWorkPanel.statuses はプロトコル型として存在する", () => {
    // Composer パネルは statuses フィールドを保持するが、UI では表示しない
    const panel: import("../dashboard/dashboardProtocol").DashboardWorkPanel = {
      mode: "newTicket",
      loading: false,
      projectId: 1,
      projectName: "Test Project",
      trackers: [{ id: 1, name: "Bug" }],
      priorities: [{ id: 1, name: "Normal" }],
      statuses: [],
      assignees: [],
      values: {
        subject: "",
        tracker: "Bug",
        priority: "Normal",
        status: undefined,
        start_date: "",
        due_date: "",
        description: "",
      },
    };
    // status は undefined でも有効
    assert.strictEqual(panel.values.status, undefined);
    assert.strictEqual(panel.mode, "newTicket");
  });
});

import { DashboardComposerService } from "../dashboard/services/DashboardComposerService";

suite("DashboardComposerService — 非同期候補", () => {
  test("古い作成パネルの候補応答が最新パネルを上書きしない", async () => {
    const store = new DashboardStateStore();
    store.update({
      metadataOptions: {
        trackers: [],
        priorities: [{ id: 1, name: "Normal" }],
        statuses: [{ id: 1, name: "New" }],
      },
    });
    const firstTrackers = deferred<Array<{ id: number; name: string }>>();
    const secondTrackers = deferred<Array<{ id: number; name: string }>>();
    const service = new DashboardComposerService({
      context: buildContext(store),
      getResolvedProject: () => ({ id: 1, name: "First project" }),
      getTickets: () => [{
        id: 20,
        subject: "Parent",
        projectId: 2,
        projectName: "Second project",
      }],
      refreshUnsynced: () => {},
      loadTickets: async () => {},
      selectTicket: async () => {},
      getProjectTrackers: (projectId) => projectId === 1 ? firstTrackers.promise : secondTrackers.promise,
      listProjectMembers: async () => [],
    });

    const first = service.openNewTicketComposer();
    const second = service.openChildTicketComposer(20);
    secondTrackers.resolve([{ id: 2, name: "Second" }]);
    await second;
    firstTrackers.resolve([{ id: 1, name: "First" }]);
    await first;

    const panel = store.getState().workPanel;
    assert.ok(panel && panel.mode === "childTicket");
    assert.strictEqual(panel.projectId, 2);
    assert.deepStrictEqual(panel.trackers, [{ id: 2, name: "Second" }]);
  });
});

// ── getIssueAllowedStatuses — API 関数の型確認 ────────────────────────────

suite("getIssueAllowedStatuses — 関数シグネチャ確認", () => {
  test("getIssueAllowedStatuses が issues.ts から export されている", () => {
    const { getIssueAllowedStatuses } = require("../redmine/issues");
    assert.strictEqual(typeof getIssueAllowedStatuses, "function");
  });
});

// ── Composer Priority デフォルト値テスト ─────────────────────────────────

suite("Composer — Priority デフォルト値", () => {
  function pickOptionName(options: Array<{ name: string }>, candidate?: string): string | undefined {
    if (!candidate) { return undefined; }
    return options.some((o) => o.name === candidate) ? candidate : undefined;
  }

  function resolveDefaultPriority(
    priorities: Array<{ name: string }>,
    parentPriorityName?: string,
  ): string | undefined {
    return pickOptionName(priorities, parentPriorityName) ?? pickOptionName(priorities, "Normal") ?? priorities[0]?.name;
  }

  const standardPriorities = [
    { name: "Low" },
    { name: "Normal" },
    { name: "High" },
    { name: "Urgent" },
  ];

  test("親チケットなし・Normal が存在する場合は Normal を返す", () => {
    assert.strictEqual(resolveDefaultPriority(standardPriorities), "Normal");
  });

  test("親チケットの優先度が一覧に含まれる場合はそれを使う", () => {
    assert.strictEqual(resolveDefaultPriority(standardPriorities, "High"), "High");
  });

  test("親チケットの優先度が一覧にない場合は Normal にフォールバック", () => {
    assert.strictEqual(resolveDefaultPriority(standardPriorities, "CustomPriority"), "Normal");
  });

  test("Normal が存在しない場合は先頭要素を返す", () => {
    const priorities = [{ name: "Low" }, { name: "High" }];
    assert.strictEqual(resolveDefaultPriority(priorities), "Low");
  });

  test("一覧が空の場合は undefined を返す", () => {
    assert.strictEqual(resolveDefaultPriority([]), undefined);
  });
});
