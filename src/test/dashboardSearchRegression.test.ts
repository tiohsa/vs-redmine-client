import * as assert from "assert";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import type { DashboardWorkPanel } from "../dashboard/dashboardProtocol";
import type { IssuesListInput, IssuesListResult } from "../redmine/issues";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const page = (ids: number[], totalCount = ids.length, offset = 0): IssuesListResult => ({
  tickets: ids.map(id => ({ id, subject: `Ticket ${id}`, projectId: 1 })), totalCount, offset, limit: 50,
});
const fixture = (listIssues: (input: IssuesListInput) => Promise<IssuesListResult>) => {
  const store = new DashboardStateStore();
  const events: string[] = [];
  const controller = new DashboardController({
    store, notifyOperationStarted: () => undefined,
    notifySuccess: (_id, message) => events.push(`success:${message}`),
    notifyError: (_id, message) => events.push(`error:${message}`),
    notifyToast: () => undefined, onTicketsRefreshed: () => undefined,
    _maintenanceTestHooks: { confirmDashboardCacheReset: async () => true },
  });
  controller["projectService"].getResolvedProject = () => ({ id: 1, name: "Project" });
  controller["loadProjects"] = async () => undefined;
  controller["loadMetadataOptions"] = async () => undefined;
  controller["refreshUnsynced"] = () => undefined;
  const service = controller["ticketService"];
  service["deps"].listIssues = listIssues;
  return { controller, service, store, events };
};

suite("Dashboard 検索の状態保持", () => {
  for (const mode of ["newTicket", "childTicket"] as const) {
    test(`${mode} の未保存フォームを検索開始・0件・失敗・解除で保持する`, async () => {
      const pending = deferred<IssuesListResult>();
      const { controller, service, store } = fixture(async input => {
        if (input.subjectQuery === "failure" || input.descriptionQuery === "failure") { throw new Error("offline"); }
        return pending.promise;
      });
      try {
        const panel: DashboardWorkPanel = {
          mode, projectId: 1, projectName: "Project", parentTicketId: 10, parentSubject: "Parent",
          loading: false, trackers: [], priorities: [], statuses: [], assignees: [],
          values: { subject: "未保存の件名", description: "未保存の本文", tracker: "Bug", priority: "High", start_date: "2026-10-24", due_date: "2026-10-31" },
          draftUri: "file:///tmp/composer-draft.md",
        };
        store.update({ workPanel: panel, selectedTicketId: 10 });
        // 一覧更新で元の選択行が消えても作成中フォームは閉じない。
        service.pushTickets();
        assert.deepStrictEqual(store.getState().workPanel, panel);
        const search = service.searchTickets("empty", { kind: "project", projectId: 1 });
        assert.strictEqual(store.getState().loading.tickets, true);
        assert.deepStrictEqual(store.getState().workPanel, panel);
        pending.resolve(page([]));
        await search;
        assert.deepStrictEqual(store.getState().workPanel, panel);
        await service.searchTickets("failure");
        assert.match(store.getState().errors.tickets ?? "", /offline/);
        assert.deepStrictEqual(store.getState().workPanel, panel);
        await service.searchTickets("");
        assert.deepStrictEqual(store.getState().workPanel, panel);
        assert.strictEqual(store.getState().ticketSearch?.query, "");
      } finally { controller.dispose(); }
    });
  }

  test("古い範囲の検索要求はコメントと編集候補の取得を無効化しない", async () => {
    const { controller, store } = fixture(async () => page([]));
    const trackers = deferred<Array<{ id: number; name: string }>>();
    const comments = controller["commentService"];
    const metadata = controller["metadataService"];
    let commentInvalidations = 0;
    const invalidateComments = comments.invalidate.bind(comments);
    comments.invalidate = () => { commentInvalidations++; invalidateComments(); };
    metadata["deps"].getProjectTrackers = () => trackers.promise;
    metadata["deps"].getIssueAllowedStatuses = async () => [];
    metadata["deps"].listProjectMembers = async () => [];
    try {
      store.update({ selectedTicketId: 10, workPanel: { mode: "detail", ticketId: 10 }, comments: { ticketId: 10, loading: true, items: [] } });
      const loading = metadata.loadEditOptions(10, 1);
      for (const scope of [{ kind: "project", projectId: 2 }, { kind: "all" }] as const) {
        await controller.handle({ type: "tickets.search", query: "stale", scope, requestId: "stale" });
      }
      assert.strictEqual(commentInvalidations, 0);
      assert.strictEqual(store.getState().selectedTicketId, 10);
      assert.strictEqual(store.getState().comments.loading, true);
      trackers.resolve([{ id: 1, name: "Bug" }]);
      await loading;
      assert.strictEqual(store.getState().editOptions?.loading, false);
      assert.deepStrictEqual(store.getState().editOptions?.trackers, [{ id: 1, name: "Bug" }]);
      await controller.handle({ type: "tickets.search", query: "valid", scope: { kind: "project", projectId: 1 }, requestId: "valid" });
      assert.strictEqual(commentInvalidations, 1);
      assert.strictEqual(store.getState().workPanel, undefined);
    } finally { controller.dispose(); }
  });

  for (const query of ["", "123"]) {
    for (const fails of [false, true]) {
      test(`${query ? "検索結果" : "通常一覧"}のキャッシュ再取得${fails ? "失敗時は取得位置を復元する" : "成功時は条件を保持する"}`, async () => {
        const inputs: IssuesListInput[] = [];
        const { controller, service, store, events } = fixture(async input => {
          inputs.push(input);
          if (input.issueIds) { return page([123]); }
          return input.descriptionQuery
            ? page([100 + input.offset, 101 + input.offset], 6, input.offset)
            : page([10 + input.offset], 3, input.offset);
        });
        try {
          await service.searchTickets(query);
          await service.loadMoreTickets();
          const before = structuredClone(store.getState());
          if (fails) { controller["loadMetadataOptions"] = async () => { throw new Error("metadata offline"); }; }
          inputs.length = 0;
          await controller.handle({ type: "dashboard.resetCache", requestId: "reset" });
          assert.deepStrictEqual(store.getState().ticketSearch, before.ticketSearch);
          assert.ok(inputs.every(input => input.offset === 0 && input.projectId === 1));
          assert.ok(inputs.every(input => query ? input.issueIds || (input.subjectQuery ?? input.descriptionQuery) === query : !input.subjectQuery && !input.descriptionQuery));
          assert.strictEqual(store.getState().loading.tickets, false);
          assert.strictEqual(store.getState().loading.moreTickets, false);
          if (fails) {
            assert.ok(events.some(event => event.includes("metadata offline")));
            assert.deepStrictEqual(store.getState().tickets, before.tickets);
            assert.strictEqual(store.getState().hasMoreTickets, before.hasMoreTickets);
          } else { assert.ok(events.some(event => event.startsWith("success:"))); }
          inputs.length = 0;
          await service.loadMoreTickets();
          assert.deepStrictEqual(inputs.map(input => input.offset), query ? (fails ? [2, 4] : [1, 2]) : [fails ? 2 : 1]);
          if (query) { assert.strictEqual(store.getState().tickets[0].id, 123, "直接ID一致の優先表示も保持"); }
        } finally { controller.dispose(); }
      });
    }
  }

  test("キャッシュ再取得中の新しい検索を古い失敗で巻き戻さない", async () => {
    const projects = deferred<void>();
    const started = deferred<void>();
    const { controller, service, store } = fixture(async input => page([input.subjectQuery === "new" ? 2 : 1]));
    try {
      await service.searchTickets("old");
      controller["loadProjects"] = () => { started.resolve(); return projects.promise; };
      const reset = controller.handle({ type: "dashboard.resetCache", requestId: "reset" });
      await started.promise;
      await service.searchTickets("new");
      const before = structuredClone(store.getState());
      projects.reject(new Error("old reset failed"));
      await reset;
      assert.deepStrictEqual(store.getState(), before);
    } finally { controller.dispose(); }
  });

  test("キャッシュ再取得失敗後も旧追加取得の応答を復活させない", async () => {
    const oldPage = deferred<IssuesListResult>();
    const newPage = deferred<IssuesListResult>();
    let pageRequests = 0;
    const { controller, service, store } = fixture(async input => {
      if (!input.offset) { return page([1], 3); }
      assert.strictEqual(input.offset, 1);
      return ++pageRequests === 1 ? oldPage.promise : newPage.promise;
    });
    try {
      await service.loadTickets();
      const oldLoad = service.loadMoreTickets();
      controller["loadMetadataOptions"] = async () => { throw new Error("metadata offline"); };
      await controller.handle({ type: "dashboard.resetCache", requestId: "reset" });
      assert.strictEqual(store.getState().loading.moreTickets, false);
      const newLoad = service.loadMoreTickets();
      oldPage.resolve(page([99], 3, 1));
      await oldLoad;
      assert.deepStrictEqual(store.getState().tickets.map(ticket => ticket.id), [1]);
      assert.strictEqual(store.getState().loading.moreTickets, true);
      newPage.resolve(page([2], 3, 1));
      await newLoad;
      assert.deepStrictEqual(store.getState().tickets.map(ticket => ticket.id), [1, 2]);
      assert.strictEqual(store.getState().loading.moreTickets, false);
    } finally { controller.dispose(); }
  });

  test("追加取得は既存一覧を残し、失敗時は同じページを再取得する", async () => {
    const next = deferred<IssuesListResult>();
    const inputs: IssuesListInput[] = [];
    let retry = false;
    const { controller, service, store } = fixture(async input => {
      inputs.push(input);
      if (!input.offset) { return page([1], 2); }
      return retry ? page([2], 2, 1) : next.promise;
    });
    try {
      await service.loadTickets();
      const rows = structuredClone(store.getState().tickets);
      const loading = service.loadMoreTickets();
      assert.strictEqual(service.loadMoreTickets(), loading);
      assert.strictEqual(store.getState().loading.tickets, false);
      assert.strictEqual(store.getState().loading.moreTickets, true);
      assert.deepStrictEqual(store.getState().tickets, rows);
      next.reject(new Error("temporary"));
      await loading;
      assert.strictEqual(store.getState().loading.moreTickets, false);
      assert.strictEqual(store.getState().errors.tickets, undefined);
      assert.match(store.getState().errors.moreTickets ?? "", /temporary/);
      assert.deepStrictEqual(store.getState().tickets, rows);
      retry = true;
      await service.loadMoreTickets();
      assert.deepStrictEqual(inputs.map(input => input.offset), [0, 1, 1]);
      assert.strictEqual(store.getState().errors.moreTickets, undefined);
      assert.deepStrictEqual(store.getState().tickets.map(ticket => ticket.id), [1, 2]);
    } finally { controller.dispose(); }
  });

  test("旧追加取得の失敗は新しい検索の追加取得状態を解除しない", async () => {
    const oldPage = deferred<IssuesListResult>();
    const newPage = deferred<IssuesListResult>();
    const { controller, service, store } = fixture(async input => {
      if (input.offset) { return input.subjectQuery || input.descriptionQuery ? newPage.promise : oldPage.promise; }
      return page([1], 2);
    });
    try {
      await service.loadTickets();
      const oldLoad = service.loadMoreTickets();
      await service.searchTickets("new");
      const newLoad = service.loadMoreTickets();
      oldPage.reject(new Error("stale"));
      await oldLoad;
      assert.strictEqual(store.getState().loading.moreTickets, true);
      assert.strictEqual(store.getState().errors.moreTickets, undefined);
      newPage.resolve(page([2], 2, 1));
      await newLoad;
      assert.strictEqual(store.getState().loading.moreTickets, false);
      assert.deepStrictEqual(store.getState().tickets.map(ticket => ticket.id), [1, 2]);
    } finally { controller.dispose(); }
  });
});
