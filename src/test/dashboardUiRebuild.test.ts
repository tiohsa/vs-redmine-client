import * as assert from "assert";
import { buildDashboardHtml } from "../dashboard/dashboardHtml";
import { buildDashboardStrings } from "../dashboard/dashboardI18n";
import { validateDashboardMessage } from "../dashboard/dashboardMessageValidation";
import { dashboardStyles } from "../dashboard/dashboardStyles";
import { dashboardWebviewScript } from "../dashboard/dashboardWebviewScript";

suite("Dashboard の表示と操作", () => {
  test("settings.openJson メッセージを検証する", () => {
    const valid = validateDashboardMessage({ type: "settings.openJson", requestId: "req-1" });
    assert.strictEqual(valid.ok, true);
    if (valid.ok) {
      assert.strictEqual(valid.request.type, "settings.openJson");
    }
  });

  test("ヘッダー重複ボタン排除・総件数バッジ・高優先度フィルタ・settings.jsonボタンを持つ", () => {
    const html = buildDashboardHtml("nonce", buildDashboardStrings());
    assert.ok(!html.includes('id="density-btn"'));
    assert.ok(!html.includes('id="refresh-btn"'));
    assert.ok(!html.includes('id="new-ticket-btn"'));
    assert.ok(html.includes('id="tickets-badge"'));
    assert.ok(html.includes('tab-badge-unsynced'));
    assert.ok(html.includes('data-quick-filter="high"'));
    assert.ok(!html.includes('data-quick-filter="unsynced"'));
    assert.ok(html.includes('id="open-settings-json-btn"'));
  });

  test("VS Code ネイティブサイドバーデザイン用 CSS を持つ", () => {
    assert.ok(dashboardStyles.includes(".ticket-tracker-bar"));
    assert.ok(dashboardStyles.includes(".priority-indicator.priority-urgent"));
    assert.ok(dashboardStyles.includes(".priority-indicator.priority-high"));
    assert.ok(dashboardStyles.includes(".status-pill.status-new"));
    assert.ok(dashboardStyles.includes(".status-pill.status-in-progress"));
    assert.ok(dashboardStyles.includes(".status-pill.status-resolved"));
    assert.ok(!dashboardStyles.includes(".ticket-hover-actions"));
    assert.ok(dashboardStyles.includes("#ticket-list.is-compact"));
    assert.ok(dashboardStyles.includes(".ticket-indent-branch"));
    assert.ok(dashboardStyles.includes(".unsynced-inline-badge"));
    assert.ok(dashboardStyles.includes("@media (prefers-reduced-motion: no-preference)"));
    assert.ok(dashboardStyles.includes("@keyframes dashboard-spin"));
  });

  test("詳細コメント一覧が余白なし・全幅・上下境界線リスト用 CSS を持つ", () => {
    const timelineStart = dashboardStyles.indexOf("/* Comments section header & timeline */");
    assert.ok(timelineStart >= 0);
    const timelineCss = dashboardStyles.slice(timelineStart);
    assert.ok(timelineCss.includes("padding: 0;"));
    assert.ok(timelineCss.includes("#detail-comments .state-msg"));
    assert.ok(timelineCss.includes("padding: 12px 10px;"));
    assert.ok(timelineCss.includes("#detail-comments .comment-list"));
    assert.ok(timelineCss.includes("gap: 0;"));
    assert.ok(timelineCss.includes("padding-left: 0;"));
    assert.ok(timelineCss.includes("border-left: 0;"));
    assert.ok(timelineCss.includes("border: 0;"));
    assert.ok(timelineCss.includes("border-bottom: 1px solid var(--app-border-subtle);"));
    assert.ok(timelineCss.includes("border-radius: 0;"));
    assert.ok(timelineCss.includes(".comment-card.is-editable:hover"));
    assert.ok(timelineCss.includes("overflow-wrap: anywhere;"));
  });

  test("コンパクトモード・高優先度フィルタ・キーボード操作・150msデバウンス・新規下書き行を実装する", () => {
    assert.ok(dashboardWebviewScript.includes("let compactMode = persistedUiState.compactMode === true;"));
    assert.ok(dashboardWebviewScript.includes("view.toggleCompactMode"));
    assert.ok(dashboardWebviewScript.includes("function isHighPriority("));
    assert.ok(dashboardWebviewScript.includes("function statusPillClass("));
    assert.ok(dashboardWebviewScript.includes("function priorityIndicator("));
    assert.ok(dashboardWebviewScript.includes("function formatShortDueDate("));
    assert.ok(dashboardWebviewScript.includes("window.setTimeout(submitSearch,150)"));
    assert.ok(dashboardWebviewScript.includes("event.key === 'ArrowDown' || event.key === 'ArrowUp'"));
    assert.ok(dashboardWebviewScript.includes("event.key === 'ArrowRight' || event.key === 'ArrowLeft'"));
    assert.ok(dashboardWebviewScript.includes("event.key === 'Escape'"));
    assert.ok(dashboardWebviewScript.includes("id=\"clear-filters-btn\""));
    assert.ok(dashboardWebviewScript.includes("req('settings.openJson')"));
    assert.ok(dashboardWebviewScript.includes("ticket.openDraft"));
    assert.ok(dashboardWebviewScript.includes("ticket.syncDraft"));
    assert.ok(dashboardWebviewScript.includes("#NEW"));
  });
});
