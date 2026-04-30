import * as assert from "assert";
import { validateDashboardMessage } from "../dashboard/dashboardMessageValidation";

suite("コンポーザー メッセージバリデーション", () => {
  test("ticket.cancelComposer: 受け入れられる", () => {
    const r = validateDashboardMessage({ type: "ticket.cancelComposer", requestId: "r1" });
    assert.strictEqual(r.ok, true);
  });

  test("ticket.createDraftFromComposer: 正常なリクエスト", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r2",
      values: {
        subject: "テストチケット",
        tracker: "Bug",
        priority: "High",
        status: "New",
      },
    });
    assert.strictEqual(r.ok, true);
  });

  test("ticket.createDraftFromComposer: subject が空は拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r3",
      values: { subject: "", tracker: "Bug", priority: "Normal", status: "New" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.createDraftFromComposer: tracker が空は拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r4",
      values: { subject: "テスト", tracker: "", priority: "Normal", status: "New" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.createDraftFromComposer: priority が空は拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r5",
      values: { subject: "テスト", tracker: "Task", priority: "", status: "New" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.createDraftFromComposer: status が空は拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r6",
      values: { subject: "テスト", tracker: "Task", priority: "Normal", status: "" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.createDraftFromComposer: 不正な due_date は拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r7",
      values: { subject: "テスト", tracker: "Task", priority: "Normal", status: "New", due_date: "invalid-date" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.createDraftFromComposer: 正しい日付形式は受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r8",
      values: { subject: "テスト", tracker: "Task", priority: "Normal", status: "New", due_date: "2026-12-31", start_date: "2026-01-01" },
    });
    assert.strictEqual(r.ok, true);
  });

  test("ticket.createDraftFromComposer: parent が正の整数の場合は受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r9",
      values: { subject: "子チケット", tracker: "Task", priority: "Normal", status: "New", parent: 100 },
    });
    assert.strictEqual(r.ok, true);
    if (r.ok) { assert.strictEqual(r.request.type, "ticket.createDraftFromComposer"); }
  });

  test("ticket.createDraftFromComposer: parent が負の数は拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r10",
      values: { subject: "テスト", tracker: "Task", priority: "Normal", status: "New", parent: -1 },
    });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.createDraftFromComposer: values がなければ拒否される", () => {
    const r = validateDashboardMessage({ type: "ticket.createDraftFromComposer", requestId: "r11" });
    assert.strictEqual(r.ok, false);
  });
});
