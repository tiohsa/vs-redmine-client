import * as assert from "assert";
import { dashboardStyles } from "../dashboard/dashboardStyles";
import { dashboardWebviewScript } from "../dashboard/dashboardWebviewScript";
import { buildDashboardHtml } from "../dashboard/dashboardHtml";
import { buildDashboardStrings } from "../dashboard/dashboardI18n";

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
});
