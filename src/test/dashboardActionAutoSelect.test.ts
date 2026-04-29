import * as assert from "assert";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import type { DashboardTicketDetail } from "../dashboard/dashboardProtocol";

// DashboardController.selectTicket が行う store.update パターンを検証する。
// openEditor / comment.add / openBrowser / createChild / comment.edit は
// 実行前に void this.selectTicket(ticketId) を呼ぶ。

const makeDetail = (id: number): DashboardTicketDetail => ({
  id,
  subject: `Ticket #${id}`,
  syncState: "Synced",
});

suite("Dashboard アクション自動選択 — Store 状態遷移", () => {
  test("selectedTicketId が更新されると store の状態に反映される", () => {
    const store = new DashboardStateStore();
    store.update({ selectedTicketId: 42, selectedTicket: makeDetail(42) });
    assert.strictEqual(store.getState().selectedTicketId, 42);
    assert.strictEqual(store.getState().selectedTicket?.id, 42);
  });

  test("別のチケットを選択すると selectedTicketId が上書きされる", () => {
    const store = new DashboardStateStore();
    store.update({ selectedTicketId: 10, selectedTicket: makeDetail(10) });
    store.update({ selectedTicketId: 20, selectedTicket: makeDetail(20) });
    assert.strictEqual(store.getState().selectedTicketId, 20);
  });

  test("選択更新時にリスナーが呼ばれる", () => {
    const store = new DashboardStateStore();
    let notified = false;
    store.subscribe(() => { notified = true; });
    store.update({ selectedTicketId: 5, selectedTicket: makeDetail(5) });
    assert.strictEqual(notified, true);
  });

  test("selectedTicketId が未設定のとき undefined を返す", () => {
    const store = new DashboardStateStore();
    assert.strictEqual(store.getState().selectedTicketId, undefined);
    assert.strictEqual(store.getState().selectedTicket, undefined);
  });

  test("openEditor / comment.add / openBrowser / createChild に ticketId フィールドが存在する", () => {
    // DashboardRequest の型定義を確認し、これらのアクションが ticketId を持つことを保証する
    type Req = import("../dashboard/dashboardProtocol").DashboardRequest;

    const openEditor: Req = { type: "ticket.openEditor", requestId: "r1", ticketId: 7 };
    const commentAdd: Req = { type: "comment.add", requestId: "r2", ticketId: 7 };
    const openBrowser: Req = { type: "ticket.openBrowser", requestId: "r3", ticketId: 7 };
    const createChild: Req = { type: "ticket.createChild", requestId: "r4", parentTicketId: 7 };
    const commentEdit: Req = { type: "comment.edit", requestId: "r5", ticketId: 7, commentId: 1 };

    assert.strictEqual(openEditor.type, "ticket.openEditor");
    assert.strictEqual((commentAdd as { ticketId: number }).ticketId, 7);
    assert.strictEqual((openBrowser as { ticketId: number }).ticketId, 7);
    assert.strictEqual((createChild as { parentTicketId: number }).parentTicketId, 7);
    assert.strictEqual((commentEdit as { ticketId: number; commentId: number }).commentId, 1);
  });
});
