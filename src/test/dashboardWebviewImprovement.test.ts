import * as assert from "assert";
import { dashboardStyles } from "../dashboard/dashboardStyles";
import { dashboardWebviewScript } from "../dashboard/dashboardWebviewScript";
import { buildDashboardHtml } from "../dashboard/dashboardHtml";
import { buildDashboardStrings } from "../dashboard/dashboardI18n";
import { readFileSync } from "fs";
import { join } from "path";

suite("Dashboard Webview 改善", () => {
  test("3つの主タブ、詳細内コメント、クイックフィルター、同期トレイを持つ", () => {
    const html = buildDashboardHtml("nonce", buildDashboardStrings());
    assert.ok(html.includes('id="tab-tickets"'));
    assert.ok(html.includes('id="tab-unsynced"'));
    assert.ok(html.includes('id="tab-settings"'));
    assert.ok(!html.includes('id="tab-comments"'));
    assert.ok(!html.includes('id="panel-comments"'));
    assert.ok(html.includes('id="sync-tray"'));
    assert.ok(html.includes('id="advanced-filter-dialog"'));
    for (const name of ["mine", "open", "overdue", "unsynced"]) {
      assert.ok(html.includes(`data-quick-filter="${name}"`));
    }
    assert.ok(dashboardWebviewScript.includes('id="detail-tab-overview"'));
    assert.ok(dashboardWebviewScript.includes('id="detail-tab-comments"'));
    assert.ok(dashboardWebviewScript.includes("function renderSyncTray()"));
    assert.ok(dashboardWebviewScript.includes("runTicketAction(button.dataset.detailAction,ticket.id)"));
  });
  test("readable muted token と ticket ID badge style を定義する", () => {
    assert.ok(dashboardStyles.includes("--app-text-readable-muted"));
    assert.ok(dashboardStyles.includes(".ticket-id"));
    assert.ok(dashboardStyles.includes("font-variant-numeric:tabular-nums"));
    assert.ok(dashboardStyles.includes("border-radius:var(--mm-radius-pill)"));
  });

  test("チケット行操作ボタンは常時視認できる", () => {
    assert.ok(dashboardStyles.includes(".ticket-action-btn { opacity:1;"));
  });

  test("Settings DOM に旧フィルター入力を重複生成せず、正式な設定項目を表示する", () => {
    assert.ok(!dashboardWebviewScript.includes("set-subject"));
    assert.ok(dashboardWebviewScript.includes('id="set-include-children"'));
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

  test("詳細属性は概要内で開閉し、同期操作は直接表示する", () => {
    const tabs = dashboardWebviewScript.indexOf("'<div class=\"detail-tabs\"");
    const overview = dashboardWebviewScript.indexOf("'<div id=\"detail-overview\"");
    assert.ok(tabs >= 0 && overview > tabs);
    assert.ok(dashboardWebviewScript.includes("id=\"metadata-details\""));
    assert.ok(dashboardWebviewScript.includes("(metadataExpanded || editing?' open':'')"));
    assert.ok(dashboardWebviewScript.includes("id=\"detail-sync-btn\" type=\"button\""));
    assert.ok(dashboardWebviewScript.includes("req('ticket.syncSelected',{ticketId:ticket.id})"));
  });

  test("チケットレイアウトを自動・1列・2列から手動選択して保持する", () => {
    const html = buildDashboardHtml("nonce", buildDashboardStrings());
    assert.ok(html.includes('id="ticket-layout-mode"'));
    assert.ok(html.includes('id="layout-popover"'));
    assert.ok(html.includes('<option value="auto">'));
    assert.ok(html.includes('<option value="single">'));
    assert.ok(html.includes('<option value="split">'));
    assert.ok(dashboardWebviewScript.includes("vscode.getState()"));
    assert.ok(dashboardWebviewScript.includes("vscode.setState("));
    assert.ok(dashboardWebviewScript.includes("applyTicketLayoutMode()"));
    assert.ok(dashboardStyles.includes(".tickets-layout.layout-single"));
    assert.ok(dashboardStyles.includes(".tickets-layout.layout-split"));
    assert.ok(dashboardStyles.includes("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)"));
  });

  test("2列表示で新規チケット編集パネルを詳細列に収める", () => {
    assert.ok(!dashboardWebviewScript.includes("composer-popover"));
    assert.ok(!dashboardWebviewScript.includes("position: fixed"));
    assert.ok(dashboardStyles.includes("min-width: 0; width: 100%; max-width: 100%"));
  });

  test("Dashboard の更新はヘッダーボタンだけに表示する", () => {
    const strings = buildDashboardStrings();
    const html = buildDashboardHtml("nonce", strings);
    assert.ok(strings.refresh);
    assert.ok(html.includes('id="refresh-btn"'));
    assert.ok(html.includes(strings.refresh));
    assert.ok(!dashboardWebviewScript.includes("data-ticket-action=\"refresh\""));
  });

  test("チケット一覧の三点リーダーメニューから同期できる", () => {
    assert.ok(dashboardWebviewScript.includes("['sync',STRINGS.syncToRedmine]"));
    assert.ok(dashboardWebviewScript.includes("action === 'sync') req('ticket.syncSelected',{ticketId:ticketId})"));
    assert.ok(dashboardWebviewScript.includes('[data-ticket-action="sync"]'));
  });

  test("未同期一覧の要確認は詳細文と重複せずバッジだけに表示する", () => {
    assert.ok(dashboardWebviewScript.includes("const detail=item.detail || ''"));
    assert.ok(!dashboardWebviewScript.includes("const detail=status.requiresReview"));
    assert.ok(dashboardWebviewScript.includes("const ordered=items.slice().sort("));
  });

  test("Discard の操作名と説明文を用意する", () => {
    const strings = buildDashboardStrings();
    assert.ok(strings.discardLaterChangesAction);
    assert.ok(strings.discardLaterChangesTitle);
  });

  test("未同期の新規チケットは文書書き換え対応の同期エンジンを使用する", () => {
    const source = readFileSync(
      join(__dirname, "..", "dashboard", "services", "DashboardUnsyncedService.js"),
      "utf8",
    );
    assert.ok(source.includes('key.kind !== "newTicket" && this.deps.syncEngine'));
  });

  test("開始日と日付ピッカー視認性のスタイルを持つ", () => {
    assert.ok(dashboardWebviewScript.includes("STRINGS.startDate"));
    assert.ok(buildDashboardStrings().startDate);
    assert.ok(dashboardWebviewScript.includes("['start_date',STRINGS.startDate]"));
    assert.ok(dashboardWebviewScript.includes("data-metadata-field=\"'+field[0]+'\""));
    assert.ok(dashboardStyles.includes('detail-input[type="date"]::-webkit-calendar-picker-indicator'));
    assert.ok(dashboardStyles.includes("body.vscode-high-contrast"));
  });

  test("一覧と詳細を個別のスクロール領域にする", () => {
    assert.ok(dashboardStyles.includes("#ticket-scroll{flex:1;overflow-y:auto;min-height:0;border-bottom:"));
    assert.ok(dashboardStyles.includes(".tickets-layout:not(.layout-split):not(.layout-single) .tickets-detail"));
    assert.ok(dashboardStyles.includes("body.vscode-high-contrast .ticket-detail-card"));
  });

  test("ステータスバッジは showStatus 設定のガード付きで描画される", () => {
    assert.ok(dashboardWebviewScript.includes("showStatus !== false"));
  });

  test("期日バッジは showDueDate 設定のガード付きで描画される", () => {
    assert.ok(dashboardWebviewScript.includes("showDueDate !== false"));
  });

  test("トラッカーと優先度のバッジは表示設定のガード付きで描画される", () => {
    assert.ok(dashboardWebviewScript.includes("showTracker !== false"));
    assert.ok(dashboardWebviewScript.includes("showPriority !== false"));
  });

  test("コメント本文は3行プレビューから全文を展開できる", () => {
    assert.ok(dashboardWebviewScript.includes("data-expand-comment"));
    assert.ok(dashboardWebviewScript.includes("esc(cm.body)"));
    assert.ok(dashboardStyles.includes(".comment-body-clamped"));
    assert.ok(dashboardStyles.includes("-webkit-line-clamp:3"));
  });

  test("編集パネルは補足文と三点リーダーメニューを表示しない", () => {
    assert.ok(!dashboardWebviewScript.includes("STRINGS.editorSyncHint"));
    assert.ok(!dashboardWebviewScript.includes("const menuId='detail-'"));
  });

  test("未同期コメントの同期ボタンは comment key で unsynced.syncOne を送る", () => {
    assert.ok(dashboardWebviewScript.includes("const syncBtn=cm.syncKey"));
    assert.ok(dashboardWebviewScript.includes("data-sync-comment-key"));
    assert.ok(dashboardWebviewScript.includes("JSON.stringify(cm.syncKey)"));
    assert.ok(dashboardWebviewScript.includes("req('unsynced.syncOne',{key:JSON.parse(btn.getAttribute('data-sync-comment-key'))})"));
  });

  test("ローカル未同期コメントは Redmine 操作を条件付きにする", () => {
    assert.ok(dashboardWebviewScript.includes("const editBtn=cm.id&&cm.editableByCurrentUser?"));
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

  test("新規チケット composer は詳細領域内に通常配置する", () => {
    assert.ok(dashboardWebviewScript.includes("panel.mode === 'childTicket' ? STRINGS.createChildTicketTitle"));
    assert.ok(!dashboardStyles.includes(".ticket-detail-card.composer-popover"));
  });

  test("監査補修でフィルター表示・説明文省略・未同期件数を維持する", () => {
    assert.ok(dashboardWebviewScript.includes("function renderFilterChips()"));
    assert.ok(dashboardWebviewScript.includes("renderFilterChips();"));
    assert.ok(!dashboardWebviewScript.includes("filter-chip-x"));
    assert.ok(dashboardWebviewScript.includes("detail-description'+(ticketDetailExpanded ? '' : ' detail-description-collapsed')"));
    assert.ok(dashboardStyles.includes(".detail-description-collapsed"));
    assert.ok(dashboardStyles.includes("-webkit-line-clamp: 3"));
    assert.ok(dashboardStyles.includes("max-height: 4.5em"));
    assert.ok(dashboardWebviewScript.includes("STRINGS.unsyncedCountLabel"));
    assert.ok(buildDashboardStrings().unsyncedCountLabel);
  });

  test("未同期 lifecycle は既知状態を安全な表示へ変換する", () => {
    assert.ok(dashboardWebviewScript.includes("queued:{kind:'queued'"));
    assert.ok(dashboardWebviewScript.includes("recovery_pending:{kind:'review'"));
    assert.ok(dashboardWebviewScript.includes("commit_unknown:{kind:'review'"));
    assert.ok(dashboardWebviewScript.includes("conflict:{kind:'conflict'"));
    assert.ok(dashboardWebviewScript.includes("failed:{kind:'failed'"));
    assert.ok(dashboardWebviewScript.includes("UNSYNCED_BADGE_META[lifecycle] || UNSYNCED_BADGE_META.queued"));
    assert.ok(dashboardWebviewScript.includes("const lifecycle=item && typeof item.lifecycle === 'string' ? item.lifecycle : 'queued'"));
  });

  test("ボタン階層・semantic shell・外部依存なしを静的保証する", () => {
    const html = buildDashboardHtml("nonce", buildDashboardStrings());
    assert.ok(html.includes('<header id="header" class="dashboard-header">'));
    assert.ok(html.includes('role="tab"'));
    assert.ok(html.includes('role="tabpanel"'));
    assert.ok(html.includes('aria-selected="true"'));
    assert.ok(html.includes('aria-labelledby="tab-tickets"'));
    assert.ok(html.includes('id="sync-all-btn" class="btn btn-primary'));
    assert.ok(dashboardWebviewScript.includes("data-sync-key=\"'+safeJson(item.key)+'\""));
    assert.ok(dashboardWebviewScript.includes("id=\"add-comment-btn\" type=\"button\">'+actionIcon('comment')+esc(STRINGS.addCommentAction)"));
    assert.ok(dashboardWebviewScript.includes("id=\"reload-comments-btn\" type=\"button\""));
    assert.ok(dashboardStyles.includes("body.vscode-high-contrast"));
    assert.ok(dashboardStyles.includes("@media (max-width: 699px)"));
    assert.ok(dashboardStyles.includes("@media (max-width: 480px)"));
    assert.ok(dashboardStyles.includes("@media (max-width: 360px)"));
    assert.ok(dashboardStyles.includes("@media (min-width: 700px)"));
    assert.ok(dashboardStyles.includes("@media (min-width: 1000px)"));
    assert.ok(!dashboardStyles.includes("http://") && !dashboardStyles.includes("https://"));
    assert.ok(!dashboardWebviewScript.includes("https://"));
  });

  test("狭幅でも同期状態 badge を残し、Unsynced feedback は対象操作だけ更新する", () => {
    assert.ok(dashboardStyles.includes(".ticket-row-meta .badge"));
    assert.ok(!dashboardStyles.includes(".badges .due-7days { display: none; }"));
    assert.ok(dashboardWebviewScript.includes("const unsyncedFeedbackRequests = new Set();"));
    assert.ok(dashboardWebviewScript.includes("type === 'unsynced.syncOne' || type === 'unsynced.syncAll'"));
    assert.ok(dashboardWebviewScript.includes("finishOperation('success',message.requestId,message.message)"));
    assert.ok(dashboardWebviewScript.includes("else if(message.type === 'toast'){ showToast(message.level,message.message); }"));
    assert.ok(!dashboardWebviewScript.includes("else if(message.type === 'toast'){ setOperationFeedback"));
  });

  test("設定パネルの Tickets セクションに表示設定を公開する", () => {
    assert.ok(dashboardWebviewScript.includes("STRINGS.sectionTickets"));
    assert.ok(dashboardWebviewScript.includes('id="set-show-status"'));
    assert.ok(dashboardWebviewScript.includes('id="set-show-due-date"'));
    assert.ok(dashboardWebviewScript.includes('id="set-show-tracker"'));
    assert.ok(dashboardWebviewScript.includes('id="set-show-priority"'));
    assert.ok(dashboardWebviewScript.includes("req('settings.updateGeneral',{patch:{showStatus:this.checked}})"));
    assert.ok(dashboardWebviewScript.includes("req('settings.updateGeneral',{patch:{showDueDate:this.checked}})"));
    assert.ok(dashboardWebviewScript.includes("req('settings.updateGeneral',{patch:{showTracker:this.checked}})"));
    assert.ok(dashboardWebviewScript.includes("req('settings.updateGeneral',{patch:{showPriority:this.checked}})"));
    assert.ok(dashboardWebviewScript.includes("const sections=new Map("));
    assert.ok(dashboardWebviewScript.includes("document.createElement('details')"));
    assert.ok(dashboardWebviewScript.includes("['tickets',STRINGS.sectionTickets"));
  });
});
