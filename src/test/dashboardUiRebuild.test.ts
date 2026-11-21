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

  test("VS Code ネイティブサイドバーデザイン用 CSS を持ち、トラッカー縦バーとコメント左バーを持たない", () => {
    assert.ok(!dashboardStyles.includes(".ticket-tracker-bar"));
    assert.ok(!dashboardStyles.includes(".detail-tracker-bar"));
    assert.ok(!dashboardStyles.includes("border-left: 3px solid var(--tracker-color"));
    assert.ok(!dashboardStyles.includes("inset 3px 0 0"));
    assert.ok(!dashboardStyles.includes(".ticket-row.selected::before"));
    assert.ok(!dashboardWebviewScript.includes("ticket-tracker-bar"));
    assert.ok(!dashboardWebviewScript.includes("detail-tracker-bar"));
    assert.ok(dashboardStyles.includes(".priority-indicator.priority-urgent"));
    assert.ok(dashboardStyles.includes(".priority-indicator.priority-high"));
    assert.ok(dashboardStyles.includes(".status-pill.status-new"));
    assert.ok(dashboardStyles.includes(".status-pill.status-in-progress"));
    assert.ok(dashboardStyles.includes(".status-pill.status-resolved"));
    assert.ok(dashboardStyles.includes(".ticket-hover-actions"));
    assert.ok(dashboardStyles.includes(".ticket-row:hover .ticket-hover-actions"));
    assert.ok(dashboardStyles.includes(".ticket-row:focus-within .ticket-hover-actions"));
    assert.ok(!dashboardStyles.includes(".ticket-row.selected .ticket-hover-actions"));
    assert.ok(dashboardStyles.includes("position: absolute;"));
    assert.ok(!dashboardStyles.includes(".ticket-progress"));
    assert.ok(dashboardStyles.includes("#ticket-list.is-compact"));
    assert.ok(dashboardStyles.includes(".ticket-indent-branch"));
    assert.ok(dashboardStyles.includes(".unsynced-inline-badge"));
    assert.ok(dashboardStyles.includes("@media (prefers-reduced-motion: no-preference)"));
    assert.ok(dashboardStyles.includes("@keyframes dashboard-spin"));
  });

  test("選択行・選択コメントのソフトブルーハイライトと High Contrast・Forced Colors を備える", () => {
    assert.ok(!dashboardStyles.includes("color-mix(in oklab,"));
    assert.ok(
      dashboardStyles.includes(
        "background-color: color-mix(in srgb, color-mix(in srgb, var(--vscode-list-activeSelectionBackground, #04395e) 65%, #1177bb) 80%, var(--vscode-sideBar-background, var(--app-bg)));",
      ),
    );
    assert.ok(
      dashboardStyles.includes(
        "body:focus-within .ticket-row.selected, body:focus-within .ticket-row.is-unsynced.selected",
      ),
    );
    assert.ok(
      dashboardStyles.includes(
        "background-color: color-mix(in srgb, var(--vscode-list-activeSelectionBackground, #04395e) 60%, #1177bb);",
      ),
    );
    assert.ok(
      dashboardStyles.includes(
        "body.vscode-light .ticket-row.selected, body.vscode-light .ticket-row.is-unsynced.selected",
      ),
    );
    assert.ok(
      dashboardStyles.includes(
        "background-color: color-mix(in srgb, color-mix(in srgb, var(--vscode-list-activeSelectionBackground, #0060c0) 55%, #0066cc) 28%, var(--vscode-sideBar-background, var(--app-bg)));",
      ),
    );
    assert.ok(
      dashboardStyles.includes(
        "body.vscode-light:focus-within .ticket-row.selected, body.vscode-light:focus-within .ticket-row.is-unsynced.selected",
      ),
    );
    assert.ok(
      dashboardStyles.includes(
        "background-color: color-mix(in srgb, color-mix(in srgb, var(--vscode-list-activeSelectionBackground, #0060c0) 55%, #0066cc) 38%, var(--vscode-sideBar-background, var(--app-bg)));",
      ),
    );
    assert.ok(dashboardStyles.includes("#detail-comments .comment-card.selected,"));
    assert.ok(dashboardStyles.includes("#detail-comments .comment-card.is-editable.selected:hover,"));
    assert.ok(dashboardStyles.includes("body:focus-within #detail-comments .comment-card.selected,"));
    assert.ok(dashboardStyles.includes("body.vscode-light #detail-comments .comment-card.selected,"));
    assert.ok(dashboardStyles.includes("body.vscode-light:focus-within #detail-comments .comment-card.selected,"));
    assert.ok(dashboardStyles.includes("body.vscode-high-contrast .ticket-row.selected"));
    assert.ok(dashboardStyles.includes("body.vscode-high-contrast:focus-within .ticket-row.selected"));
    assert.ok(dashboardStyles.includes("body.vscode-high-contrast-light .ticket-row.selected"));
    assert.ok(dashboardStyles.includes("body.vscode-high-contrast #detail-comments .comment-card.selected"));
    assert.ok(dashboardStyles.includes("body.vscode-high-contrast:focus-within #detail-comments .comment-card.selected"));
    assert.ok(dashboardStyles.includes("body.vscode-high-contrast-light #detail-comments .comment-card.selected"));
    assert.ok(dashboardStyles.includes("body.vscode-high-contrast-light:focus-within #detail-comments .comment-card.selected"));
    const forcedColorsStart = dashboardStyles.indexOf("@media (forced-colors: active)");
    assert.ok(forcedColorsStart >= 0);
    const forcedColorsCss = dashboardStyles.slice(forcedColorsStart);
    assert.ok(forcedColorsCss.includes(".ticket-row.selected"));
    assert.ok(forcedColorsCss.includes(".comment-card.selected"));
    assert.ok(forcedColorsCss.includes("Highlight"));
  });

  test("コメントパネル縦リサイズ用ハンドル・スタイル・状態管理を備える", () => {
    const html = buildDashboardHtml("nonce", buildDashboardStrings());
    assert.ok(html.includes('id="detail-resize-handle"'));
    assert.ok(html.includes('role="separator"'));
    assert.ok(html.includes('aria-orientation="horizontal"'));
    assert.ok(html.includes('aria-controls="ticket-detail-card"'));
    assert.ok(html.includes('tabindex="0"'));
    assert.ok(dashboardStyles.includes(".detail-resize-handle"));
    assert.ok(dashboardStyles.includes("--detail-panel-height"));
    assert.ok(dashboardStyles.includes("body.is-resizing-detail"));
    assert.ok(dashboardWebviewScript.includes("detailHeightPercent"));
    assert.ok(dashboardWebviewScript.includes("is-resizing-detail"));
    assert.ok(dashboardWebviewScript.includes("--detail-panel-height"));
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
    assert.ok(timelineCss.includes("height: 80px;"));
    assert.ok(timelineCss.includes("overflow-y: auto;"));
    assert.ok(timelineCss.includes("overflow-x: hidden;"));
    assert.ok(timelineCss.includes("overflow-wrap: anywhere;"));
  });

  test("チケット詳細パネルのボタンが他パネルと同様に border-radius: 2px を持つ", () => {
    const drawerStart = dashboardStyles.indexOf("/* Comments-only Detail Drawer");
    assert.ok(drawerStart >= 0);
    const drawerAndTimelineCss = dashboardStyles.slice(drawerStart);
    assert.match(drawerAndTimelineCss, /#detail-cancel-btn\s*\{[^}]*border-radius:\s*2px;/);
    assert.match(drawerAndTimelineCss, /#add-comment-btn\s*\{[^}]*border-radius:\s*2px;/);
    assert.match(drawerAndTimelineCss, /#reload-comments-btn\s*\{[^}]*border-radius:\s*2px;/);
    assert.match(drawerAndTimelineCss, /\.comment-hover-action-btn\s*\{[^}]*border-radius:\s*2px;/);
  });

  test("コメント追加ボタンは＋アイコンのみで、コメント一覧のホバー編集アイコンを持たない", () => {
    assert.ok(
      dashboardWebviewScript.includes(
        `id="add-comment-btn" type="button" title="'+esc(STRINGS.addCommentAction)+'" aria-label="'+esc(STRINGS.addCommentAction)+'">'+actionIcon('child')+'</button>`
      )
    );
    assert.ok(!dashboardWebviewScript.includes("<span>'+esc(STRINGS.addCommentAction)+'</span>"));
    assert.ok(!dashboardWebviewScript.includes("comment-edit-icon"));
    assert.ok(!dashboardWebviewScript.includes("data-edit-comment"));
    assert.ok(!dashboardStyles.includes(".comment-edit-icon"));
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
    assert.ok(dashboardWebviewScript.includes("data-ticket-action=\"sync\""));
    assert.ok(dashboardWebviewScript.includes("data-ticket-action=\"browser\""));
    assert.ok(dashboardWebviewScript.includes("data-draft-action=\"sync\""));
    assert.ok(!dashboardWebviewScript.includes("detail-sync-btn"));
    assert.ok(!dashboardWebviewScript.includes("detail-browser-btn"));
    assert.ok(!dashboardWebviewScript.includes("detail-subject"));
    assert.ok(!dashboardWebviewScript.includes("detail-project-name"));
    assert.ok(dashboardWebviewScript.includes("#NEW"));
    assert.ok(!dashboardWebviewScript.includes("ticket-progress"));
  });
});
