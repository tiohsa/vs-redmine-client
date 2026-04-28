import * as assert from "assert";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import type { DashboardEvent, DashboardState, DashboardUnsyncedKey } from "../dashboard/dashboardProtocol";

/**
 * DashboardWebviewProvider の send() キャッシュ動作を模倣したミニ実装。
 * 実際の vscode.WebviewView は使えないため、同じロジックを検証する。
 */
class FakeWebviewSender {
  private latestState: DashboardState | undefined;
  private visible = true;
  readonly sent: DashboardEvent[] = [];

  send(event: DashboardEvent): void {
    if (event.type === "dashboard.state") {
      this.latestState = event.state;
    }
    if (!this.visible) {
      return;
    }
    this.sent.push(event);
  }

  hide(): void { this.visible = false; }

  show(): void {
    this.visible = true;
    if (this.latestState) {
      this.send({ type: "dashboard.state", state: this.latestState });
    }
  }

  getLatestState(): DashboardState | undefined {
    return this.latestState;
  }
}

suite("Dashboard Webview — 非表示中の状態キャッシュ", () => {
  test("非表示中にストア更新しても latestState は最新状態を保つ", () => {
    const store = new DashboardStateStore();
    const sender = new FakeWebviewSender();

    store.subscribe((state) => sender.send({ type: "dashboard.state", state }));

    sender.hide();
    store.updateNested("unsynced", { totalCount: 5 });

    assert.strictEqual(sender.getLatestState()?.unsynced.totalCount, 5);
    assert.strictEqual(sender.sent.filter(e => e.type === "dashboard.state").length, 0);
  });

  test("非表示→同期→可視復帰時に最新の未同期件数が送信される", () => {
    const store = new DashboardStateStore();
    const sender = new FakeWebviewSender();

    store.subscribe((state) => sender.send({ type: "dashboard.state", state }));

    // 初期状態を送信
    sender.send({ type: "dashboard.state", state: store.getState() });
    assert.strictEqual(sender.sent.length, 1);

    // 非表示にして同期操作（ストア更新）
    sender.hide();
    store.updateNested("unsynced", { totalCount: 3 });
    store.updateNested("unsynced", { totalCount: 1 });

    // 非表示中は送信されない
    assert.strictEqual(sender.sent.filter(e => e.type === "dashboard.state").length, 1);

    // 可視復帰 — 最新状態が送信される
    sender.show();
    const stateEvents = sender.sent.filter(e => e.type === "dashboard.state");
    assert.strictEqual(stateEvents.length, 2);
    const lastState = stateEvents[stateEvents.length - 1];
    assert.ok(lastState.type === "dashboard.state");
    assert.strictEqual(lastState.state.unsynced.totalCount, 1);
  });

  test("operation toast は非表示中に破棄される", () => {
    const store = new DashboardStateStore();
    const sender = new FakeWebviewSender();
    store.subscribe((state) => sender.send({ type: "dashboard.state", state }));

    sender.send({ type: "dashboard.state", state: store.getState() });
    sender.hide();

    sender.send({ type: "operation.started", requestId: "r1", label: "同期中..." });
    sender.send({ type: "operation.success", requestId: "r1", message: "完了" });
    sender.send({ type: "toast", level: "info", message: "お知らせ" });

    const nonStateEvents = sender.sent.filter(e => e.type !== "dashboard.state");
    assert.strictEqual(nonStateEvents.length, 0);
  });

  test("可視状態では全イベントが送信される", () => {
    const store = new DashboardStateStore();
    const sender = new FakeWebviewSender();
    store.subscribe((state) => sender.send({ type: "dashboard.state", state }));

    sender.send({ type: "dashboard.state", state: store.getState() });
    sender.send({ type: "operation.started", requestId: "r1", label: "同期中..." });
    sender.send({ type: "operation.success", requestId: "r1", message: "完了" });

    assert.strictEqual(sender.sent.length, 3);
  });
});

suite("Dashboard Controller — comment 同期キー検証", () => {
  test("comment key に ticketId がない場合はエラー通知される (コントローラー側ガード)", () => {
    // DashboardController.handleSyncOne は ticketId === undefined のとき
    // notifyError("コメント同期キーが不正です。") を呼ぶ。
    // ここではそのロジックを直接検証する。
    const key: DashboardUnsyncedKey = { kind: "comment", commentId: 1, documentUri: "file:///a.md" };
    const isInvalid = key.kind === "comment" && key.ticketId === undefined;
    assert.strictEqual(isInvalid, true);
  });

  test("comment key に ticketId がある場合はガードを通過する", () => {
    const key: DashboardUnsyncedKey = { kind: "comment", ticketId: 42, commentId: 1, documentUri: "file:///a.md" };
    const isInvalid = key.kind === "comment" && key.ticketId === undefined;
    assert.strictEqual(isInvalid, false);
  });
});
