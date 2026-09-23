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
      await invokeLoadMetadataOptions(controller);

      assert.deepStrictEqual(store.getState().metadataOptions.statuses, [
        { id: 1, name: "Open", isClosed: false },
        { id: 5, name: "Closed", isClosed: true },
      ]);
      assert.strictEqual(store.getState().currentUserId, undefined);

      resolveUserId(42);
      await currentUserId;
      await Promise.resolve();
      assert.strictEqual(store.getState().currentUserId, 42);
    } finally {
      controller.dispose();
    }
  });

  test("current user lookup failure does not block status metadata", async () => {
    const store = new DashboardStateStore();
    const controller = createController(store, async () => { throw new Error("user lookup failed"); });
    try {
      await invokeLoadMetadataOptions(controller);
      await Promise.resolve();

      assert.deepStrictEqual(store.getState().metadataOptions.statuses, [
        { id: 1, name: "Open", isClosed: false },
        { id: 5, name: "Closed", isClosed: true },
      ]);
      assert.strictEqual(store.getState().currentUserId, undefined);
    } finally {
      controller.dispose();
    }
  });
});
