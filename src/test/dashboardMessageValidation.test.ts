import * as assert from "assert";
import { validateDashboardMessage } from "../dashboard/dashboardMessageValidation";

suite("Dashboard メッセージバリデーション", () => {
  test("null は拒否される", () => {
    const r = validateDashboardMessage(null);
    assert.strictEqual(r.ok, false);
  });

  test("文字列は拒否される", () => {
    const r = validateDashboardMessage("hello");
    assert.strictEqual(r.ok, false);
  });

  test("type なしは拒否される", () => {
    const r = validateDashboardMessage({ requestId: "1" });
    assert.strictEqual(r.ok, false);
  });

  test("requestId なしは拒否される", () => {
    const r = validateDashboardMessage({ type: "dashboard.ready" });
    assert.strictEqual(r.ok, false);
  });

  test("未知のメッセージタイプは拒否される", () => {
    const r = validateDashboardMessage({ type: "unknown.message", requestId: "x" });
    assert.strictEqual(r.ok, false);
  });

  test("dashboard.ready は受け入れられる", () => {
    const r = validateDashboardMessage({ type: "dashboard.ready", requestId: "r1" });
    assert.strictEqual(r.ok, true);
  });

  test("dashboard.refresh は受け入れられる", () => {
    const r = validateDashboardMessage({ type: "dashboard.refresh", requestId: "r2" });
    assert.strictEqual(r.ok, true);
  });

  test("project.select: projectId が数値でないと拒否される", () => {
    const r = validateDashboardMessage({ type: "project.select", requestId: "r", projectId: "abc" });
    assert.strictEqual(r.ok, false);
  });

  test("project.select: 正常", () => {
    const r = validateDashboardMessage({ type: "project.select", requestId: "r", projectId: 5 });
    assert.strictEqual(r.ok, true);
    if (r.ok) {
      assert.strictEqual(r.request.type, "project.select");
    }
  });

  test("project.toggleChildren: boolean でないと拒否される", () => {
    const r = validateDashboardMessage({ type: "project.toggleChildren", requestId: "r", includeChildProjects: 1 });
    assert.strictEqual(r.ok, false);
  });

  test("project.toggleChildren: 正常", () => {
    const r = validateDashboardMessage({ type: "project.toggleChildren", requestId: "r", includeChildProjects: true });
    assert.strictEqual(r.ok, true);
  });

  test("ticket.select: ticketId が数値でないと拒否される", () => {
    const r = validateDashboardMessage({ type: "ticket.select", requestId: "r", ticketId: null });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.select: 正常", () => {
    const r = validateDashboardMessage({ type: "ticket.select", requestId: "r", ticketId: 42 });
    assert.strictEqual(r.ok, true);
  });

  test("ticket.createChild: parentTicketId が数値でないと拒否される", () => {
    const r = validateDashboardMessage({ type: "ticket.createChild", requestId: "r", parentTicketId: "bad" });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.createChild: 正常", () => {
    const r = validateDashboardMessage({ type: "ticket.createChild", requestId: "r", parentTicketId: 10 });
    assert.strictEqual(r.ok, true);
  });

  test("ticket.syncNewTicketDraftFromComposer: 正常", () => {
    const r = validateDashboardMessage({ type: "ticket.syncNewTicketDraftFromComposer", requestId: "r-sync" });
    assert.strictEqual(r.ok, true);
  });

  test("comment.edit: commentId が数値でないと拒否される", () => {
    const r = validateDashboardMessage({ type: "comment.edit", requestId: "r", ticketId: 1, commentId: "x" });
    assert.strictEqual(r.ok, false);
  });

  test("comment.edit: 正常", () => {
    const r = validateDashboardMessage({ type: "comment.edit", requestId: "r", ticketId: 1, commentId: 99 });
    assert.strictEqual(r.ok, true);
  });

  test("unsynced.syncOne: key が無効だと拒否される", () => {
    const r = validateDashboardMessage({ type: "unsynced.syncOne", requestId: "r", key: { kind: "bad" } });
    assert.strictEqual(r.ok, false);
  });

  test("unsynced.syncOne: ticket key 正常", () => {
    const r = validateDashboardMessage({ type: "unsynced.syncOne", requestId: "r", key: { kind: "ticket", ticketId: 5 } });
    assert.strictEqual(r.ok, true);
  });

  test("unsynced.syncOne: newTicket key 正常", () => {
    const r = validateDashboardMessage({ type: "unsynced.syncOne", requestId: "r", key: { kind: "newTicket", documentUri: "file:///a.md" } });
    assert.strictEqual(r.ok, true);
  });

  test("unsynced.syncOne: newTicket key の documentUri が空なら拒否される", () => {
    const r = validateDashboardMessage({ type: "unsynced.syncOne", requestId: "r", key: { kind: "newTicket", documentUri: "" } });
    assert.strictEqual(r.ok, false);
  });

  test("unsynced.syncOne: comment key に ticketId がないと拒否される", () => {
    const r = validateDashboardMessage({ type: "unsynced.syncOne", requestId: "r", key: { kind: "comment", commentId: 1, documentUri: "file:///a.md" } });
    assert.strictEqual(r.ok, false);
  });

  test("unsynced.syncOne: comment key に ticketId が 0 だと拒否される", () => {
    const r = validateDashboardMessage({ type: "unsynced.syncOne", requestId: "r", key: { kind: "comment", ticketId: 0, commentId: 1, documentUri: "file:///a.md" } });
    assert.strictEqual(r.ok, false);
  });

  test("unsynced.syncOne: comment key に commentId と documentUri が両方ないと拒否される", () => {
    const r = validateDashboardMessage({ type: "unsynced.syncOne", requestId: "r", key: { kind: "comment", ticketId: 42 } });
    assert.strictEqual(r.ok, false);
  });

  test("unsynced.syncOne: comment key の documentUri が空なら拒否される", () => {
    const r = validateDashboardMessage({ type: "unsynced.syncOne", requestId: "r", key: { kind: "comment", ticketId: 42, documentUri: "" } });
    assert.strictEqual(r.ok, false);
  });

  test("unsynced.syncOne: comment key 正常", () => {
    const r = validateDashboardMessage({ type: "unsynced.syncOne", requestId: "r", key: { kind: "comment", ticketId: 42, commentId: 1, documentUri: "file:///a.md" } });
    assert.strictEqual(r.ok, true);
  });

  test("unsynced.openLocalFile: documentUri が文字列でないと拒否される", () => {
    const r = validateDashboardMessage({ type: "unsynced.openLocalFile", requestId: "r", documentUri: 123 });
    assert.strictEqual(r.ok, false);
  });

  test("unsynced.openLocalFile: documentUri が空なら拒否される", () => {
    const r = validateDashboardMessage({ type: "unsynced.openLocalFile", requestId: "r", documentUri: "" });
    assert.strictEqual(r.ok, false);
  });

  test("settings.update: patch がオブジェクトでないと拒否される", () => {
    const r = validateDashboardMessage({ type: "settings.update", requestId: "r", patch: "bad" });
    assert.strictEqual(r.ok, false);
  });

  test("settings.update: ID配列に文字列が含まれると拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.update",
      requestId: "r",
      patch: { filters: { priorityIds: [1, "2"] } },
    });
    assert.strictEqual(r.ok, false);
  });

  test("settings.update: ID配列に0が含まれると拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.update",
      requestId: "r",
      patch: { filters: { trackerIds: [0] } },
    });
    assert.strictEqual(r.ok, false);
  });

  test("settings.update: ID配列が正の整数なら受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "settings.update",
      requestId: "r",
      patch: { filters: { priorityIds: [1, 2], statusIds: [3], trackerIds: [4], assigneeIds: [5] } },
    });
    assert.strictEqual(r.ok, true);
  });

  test("settings.update: 正常", () => {
    const r = validateDashboardMessage({ type: "settings.update", requestId: "r", patch: {} });
    assert.strictEqual(r.ok, true);
  });

  test("settings.reset: 正常", () => {
    const r = validateDashboardMessage({ type: "settings.reset", requestId: "r" });
    assert.strictEqual(r.ok, true);
  });
});
