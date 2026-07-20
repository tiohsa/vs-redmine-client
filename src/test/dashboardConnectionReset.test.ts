import * as assert from "assert";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

suite("Dashboard connection reset", () => {
  test("baseUrl変更時に旧接続先の選択・チケット・ページング表示を一括消去する", async () => {
    const store = new DashboardStateStore();
    store.update({
      projects: [{ id: 1, name: "Old", identifier: "old", level: 0 }],
      tickets: [{ id: 1, subject: "Old ticket", level: 0, syncState: "Synced", children: [] }],
      totalTicketCount: 100,
      loadedTicketCount: 50,
      selectedProject: { id: 1, name: "Old" },
      selectedTicketId: 1,
      workPanel: { mode: "detail", ticketId: 1 },
      comments: { ticketId: 1, loading: true, items: [] },
      loading: { tickets: true, comments: true },
    });
    const controller = new DashboardController({
      store,
      notifyOperationStarted: () => undefined,
      notifySuccess: () => undefined,
      notifyError: () => undefined,
      notifyToast: () => undefined,
      onTicketsRefreshed: () => undefined,
    });
    const target = controller as unknown as {
      ticketService: { invalidate(): void };
      commentService: { invalidate(): void };
      metadataService: { invalidate(): void };
      projectService: { resetForConnectionChange(): Promise<void> };
      initialize(): Promise<void>;
    };
    target.ticketService = { invalidate: () => undefined };
    target.commentService = { invalidate: () => undefined };
    target.metadataService = { invalidate: () => undefined };
    target.projectService = { resetForConnectionChange: async () => undefined };
    target.initialize = async () => undefined;

    await controller.resetForConnectionChange();

    const state = store.getState();
    assert.deepStrictEqual(state.projects, []);
    assert.deepStrictEqual(state.tickets, []);
    assert.strictEqual(state.totalTicketCount, 0);
    assert.strictEqual(state.loadedTicketCount, 0);
    assert.strictEqual(state.selectedProject, undefined);
    assert.strictEqual(state.selectedTicketId, undefined);
    assert.strictEqual(state.workPanel, undefined);
    assert.deepStrictEqual(state.comments.items, []);
    assert.deepStrictEqual(state.loading, { tickets: false, comments: false });
    controller.dispose();
  });

  test("baseUrlを短時間に複数変更しても最後の世代だけを再初期化する", async () => {
    const store = new DashboardStateStore();
    const first = deferred();
    const second = deferred();
    let resetCount = 0;
    let initializeCount = 0;
    const controller = new DashboardController({
      store,
      notifyOperationStarted: () => undefined,
      notifySuccess: () => undefined,
      notifyError: () => undefined,
      notifyToast: () => undefined,
      onTicketsRefreshed: () => undefined,
    });
    const target = controller as unknown as {
      ticketService: { invalidate(): void };
      commentService: { invalidate(): void };
      metadataService: { invalidate(): void };
      projectService: { resetForConnectionChange(): Promise<void> };
      initialize(): Promise<void>;
    };
    target.ticketService = { invalidate: () => undefined };
    target.commentService = { invalidate: () => undefined };
    target.metadataService = { invalidate: () => undefined };
    target.projectService = {
      resetForConnectionChange: () => (++resetCount === 1 ? first.promise : second.promise),
    };
    target.initialize = async () => { initializeCount++; };

    const oldChange = controller.resetForConnectionChange();
    const latestChange = controller.resetForConnectionChange();
    second.resolve();
    await latestChange;
    first.resolve();
    await oldChange;

    assert.strictEqual(initializeCount, 1);
    controller.dispose();
  });
});
