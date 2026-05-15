import { DashboardStrings } from "./dashboardI18n";
import { dashboardStyles } from "./dashboardStyles";
import { dashboardWebviewScript } from "./dashboardWebviewScript";

/** Dashboard Webview HTML を生成する */
export const buildDashboardHtml = (nonce: string, strings: DashboardStrings): string => `<!DOCTYPE html>
<html lang="en">
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
    <select class="project-select" id="project-select" title="${strings.selectProjectTitle}">
      <option value="">${strings.selectProjectPlaceholder}</option>
    </select>
    <label class="toggle-children">
      <input type="checkbox" id="include-children"> ${strings.includeChildren}
    </label>
    <button class="btn btn-ghost-sm" id="refresh-btn" title="${strings.refresh}" aria-label="${strings.refresh}"><span class="icon-refresh" aria-hidden="true"></span><span class="btn-label-sm">${strings.refresh}</span></button>
    <button class="btn btn-primary btn-primary-new" id="new-ticket-btn" title="${strings.newTicket}"><span class="icon-plus" aria-hidden="true"></span><span>${strings.newTicket}</span></button>
  </div>
</div>

<div id="tabs" role="tablist">
  <button class="tab active" role="tab" aria-selected="true" aria-controls="panel-tickets" data-tab="tickets" type="button">${strings.tabTickets}</button>
  <button class="tab" role="tab" aria-selected="false" aria-controls="panel-unsynced" data-tab="unsynced" type="button">${strings.tabUnsynced} <span class="tab-badge hidden" id="unsynced-badge">0</span></button>
  <button class="tab" role="tab" aria-selected="false" aria-controls="panel-comments" data-tab="comments" type="button">${strings.tabComments}</button>
  <button class="tab" role="tab" aria-selected="false" aria-controls="panel-settings" data-tab="settings" type="button">${strings.tabSettings}</button>
</div>

<div id="content">

  <!-- TICKETS TAB -->
  <div class="tab-panel active" id="panel-tickets" role="tabpanel">
    <div id="filter-bar">
      <div id="search-row">
        <div class="search-box">
          <input id="search-input" type="text" placeholder="${strings.searchPlaceholder}" autocomplete="off">
          <button id="search-clear-btn" class="search-clear-btn hidden" type="button" title="${strings.clearSearch}" aria-label="${strings.clearSearch}">×</button>
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
      <button id="sync-all-btn" class="hidden">${strings.syncAllBtn}</button>
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
      <button class="settings-reset-btn" id="settings-reset-btn">${strings.resetSettings}</button>
    </div>
  </div>

</div>

<div id="toast-area"></div>

<script nonce="${nonce}">
window.STRINGS = ${JSON.stringify(strings)};
</script>
<script nonce="${nonce}">
(function(){
${dashboardWebviewScript}
}());
</script>
</body>
</html>`;
