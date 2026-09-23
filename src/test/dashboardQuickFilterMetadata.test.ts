import * as assert from "assert";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";

const invokeLoadMetadataOptions = (controller: DashboardController): Promise<void> =>
  (controller as unknown as { loadMetadataOptions(): Promise<void> }).loadMetadataOptions();

const createController = (
  store: DashboardStateStore,
  getCurrentUserId: () => Promise<number>,
): DashboardController => new DashboardController({
  store,
  notifyOperationStarted: () => undefined,
  notifySuccess: () => undefined,
  notifyError: () => undefined,
  notifyToast: () => undefined,
  onTicketsRefreshed: () => undefined,
  _metadataTestHooks: {
    listTrackers: async () => [],
    listIssuePriorities: async () => [],
    listIssueStatuses: async () => [
      { id: 1, name: "Open", isClosed: false },
      { id: 5, name: "Closed", isClosed: true },
    ],
    getCurrentUserId,
  },
});

suite("Dashboard quick-filter metadata", () => {
  test("publishes current user ID asynchronously with status closure metadata", async () => {
    let resolveUserId!: (id: number) => void;
    const currentUserId = new Promise<number>((resolve) => { resolveUserId = resolve; });
    const store = new DashboardStateStore();
    const controller = createController(store, () => currentUserId);
    try {
      const load = invokeLoadMetadataOptions(controller);
      assert.deepStrictEqual(store.getState().quickFilterCapabilities, { mine: "loading", open: "loading" });
      await load;

      assert.deepStrictEqual(store.getState().metadataOptions.statuses, [
        { id: 1, name: "Open", isClosed: false },
        { id: 5, name: "Closed", isClosed: true },
      ]);
      assert.strictEqual(store.getState().currentUserId, undefined);
      assert.deepStrictEqual(store.getState().quickFilterCapabilities, { mine: "loading", open: "available" });

      resolveUserId(42);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(store.getState().currentUserId, 42);
      assert.deepStrictEqual(store.getState().quickFilterCapabilities, { mine: "available", open: "available" });
    } finally {
      controller.dispose();
    }
  });

  test("current user lookup failure does not block status metadata", async () => {
    const store = new DashboardStateStore();
    const controller = createController(store, async () => { throw new Error("user lookup failed"); });
    try {
      await invokeLoadMetadataOptions(controller);
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.deepStrictEqual(store.getState().metadataOptions.statuses, [
        { id: 1, name: "Open", isClosed: false },
        { id: 5, name: "Closed", isClosed: true },
      ]);
      assert.strictEqual(store.getState().currentUserId, undefined);
      assert.deepStrictEqual(store.getState().quickFilterCapabilities, { mine: "unavailable", open: "available" });
    } finally {
      controller.dispose();
    }
  });

  test("isClosed が含まれない status metadata は Open filter unavailable として公開される", async () => {
    const store = new DashboardStateStore();
    const controller = new DashboardController({
      store,
      notifyOperationStarted: () => undefined,
      notifySuccess: () => undefined,
      notifyError: () => undefined,
      notifyToast: () => undefined,
      onTicketsRefreshed: () => undefined,
      _metadataTestHooks: {
        listTrackers: async () => [],
        listIssuePriorities: async () => [],
        listIssueStatuses: async () => [{ id: 1, name: "Open" }],
        getCurrentUserId: async () => 42,
      },
    });
    try {
      await invokeLoadMetadataOptions(controller);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepStrictEqual(store.getState().quickFilterCapabilities, { mine: "available", open: "unavailable" });
    } finally {
      controller.dispose();
    }
  });
});
