import { dashboardStyles } from "./dashboardStyles";
import { dashboardWebviewScript } from "./dashboardWebviewScript";

/** Dashboard Webview HTML を生成する */
export const buildDashboardHtml = (nonce: string): string => `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style nonce="${nonce}">
${dashboardStyles}
</style>
</head>
<body>

<div id="header">
  <div id="header-row">
    <select class="project-select" id="project-select" title="プロジェクトを選択">
      <option value="">— プロジェクトを選択 —</option>
    </select>
    <label class="toggle-children">
      <input type="checkbox" id="include-children"> 子を含める
    </label>
    <button class="btn-icon" id="refresh-btn" title="更新" aria-label="更新"><span class="icon-refresh" aria-hidden="true"></span></button>
    <button class="btn btn-primary btn-primary-new" id="new-ticket-btn" title="新規チケット">新規チケット</button>
  </div>
</div>

<div id="tabs" role="tablist">
  <button class="tab active" role="tab" aria-selected="true" aria-controls="panel-tickets" data-tab="tickets" type="button">チケット</button>
  <button class="tab" role="tab" aria-selected="false" aria-controls="panel-unsynced" data-tab="unsynced" type="button">未同期 <span class="tab-badge hidden" id="unsynced-badge">0</span></button>
  <button class="tab" role="tab" aria-selected="false" aria-controls="panel-comments" data-tab="comments" type="button">コメント</button>
  <button class="tab" role="tab" aria-selected="false" aria-controls="panel-settings" data-tab="settings" type="button">設定</button>
</div>

<div id="content">

  <!-- TICKETS TAB -->
  <div class="tab-panel active" id="panel-tickets" role="tabpanel">
    <div id="filter-bar">
      <div id="search-row">
        <div class="search-box">
          <input id="search-input" type="text" placeholder="チケットを検索…" autocomplete="off">
          <button id="search-clear-btn" class="search-clear-btn hidden" type="button" title="検索をクリア" aria-label="検索をクリア">×</button>
        </div>
      </div>
      <div id="filter-chips"></div>
    </div>
    <div id="ticket-scroll">
      <div id="ticket-list"></div>
      <div id="load-more-row" class="load-more-row hidden"></div>
    </div>
    <div id="ticket-detail-card" class="ticket-work-panel ticket-detail-card hidden"></div>
  </div>

  <!-- UNSYNCED TAB -->
  <div class="tab-panel" id="panel-unsynced" role="tabpanel">
    <div id="unsynced-panel">
      <button id="sync-all-btn" class="hidden">すべて同期</button>
      <div id="unsynced-list"></div>
    </div>
  </div>

  <!-- COMMENTS TAB -->
  <div class="tab-panel" id="panel-comments" role="tabpanel">
    <div id="comments-panel">
      <div id="comments-list"></div>
    </div>
  </div>

  <!-- SETTINGS TAB -->
  <div class="tab-panel" id="panel-settings" role="tabpanel">
    <div id="settings-panel">
      <div id="settings-content"></div>
      <button class="settings-reset-btn" id="settings-reset-btn">設定をリセット</button>
    </div>
  </div>

</div>

<div id="toast-area"></div>

<script nonce="${nonce}">
(function(){
${dashboardWebviewScript}
}());
</script>
</body>
</html>`;
