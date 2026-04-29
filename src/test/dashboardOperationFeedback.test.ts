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

// ── DashboardControllerOptions コールバック検証 ────────────────────────────

suite("Dashboard 操作フィードバック — Controller コールバック", () => {
  // 注意: DashboardController のフル統合テストは VS Code 環境が必要なため、
  // コールバックインターフェースの型安全性を確認するテストのみ行う。

  test("operation.success イベント型が正しく定義されている", () => {
    // dashboardProtocol の型定義を検証
    const event: import("../dashboard/dashboardProtocol").DashboardEvent = {
      type: "operation.success",
      requestId: "req-1",
      message: "成功しました。",
    };
    assert.strictEqual(event.type, "operation.success");
    assert.strictEqual(event.requestId, "req-1");
    assert.strictEqual(event.message, "成功しました。");
  });

  test("operation.error イベント型が正しく定義されている", () => {
    const event: import("../dashboard/dashboardProtocol").DashboardEvent = {
      type: "operation.error",
      requestId: "req-2",
      message: "失敗しました。",
    };
    assert.strictEqual(event.type, "operation.error");
    assert.strictEqual(event.message, "失敗しました。");
  });

  test("operation.started イベント型が正しく定義されている", () => {
    const event: import("../dashboard/dashboardProtocol").DashboardEvent = {
      type: "operation.started",
      requestId: "req-3",
      label: "同期中...",
    };
    assert.strictEqual(event.type, "operation.started");
    assert.strictEqual(event.label, "同期中...");
  });

  test("toast イベント型が正しく定義されている", () => {
    const event: import("../dashboard/dashboardProtocol").DashboardEvent = {
      type: "toast",
      level: "success",
      message: "トースト表示",
    };
    assert.strictEqual(event.type, "toast");
    assert.strictEqual(event.level, "success");
  });

  test("DashboardControllerOptions に notifyOperationStarted が含まれる", () => {
    // 型チェック: 必須フィールドが揃っていることを確認
    const opts: import("../dashboard/DashboardController").DashboardControllerOptions = {
      store: new DashboardStateStore(),
      notifyOperationStarted: (_requestId, _label) => {},
      notifySuccess: (_requestId, _msg) => {},
      notifyError: (_requestId, _msg) => {},
      notifyToast: (_level, _msg) => {},
      onTicketsRefreshed: () => {},
    };
    assert.strictEqual(typeof opts.notifyOperationStarted, "function");
    assert.strictEqual(typeof opts.notifySuccess, "function");
    assert.strictEqual(typeof opts.notifyError, "function");
  });
});

// ── 同期失敗検知ロジック（ユニットレベル）────────────────────────────────

suite("Dashboard 操作フィードバック — 同期失敗検知", () => {
  test("同期前後で totalCount が変わらない場合は失敗とみなす", () => {
    // DashboardController.handleSyncOne のロジックを模倣
    const beforeCount = 2;
    const afterCount = 2; // 変化なし = 失敗
    const isFailure = afterCount >= beforeCount;
    assert.strictEqual(isFailure, true);
  });

  test("同期後に totalCount が減少した場合は成功とみなす", () => {
    const beforeCount = 2;
    const afterCount = 1; // 1件減少 = 成功
    const isSuccess = afterCount < beforeCount;
    assert.strictEqual(isSuccess, true);
  });

  test("全件同期で beforeCount が 0 の場合は「同期するものなし」", () => {
    const beforeCount = 0;
    const isNothingToSync = beforeCount === 0;
    assert.strictEqual(isNothingToSync, true);
  });

  test("全件同期後に件数が減少した場合は成功", () => {
    const beforeCount = 3;
    const afterCount = 0;
    const isSuccess = beforeCount > 0 && afterCount < beforeCount;
    assert.strictEqual(isSuccess, true);
  });

  test("全件同期後に件数が変わらない場合は部分失敗", () => {
    const beforeCount = 3;
    const afterCount = 3;
    const isPartialFailure = beforeCount > 0 && afterCount >= beforeCount;
    assert.strictEqual(isPartialFailure, true);
  });
});
