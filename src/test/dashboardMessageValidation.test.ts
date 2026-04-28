import * as assert from "assert";
import { validateDashboardMessage } from "../dashboard/dashboardMessageValidation";

suite("dashboardMessageValidation — メッセージ検証", () => {
  test("null は null を返す", () => {
    assert.strictEqual(validateDashboardMessage(null), null);
  });

  test("文字列は null を返す", () => {
    assert.strictEqual(validateDashboardMessage("hello"), null);
  });

  test("type なしのオブジェクトは null を返す", () => {
    assert.strictEqual(validateDashboardMessage({}), null);
  });

  test("dashboard.ready を正しく検証する", () => {
    const msg = validateDashboardMessage({ type: "dashboard.ready" });
    assert.ok(msg, "非 null");
    assert.strictEqual(msg?.type, "dashboard.ready");
  });

  test("project.select に projectId: number が必要", () => {
    assert.strictEqual(validateDashboardMessage({ type: "project.select" }), null);
    assert.strictEqual(validateDashboardMessage({ type: "project.select", projectId: "abc" }), null);
    const msg = validateDashboardMessage({ type: "project.select", projectId: 5 });
    assert.ok(msg);
    assert.strictEqual(msg?.type, "project.select");
    if (msg?.type === "project.select") {
      assert.strictEqual(msg.projectId, 5);
    }
  });

  test("ticket.select に ticketId: number が必要", () => {
    assert.strictEqual(validateDashboardMessage({ type: "ticket.select" }), null);
    const msg = validateDashboardMessage({ type: "ticket.select", ticketId: 42 });
    assert.ok(msg);
    if (msg?.type === "ticket.select") {
      assert.strictEqual(msg.ticketId, 42);
    }
  });

  test("ticket.toggleExpand に ticketId: number が必要", () => {
    assert.strictEqual(validateDashboardMessage({ type: "ticket.toggleExpand" }), null);
    const msg = validateDashboardMessage({ type: "ticket.toggleExpand", ticketId: 7 });
    assert.ok(msg);
    if (msg?.type === "ticket.toggleExpand") {
      assert.strictEqual(msg.ticketId, 7);
    }
  });

  test("unsynced.syncOne の kind が ticket/newTicket/comment 以外は null", () => {
    assert.strictEqual(validateDashboardMessage({ type: "unsynced.syncOne", kind: "unknown" }), null);
    const msg = validateDashboardMessage({ type: "unsynced.syncOne", kind: "ticket", ticketId: 1 });
    assert.ok(msg);
  });

  test("unsynced.openLocalFile に documentUri と requestId が必要", () => {
    assert.strictEqual(validateDashboardMessage({ type: "unsynced.openLocalFile" }), null);
    assert.strictEqual(validateDashboardMessage({ type: "unsynced.openLocalFile", documentUri: "file:///a.md" }), null);
    const msg = validateDashboardMessage({ type: "unsynced.openLocalFile", documentUri: "file:///a.md", requestId: "req-1" });
    assert.ok(msg);
    if (msg?.type === "unsynced.openLocalFile") {
      assert.strictEqual(msg.documentUri, "file:///a.md");
      assert.strictEqual(msg.requestId, "req-1");
    }
  });

  test("tab.switch の tab が tickets/comments/unsynced/settings 以外は null", () => {
    assert.strictEqual(validateDashboardMessage({ type: "tab.switch", tab: "invalid" }), null);
    const msg = validateDashboardMessage({ type: "tab.switch", tab: "tickets" });
    assert.ok(msg);
    if (msg?.type === "tab.switch") {
      assert.strictEqual(msg.tab, "tickets");
    }
  });

  test("settings.update に settings オブジェクトが必要", () => {
    assert.strictEqual(validateDashboardMessage({ type: "settings.update" }), null);
    assert.strictEqual(validateDashboardMessage({ type: "settings.update", settings: "not-object" }), null);
    const msg = validateDashboardMessage({ type: "settings.update", settings: { offlineSyncMode: "manual" } });
    assert.ok(msg);
  });

  test("comment.edit に ticketId と commentId の両方が必要", () => {
    assert.strictEqual(validateDashboardMessage({ type: "comment.edit", ticketId: 1 }), null);
    assert.strictEqual(validateDashboardMessage({ type: "comment.edit", commentId: 2 }), null);
    const msg = validateDashboardMessage({ type: "comment.edit", ticketId: 1, commentId: 2 });
    assert.ok(msg);
    if (msg?.type === "comment.edit") {
      assert.strictEqual(msg.ticketId, 1);
      assert.strictEqual(msg.commentId, 2);
    }
  });

  test("不明な type は null を返す", () => {
    assert.strictEqual(validateDashboardMessage({ type: "unknown.action" }), null);
  });
});
