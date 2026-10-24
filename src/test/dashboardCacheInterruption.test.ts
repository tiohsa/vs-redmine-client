import * as assert from "assert";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const options = [{ id: 1, name: "Normal" }];
const fixture = () => {
  const store = new DashboardStateStore();
  const events: Array<{ type: string; requestId: string; level?: string }> = [];
  const hooks = {
    listTrackers: async () => options,
    listIssuePriorities: async () => options,
    listIssueStatuses: async () => [{ id: 1, name: "Open", isClosed: false }],
    getCurrentUserId: async () => 7,
  };
  const controller = new DashboardController({
    store,
    notifyOperationStarted: requestId => { events.push({ type: "started", requestId }); },
    notifySuccess: (requestId, _message, level) => { events.push({ type: "success", requestId, level }); },
    notifyError: requestId => { events.push({ type: "error", requestId }); },
    notifyToast: () => undefined, onTicketsRefreshed: () => undefined,
    _metadataTestHooks: hooks,
    _maintenanceTestHooks: { confirmDashboardCacheReset: async () => true },
  });
  let projectId = 1;
  const service = controller["ticketService"];
  controller["projectService"].getResolvedProject = () => ({ id: projectId, name: `Project ${projectId}` });
  controller["projectService"].selectProject = async id => { projectId = id ?? 1; await service.loadTickets(); };
  controller["projectService"].resetForConnectionChange = async () => undefined;
  controller["initialize"] = async () => undefined;
  controller["loadProjects"] = async () => undefined;
  controller["refreshUnsynced"] = () => undefined;
  service["deps"].listIssues = async input => ({
    tickets: [{ id: (input.subjectQuery ?? input.descriptionQuery) === "new" ? 20 : 10, projectId, subject: "Ticket" }],
    totalCount: 1, offset: 0, limit: 50,
  });
  const assertEditable = () => assert.strictEqual(
    controller["metadataService"]["validateMetadataPatchAgainstOptions"]({ priority: "Normal" }), undefined,
  );
  const assertCanceled = () => assert.deepStrictEqual(events.filter(event => event.requestId === "reset"), [
    { type: "started", requestId: "reset" },
    { type: "success", requestId: "reset", level: "info" },
  ]);
  return { controller, service, store, hooks, events, assertEditable, assertCanceled };
};

suite("Dashboard キャッシュ再取得の中断", () => {
  for (const stage of ["projects", "tickets", "detail"] as const) {
    for (const rejects of [false, true]) {
      test(`${stage} 待機中の${rejects ? "プロジェクト切替と旧取得の失敗" : "検索確定"}でも一度だけ終了通知を送る`, async () => {
        const f = fixture();
        const reached = deferred<void>();
        const pending = deferred<void>();
        const wait = () => { reached.resolve(); return pending.promise; };
        try {
          await f.controller["loadMetadataOptions"](true);
          await f.service.searchTickets("old");
          f.store.update({ workPanel: { mode: "detail", ticketId: 10 }, selectedTicketId: 10 });
          if (stage === "projects") { f.controller["loadProjects"] = wait; }
          if (stage === "tickets") { f.controller["loadTickets"] = wait; }
          if (stage === "detail") { f.controller["selectTicket"] = wait; }
          const reset = f.controller.handle({ type: "dashboard.resetCache", requestId: "reset" });
          await reached.promise;
          if (rejects) {
            await f.controller.handle({ type: "project.select", projectId: 2, query: "new", requestId: "project" });
          } else {
            await f.controller.handle({ type: "tickets.search", query: "new", scope: { kind: "project", projectId: 1 }, requestId: "search" });
          }
          const current = structuredClone(f.store.getState());
          if (rejects) { pending.reject(new Error("stale failure")); }
          else { pending.resolve(); }
          await reset;
          assert.deepStrictEqual(f.store.getState().ticketSearch, current.ticketSearch);
          assert.deepStrictEqual(f.store.getState().tickets, current.tickets);
          assert.deepStrictEqual(f.store.getState().selectedProject, current.selectedProject);
          f.assertEditable();
          f.assertCanceled();
        } finally { f.controller.dispose(); }
      });
    }
  }

  test("プロジェクト待機中に中断しても進行中の初回メタデータ取得を無効化しない", async () => {
    const f = fixture();
    const trackers = deferred<typeof options>();
    const projects = deferred<void>();
    const reached = deferred<void>();
    f.hooks.listTrackers = () => trackers.promise;
    f.controller["loadProjects"] = () => { reached.resolve(); return projects.promise; };
    try {
      const initialMetadata = f.controller["loadMetadataOptions"](true);
      const reset = f.controller.handle({ type: "dashboard.resetCache", requestId: "reset" });
      await reached.promise;
      await f.service.searchTickets("new");
      projects.resolve();
      await reset;
      trackers.resolve(options);
      await initialMetadata;
      f.assertEditable();
      f.assertCanceled();
    } finally { f.controller.dispose(); }
  });

  for (const interrupted of [false, true]) {
    test(`メタデータ再取得失敗${interrupted ? "と検索による中断" : "での巻き戻し"}でも同じ接続の有効な属性候補を保持する`, async () => {
      const f = fixture();
      const trackers = deferred<typeof options>();
      const reached = deferred<void>();
      try {
        await f.controller["loadMetadataOptions"](true);
        const before = structuredClone(f.store.getState().metadataOptions);
        f.hooks.listTrackers = () => { reached.resolve(); return trackers.promise; };
        const reset = f.controller.handle({ type: "dashboard.resetCache", requestId: "reset" });
        await reached.promise;
        if (interrupted) { await f.service.searchTickets("new"); }
        trackers.reject(new Error("metadata offline"));
        await reset;
        f.assertEditable();
        assert.deepStrictEqual(f.store.getState().metadataOptions, before);
        if (interrupted) { f.assertCanceled(); }
        else { assert.deepStrictEqual(f.events, [{ type: "started", requestId: "reset" }, { type: "error", requestId: "reset" }]); }
      } finally { f.controller.dispose(); }
    });
  }

  for (const rejects of [false, true]) {
    test(`接続切替後の旧メタデータ${rejects ? "失敗" : "成功"}は旧接続の候補を復元せず終了通知を送る`, async () => {
      const f = fixture();
      const trackers = deferred<typeof options>();
      const reached = deferred<void>();
      try {
        await f.controller["loadMetadataOptions"](true);
        f.hooks.listTrackers = () => { reached.resolve(); return trackers.promise; };
        const reset = f.controller.handle({ type: "dashboard.resetCache", requestId: "reset" });
        await reached.promise;
        await f.controller.resetForConnectionChange();
        const current = structuredClone(f.store.getState());
        if (rejects) { trackers.reject(new Error("old connection offline")); }
        else { trackers.resolve(options); }
        await reset;
        assert.deepStrictEqual(f.store.getState(), current);
        assert.strictEqual(f.controller["metadataOptionsLoaded"], false);
        f.assertCanceled();
      } finally { f.controller.dispose(); }
    });
  }
});
