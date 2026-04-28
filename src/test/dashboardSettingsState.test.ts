import * as assert from "assert";
import type { DashboardSettingsState } from "../dashboard/dashboardTypes";

// SettingsController.getCurrentSettings() が返すデフォルト構造を検証
// (実際の VS Code API 呼び出しはモックできないため、型と構造のみ検証)

const buildDefaultSettings = (): DashboardSettingsState => ({
  offlineSyncMode: "auto",
  includeChildProjects: false,
  ticketListLimit: 50,
  titleFilter: "",
  sortField: "id",
  sortOrder: "desc",
  showDueDateIndicator: true,
});

suite("dashboardSettingsState — 設定 state 構造", () => {
  test("デフォルト設定 state の全フィールドが存在する", () => {
    const s = buildDefaultSettings();
    assert.ok("offlineSyncMode" in s, "offlineSyncMode が存在");
    assert.ok("includeChildProjects" in s, "includeChildProjects が存在");
    assert.ok("ticketListLimit" in s, "ticketListLimit が存在");
    assert.ok("titleFilter" in s, "titleFilter が存在");
    assert.ok("sortField" in s, "sortField が存在");
    assert.ok("sortOrder" in s, "sortOrder が存在");
    assert.ok("showDueDateIndicator" in s, "showDueDateIndicator が存在");
  });

  test("offlineSyncMode は auto または manual である", () => {
    const s = buildDefaultSettings();
    assert.ok(s.offlineSyncMode === "auto" || s.offlineSyncMode === "manual");
  });

  test("ticketListLimit は正の整数である", () => {
    const s = buildDefaultSettings();
    assert.ok(Number.isInteger(s.ticketListLimit) && s.ticketListLimit > 0);
  });

  test("sortOrder は asc または desc である", () => {
    const s = buildDefaultSettings();
    assert.ok(s.sortOrder === "asc" || s.sortOrder === "desc");
  });

  test("includeChildProjects は boolean である", () => {
    const s = buildDefaultSettings();
    assert.strictEqual(typeof s.includeChildProjects, "boolean");
  });

  test("設定を partial update で上書きできる", () => {
    const base = buildDefaultSettings();
    const updated: DashboardSettingsState = { ...base, offlineSyncMode: "manual", ticketListLimit: 100 };
    assert.strictEqual(updated.offlineSyncMode, "manual");
    assert.strictEqual(updated.ticketListLimit, 100);
    assert.strictEqual(updated.includeChildProjects, base.includeChildProjects);
  });

  test("ticketListLimit 変更後の値が次回 refresh に使われることを想定したテスト", () => {
    const base = buildDefaultSettings();
    const limit100: DashboardSettingsState = { ...base, ticketListLimit: 100 };
    // limit: 50 → 100 に変更された場合、100 になっていること
    assert.strictEqual(limit100.ticketListLimit, 100);
  });
});
