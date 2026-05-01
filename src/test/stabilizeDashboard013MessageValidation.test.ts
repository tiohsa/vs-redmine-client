import * as assert from "assert";
import { validateDashboardMessage } from "../dashboard/dashboardMessageValidation";

suite("0.1.3 安定化: Dashboard メッセージバリデーション追加テスト", () => {
  // ── ticket.createDraftFromComposer ──────────────────────────────────────

  test("createDraftFromComposer: tracker が必須", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r1",
      values: { priority: "Normal", status: "New" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("createDraftFromComposer: priority が必須", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r2",
      values: { tracker: "Bug", status: "New" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("createDraftFromComposer: status が必須", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r3",
      values: { tracker: "Bug", priority: "Normal" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("createDraftFromComposer: start_date が不正形式は拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r4",
      values: { tracker: "Bug", priority: "Normal", status: "New", start_date: "2026/05/01" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("createDraftFromComposer: due_date が不正形式は拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r5",
      values: { tracker: "Bug", priority: "Normal", status: "New", due_date: "not-a-date" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("createDraftFromComposer: 正常なリクエスト（日付あり）", () => {
    const r = validateDashboardMessage({
      type: "ticket.createDraftFromComposer",
      requestId: "r6",
      values: {
        tracker: "Bug",
        priority: "Normal",
        status: "New",
        start_date: "2026-01-01",
        due_date: "2026-12-31",
      },
    });
    assert.strictEqual(r.ok, true);
  });

  // ── ticket.metadata.update ──────────────────────────────────────────────

  test("metadata.update: 未知フィールドは拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.metadata.update",
      requestId: "r7",
      ticketId: 10,
      patch: { unknownField: "value" } as unknown,
    });
    assert.strictEqual(r.ok, false);
  });

  test("metadata.update: 空の patch は拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.metadata.update",
      requestId: "r8",
      ticketId: 10,
      patch: {},
    });
    assert.strictEqual(r.ok, false);
  });

  test("metadata.update: 不正な due_date 形式は拒否される", () => {
    const r = validateDashboardMessage({
      type: "ticket.metadata.update",
      requestId: "r9",
      ticketId: 10,
      patch: { due_date: "2026/05/01" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("metadata.update: 空文字の due_date は受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "ticket.metadata.update",
      requestId: "r10",
      ticketId: 10,
      patch: { due_date: "" },
    });
    assert.strictEqual(r.ok, true);
  });

  // ── settings.updateGeneral ──────────────────────────────────────────────

  test("settings.updateGeneral: ticketListLimit=0 は拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.updateGeneral",
      requestId: "r11",
      patch: { ticketListLimit: 0 },
    });
    assert.strictEqual(r.ok, false);
  });

  test("settings.updateGeneral: ticketListLimit=501 は拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.updateGeneral",
      requestId: "r12",
      patch: { ticketListLimit: 501 },
    });
    assert.strictEqual(r.ok, false);
  });

  test("settings.updateGeneral: ticketListLimit=1 は受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "settings.updateGeneral",
      requestId: "r13",
      patch: { ticketListLimit: 1 },
    });
    assert.strictEqual(r.ok, true);
  });

  test("settings.updateGeneral: ticketListLimit=500 は受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "settings.updateGeneral",
      requestId: "r14",
      patch: { ticketListLimit: 500 },
    });
    assert.strictEqual(r.ok, true);
  });

  test("settings.updateGeneral: ticketListLimit が小数は拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.updateGeneral",
      requestId: "r15",
      patch: { ticketListLimit: 50.5 },
    });
    assert.strictEqual(r.ok, false);
  });
});
