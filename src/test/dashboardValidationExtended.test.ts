import * as assert from "assert";
import { validateDashboardMessage } from "../dashboard/dashboardMessageValidation";

suite("Dashboard バリデーション拡張", () => {
  // ── ID の正数チェック ────────────────────────────────────────────────────

  test("ticket.select: ticketId が 0 だと拒否される", () => {
    const r = validateDashboardMessage({ type: "ticket.select", requestId: "r", ticketId: 0 });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.select: ticketId が負数だと拒否される", () => {
    const r = validateDashboardMessage({ type: "ticket.select", requestId: "r", ticketId: -1 });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.select: ticketId が小数だと拒否される", () => {
    const r = validateDashboardMessage({ type: "ticket.select", requestId: "r", ticketId: 1.5 });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.createChild: parentTicketId が 0 だと拒否される", () => {
    const r = validateDashboardMessage({ type: "ticket.createChild", requestId: "r", parentTicketId: 0 });
    assert.strictEqual(r.ok, false);
  });

  test("ticket.createChild: parentTicketId が正整数なら受け入れられる", () => {
    const r = validateDashboardMessage({ type: "ticket.createChild", requestId: "r", parentTicketId: 42 });
    assert.strictEqual(r.ok, true);
  });

  test("project.select: projectId が 0 だと拒否される", () => {
    const r = validateDashboardMessage({ type: "project.select", requestId: "r", projectId: 0 });
    assert.strictEqual(r.ok, false);
  });

  test("project.select: projectId が正整数なら受け入れられる", () => {
    const r = validateDashboardMessage({ type: "project.select", requestId: "r", projectId: 1 });
    assert.strictEqual(r.ok, true);
  });

  // ── settings.update 構造バリデーション ──────────────────────────────────

  test("settings.update: filters.subjectQuery が文字列でないと拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.update", requestId: "r",
      patch: { filters: { subjectQuery: 123 } },
    });
    assert.strictEqual(r.ok, false);
  });

  test("settings.update: sort.direction が不正だと拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.update", requestId: "r",
      patch: { sort: { direction: "invalid" } },
    });
    assert.strictEqual(r.ok, false);
  });

  test("settings.update: sort.field が不正だと拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.update", requestId: "r",
      patch: { sort: { field: "unknown_field", direction: "asc" } },
    });
    assert.strictEqual(r.ok, false);
  });

  test("settings.update: 正常な sort と filter", () => {
    const r = validateDashboardMessage({
      type: "settings.update", requestId: "r",
      patch: { sort: { field: "priority", direction: "desc" } },
    });
    assert.strictEqual(r.ok, true);
  });

  test("settings.update: dueDate.showOverdue が boolean でないと拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.update", requestId: "r",
      patch: { dueDate: { showOverdue: "yes" } },
    });
    assert.strictEqual(r.ok, false);
  });

  // ── settings.updateEditorDefault ─────────────────────────────────────────

  test("settings.updateEditorDefault: 未知フィールドは拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.updateEditorDefault", requestId: "r",
      field: "unknown_field", value: "test",
    });
    assert.strictEqual(r.ok, false);
  });

  test("settings.updateEditorDefault: subject フィールドは受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "settings.updateEditorDefault", requestId: "r",
      field: "subject", value: "My Subject",
    });
    assert.strictEqual(r.ok, true);
    if (r.ok) {
      assert.strictEqual(r.request.type, "settings.updateEditorDefault");
    }
  });

  test("settings.updateEditorDefault: tracker フィールドは受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "settings.updateEditorDefault", requestId: "r",
      field: "tracker", value: "Bug",
    });
    assert.strictEqual(r.ok, true);
  });

  test("settings.updateEditorDefault: value が文字列でないと拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.updateEditorDefault", requestId: "r",
      field: "subject", value: 123,
    });
    assert.strictEqual(r.ok, false);
  });

  // ── settings.resetEditorDefaults ─────────────────────────────────────────

  test("settings.resetEditorDefaults: 未知フィールドを含むと拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.resetEditorDefaults", requestId: "r",
      fields: ["subject", "unknown"],
    });
    assert.strictEqual(r.ok, false);
  });

  test("settings.resetEditorDefaults: 有効なフィールドのみなら受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "settings.resetEditorDefaults", requestId: "r",
      fields: ["subject", "tracker", "priority"],
    });
    assert.strictEqual(r.ok, true);
  });

  test("settings.resetEditorDefaults: 空配列は受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "settings.resetEditorDefaults", requestId: "r",
      fields: [],
    });
    assert.strictEqual(r.ok, true);
  });

  test("settings.resetEditorDefaults: fields が配列でないと拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.resetEditorDefaults", requestId: "r",
      fields: "subject",
    });
    assert.strictEqual(r.ok, false);
  });

  // ── settings.updateGeneral ───────────────────────────────────────────────

  test("settings.updateGeneral: offlineSyncMode が不正だと拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.updateGeneral", requestId: "r",
      patch: { offlineSyncMode: "always" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("settings.updateGeneral: offlineSyncMode=auto は受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "settings.updateGeneral", requestId: "r",
      patch: { offlineSyncMode: "auto" },
    });
    assert.strictEqual(r.ok, true);
  });

  test("settings.updateGeneral: offlineSyncMode=manual は受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "settings.updateGeneral", requestId: "r",
      patch: { offlineSyncMode: "manual" },
    });
    assert.strictEqual(r.ok, true);
  });

  test("settings.updateGeneral: ticketListLimit が 0 だと拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.updateGeneral", requestId: "r",
      patch: { ticketListLimit: 0 },
    });
    assert.strictEqual(r.ok, false);
  });

  test("settings.updateGeneral: ticketListLimit が 501 だと拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.updateGeneral", requestId: "r",
      patch: { ticketListLimit: 501 },
    });
    assert.strictEqual(r.ok, false);
  });

  test("settings.updateGeneral: ticketListLimit=50 は受け入れられる", () => {
    const r = validateDashboardMessage({
      type: "settings.updateGeneral", requestId: "r",
      patch: { ticketListLimit: 50 },
    });
    assert.strictEqual(r.ok, true);
  });

  test("settings.updateGeneral: includeChildProjects が boolean でないと拒否される", () => {
    const r = validateDashboardMessage({
      type: "settings.updateGeneral", requestId: "r",
      patch: { includeChildProjects: "yes" },
    });
    assert.strictEqual(r.ok, false);
  });

  test("settings.updateGeneral: 複数フィールドの正常ケース", () => {
    const r = validateDashboardMessage({
      type: "settings.updateGeneral", requestId: "r",
      patch: { offlineSyncMode: "manual", includeChildProjects: true, ticketListLimit: 100 },
    });
    assert.strictEqual(r.ok, true);
  });

  // ── unsynced.openLocalFile ───────────────────────────────────────────────

  test("unsynced.openLocalFile: 空文字列の documentUri は拒否される", () => {
    const r = validateDashboardMessage({
      type: "unsynced.openLocalFile", requestId: "r",
      documentUri: "",
    });
    assert.strictEqual(r.ok, false);
  });
});
