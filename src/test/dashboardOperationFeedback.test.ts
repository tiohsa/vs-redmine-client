import * as assert from "assert";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";

// ── DashboardStateStore の購読・更新テスト ─────────────────────────────────

suite("Dashboard 操作フィードバック — StateStore", () => {
  test("subscribe: 状態変更時にリスナーが呼ばれる", () => {
    const store = new DashboardStateStore();
    let called = false;
    store.subscribe(() => { called = true; });
    store.update({ includeChildProjects: true });
    assert.strictEqual(called, true);
  });

  test("subscribe: 解除後はリスナーが呼ばれない", () => {
    const store = new DashboardStateStore();
    let count = 0;
    const unsubscribe = store.subscribe(() => { count++; });
    store.update({ includeChildProjects: true });
    assert.strictEqual(count, 1);
    unsubscribe();
    store.update({ includeChildProjects: false });
    assert.strictEqual(count, 1);
  });

  test("update: errors フィールドを更新できる", () => {
    const store = new DashboardStateStore();
    store.update({ errors: { tickets: "接続エラー" } });
    assert.strictEqual(store.getState().errors.tickets, "接続エラー");
  });

  test("update: errors をクリアできる", () => {
    const store = new DashboardStateStore();
    store.update({ errors: { tickets: "エラー" } });
    store.update({ errors: { tickets: undefined } });
    assert.strictEqual(store.getState().errors.tickets, undefined);
  });

  test("updateNested: loading を部分更新できる", () => {
    const store = new DashboardStateStore();
    store.updateNested("loading", { tickets: true });
    assert.strictEqual(store.getState().loading.tickets, true);
    assert.strictEqual(store.getState().loading.comments, false);
  });

  test("updateNested: comments を部分更新できる", () => {
    const store = new DashboardStateStore();
    store.updateNested("comments", { loading: true });
    assert.strictEqual(store.getState().comments.loading, true);
    assert.deepStrictEqual(store.getState().comments.items, []);
  });

  test("updateNested: unsynced totalCount を更新できる", () => {
    const store = new DashboardStateStore();
    store.updateNested("unsynced", { totalCount: 3 });
    assert.strictEqual(store.getState().unsynced.totalCount, 3);
    assert.deepStrictEqual(store.getState().unsynced.items, []);
  });

  test("複数リスナーが全て通知される", () => {
    const store = new DashboardStateStore();
    const results: number[] = [];
    store.subscribe(() => results.push(1));
    store.subscribe(() => results.push(2));
    store.update({ includeChildProjects: true });
    assert.deepStrictEqual(results.sort(), [1, 2]);
  });
});
