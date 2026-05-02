import * as assert from "assert";
import { validateDashboardMessage } from "../dashboard/dashboardMessageValidation";

suite("コンポーザー メッセージバリデーション", () => {
  test("ticket.cancelComposer: 受け入れられる", () => {
    const r = validateDashboardMessage({ type: "ticket.cancelComposer", requestId: "r1" });
    assert.strictEqual(r.ok, true);
  });

  test("ticket.syncNewTicketDraftFromComposer: 受け入れられる", () => {
    const r = validateDashboardMessage({ type: "ticket.syncNewTicketDraftFromComposer", requestId: "r1-1" });
    assert.strictEqual(r.ok, true);
  });

  test("ticket.createDraftFromComposer: 正常なリクエスト", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r2",
      values: {
        tracker: "Bug",
        priority: "High",
        status: "New",
      },
    });
    assert.strictEqual(r.ok, true);
  });

  test("ticket.createDraftFromComposer: subject なしでも受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r3",
      values: { tracker: "Bug", priority: "Normal", status: "New" },
    });
    assert.strictEqual(r.ok, true);
  });

  test("ticket.createDraftFromComposer: tracker が空は拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r4",
      values: { tracker: "", priority: "Normal", status: "New" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.createDraftFromComposer: priority が空は拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r5",
      values: { tracker: "Task", priority: "", status: "New" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.createDraftFromComposer: status が空でも受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r6",
      values: { tracker: "Task", priority: "Normal", status: "" },
    });
    assert.strictEqual(r.ok, true);
  });

  test("ticket.createDraftFromComposer: 不正な due_date は拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r7",
      values: { tracker: "Task", priority: "Normal", status: "New", due_date: "invalid-date" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.createDraftFromComposer: 正しい日付形式は受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r8",
      values: { tracker: "Task", priority: "Normal", status: "New", due_date: "2026-12-31", start_date: "2026-01-01" },
    });
    assert.strictEqual(r.ok, true);
  });

  test("ticket.createDraftFromComposer: 余分なフィールドがあっても必須値が正しければ受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r9",
      values: { tracker: "Task", priority: "Normal", status: "New", extra: "noop" },
    });
    assert.strictEqual(r.ok, true);
    if (r.ok) { assert.strictEqual(r.request.type, "ticket.createDraftFromComposer"); }
  });

  test("ticket.createDraftFromComposer: values がなければ拒否される", () => {
    const r = validateDashboardMessage({ type: "ticket.createDraftFromComposer", requestId: "r10" });
    assert.strictEqual(r.ok, false);
  });
});
