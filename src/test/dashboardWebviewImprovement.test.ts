import * as assert from "assert";
import { dashboardStyles } from "../dashboard/dashboardStyles";
import { dashboardWebviewScript } from "../dashboard/dashboardWebviewScript";
import { buildDashboardHtml } from "../dashboard/dashboardHtml";
import { buildDashboardStrings } from "../dashboard/dashboardI18n";
import { readFileSync } from "fs";
import { join } from "path";

suite("Dashboard Webview 改善", () => {
  test("readable muted token と ticket ID badge style を定義する", () => {
    assert.ok(dashboardStyles.includes("--app-text-readable-muted"));
    assert.ok(dashboardStyles.includes(".ticket-id"));
    assert.ok(dashboardStyles.includes("font-variant-numeric:tabular-nums"));
    assert.ok(dashboardStyles.includes("border-radius:var(--mm-radius-pill)"));
  });

  test("チケット行操作ボタンは薄く常時操作可能にする", () => {
    assert.ok(dashboardStyles.includes(".ticket-action-btn{opacity:.45;pointer-events:auto"));
  });

  test("Settings DOM に重複項目を生成しない", () => {
    assert.ok(!dashboardWebviewScript.includes("set-subject"));
    assert.ok(!dashboardWebviewScript.includes("set-include-children"));
    assert.ok(!dashboardWebviewScript.includes("件名検索"));
    assert.ok(!dashboardWebviewScript.includes("子プロジェクトを含める"));
  });

  test("selected ticket detail card のコンテナと renderer を持つ", () => {
    assert.ok(buildDashboardHtml("nonce", buildDashboardStrings()).includes("ticket-detail-card"));
    assert.ok(buildDashboardHtml("nonce", buildDashboardStrings()).includes("ticket-work-panel"));
    assert.ok(dashboardWebviewScript.includes("function renderTicketDetail()"));
    assert.ok(dashboardWebviewScript.includes("function renderComposerPanel(panel)"));
    assert.ok(dashboardWebviewScript.includes("ticket.metadata.update"));
    assert.ok(dashboardWebviewScript.includes("ticket.syncSelected"));
    assert.ok(dashboardWebviewScript.includes("ticket.createDraftFromComposer"));
    assert.ok(dashboardWebviewScript.includes("ticket.syncNewTicketDraftFromComposer"));
    assert.ok(dashboardWebviewScript.includes("work-sync-new-ticket"));
    assert.ok(!dashboardWebviewScript.includes("Latest comments"));
  });

  test("開始日と日付ピッカー視認性のスタイルを持つ", () => {
    assert.ok(dashboardWebviewScript.includes("Start date"));
    assert.ok(dashboardWebviewScript.includes('data-metadata-field="start_date"'));
    assert.ok(dashboardStyles.includes('detail-input[type="date"]::-webkit-calendar-picker-indicator'));
    assert.ok(dashboardStyles.includes("body.vscode-high-contrast"));
  });

  test("チケット一覧と詳細カードの境界線を強調する", () => {
    assert.ok(dashboardStyles.includes("#ticket-scroll{flex:1;overflow-y:auto;min-height:0;border-bottom:"));
    assert.ok(dashboardStyles.includes("border-top:2px solid"));
    assert.ok(dashboardStyles.includes("body.vscode-high-contrast .ticket-detail-card"));
  });

  test("ステータスバッジは showStatus 設定のガード付きで描画される", () => {
    assert.ok(dashboardWebviewScript.includes("showStatus !== false"));
  });

  test("期日バッジは showDueDate 設定のガード付きで描画される", () => {
    assert.ok(dashboardWebviewScript.includes("showDueDate !== false"));
  });

  test("コメント本文は先頭行だけを1行省略表示する", () => {
    assert.ok(dashboardWebviewScript.includes("const firstLine=s=>String(s||'').split(/\\r?\\n/)[0]"));
    assert.ok(dashboardWebviewScript.includes("esc(firstLine(cm.body))"));
    assert.ok(dashboardStyles.includes(".comment-body{font-size:11px;color:var(--app-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"));
  });

  test("未同期コメントの同期ボタンは comment key で unsynced.syncOne を送る", () => {
    assert.ok(dashboardWebviewScript.includes("const syncBtn=cm.syncKey"));
    assert.ok(dashboardWebviewScript.includes("data-sync-comment-key"));
    assert.ok(dashboardWebviewScript.includes("JSON.stringify(cm.syncKey)"));
    assert.ok(dashboardWebviewScript.includes("req('unsynced.syncOne',{key:JSON.parse(btn.getAttribute('data-sync-comment-key'))})"));
  });

  test("ローカル未同期コメントは Redmine 操作を条件付きにする", () => {
    assert.ok(dashboardWebviewScript.includes("const editBtn=cm.id?"));
    assert.ok(dashboardWebviewScript.includes("const browserBtn=cm.id?"));
    assert.ok(dashboardWebviewScript.includes("const journalId=cm.id?"));
  });

  test("コメントヘッダーはメタ情報と未同期マークを分離して配置する", () => {
    assert.ok(dashboardWebviewScript.includes("<div class=\"comment-meta\"><span class=\"comment-author\""));
    assert.ok(dashboardWebviewScript.includes("<div class=\"comment-status\">"));
    assert.ok(dashboardStyles.includes(".comment-meta{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}"));
    assert.ok(dashboardStyles.includes(".comment-status{display:flex;align-items:center;gap:4px;flex-shrink:0}"));
  });

  test("コメント同期ボタンも同期中は無効化対象に含める", () => {
    assert.ok(dashboardWebviewScript.includes("[data-sync-key],[data-discard-key],[data-sync-comment-key]"));
    assert.ok(dashboardWebviewScript.includes("list.querySelectorAll('[data-sync-comment-key]')"));
    assert.ok(dashboardWebviewScript.includes("updateSyncButtonStates();\n}\n\n// ── Settings"));
  });

  test("Dashboard コメント一覧は現在ユーザー情報付きでコメントを取得する", () => {
    const source = readFileSync(
      join(__dirname, "..", "dashboard", "services", "DashboardCommentService.js"),
      "utf8",
    );
    assert.ok(source.includes("getCurrentUserId"));
    assert.ok(source.includes("listComments"));
  });

  test("新規チケット composer は New Ticket ボタン近くにだけ popover 表示する", () => {
    assert.ok(dashboardWebviewScript.includes("getBoundingClientRect()"));
    assert.ok(dashboardWebviewScript.includes("panel.mode === 'newTicket'"));
    assert.ok(dashboardWebviewScript.includes("classList.toggle('composer-popover', isNewTicketComposer)"));
    assert.ok(dashboardWebviewScript.includes("panel.mode === 'childTicket' ? STRINGS.createChildTicketTitle"));
    assert.ok(dashboardStyles.includes(".ticket-detail-card.composer-popover"));
    assert.ok(dashboardStyles.includes("max-width:420px"));
    assert.ok(dashboardStyles.includes("overflow:auto"));
    assert.ok(dashboardStyles.includes("z-index:50"));
  });
});
