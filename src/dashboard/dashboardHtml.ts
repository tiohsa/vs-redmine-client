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
<header id="header" class="dashboard-header">
  <div id="header-row" class="header-row">
    <div class="project-field"><label class="field-label" for="project-select">${strings.selectProjectTitle}</label><select class="project-select" id="project-select" title="${strings.selectProjectTitle}"><option value="">${strings.selectProjectPlaceholder}</option></select></div>
    <label class="toggle-children" for="include-children"><input type="checkbox" id="include-children"><span>${strings.includeChildren}</span></label>
    <div class="header-actions">
      <button class="btn btn-secondary btn-icon-label" id="refresh-btn" type="button" title="${strings.refresh}" aria-label="${strings.refresh}"><span class="icon-refresh" aria-hidden="true"></span><span class="btn-label">${strings.refresh}</span></button>
      <button class="btn btn-primary btn-primary-new" id="new-ticket-btn" type="button" title="${strings.newTicket}"><span class="icon-plus" aria-hidden="true"></span><span>${strings.newTicket}</span></button>
    </div>
  </div>
</header>
<div id="tabs" role="tablist" aria-label="Dashboard">
  <button class="tab active" id="tab-tickets" role="tab" aria-selected="true" aria-controls="panel-tickets" data-tab="tickets" tabindex="0" type="button">${strings.tabTickets}</button>
  <button class="tab" id="tab-unsynced" role="tab" aria-selected="false" aria-controls="panel-unsynced" data-tab="unsynced" tabindex="-1" type="button">${strings.tabUnsynced} <span class="tab-badge hidden" id="unsynced-badge" aria-label="0">0</span></button>
  <button class="tab" id="tab-comments" role="tab" aria-selected="false" aria-controls="panel-comments" data-tab="comments" tabindex="-1" type="button">${strings.tabComments}</button>
  <button class="tab" id="tab-settings" role="tab" aria-selected="false" aria-controls="panel-settings" data-tab="settings" tabindex="-1" type="button">${strings.tabSettings}</button>
</div>
<main id="content">
  <section class="tab-panel active" id="panel-tickets" role="tabpanel" aria-labelledby="tab-tickets">
    <div class="tickets-layout">
      <div class="tickets-master">
        <div id="filter-bar"><div id="search-row"><div class="search-box"><label class="sr-only" for="search-input">${strings.searchPlaceholder}</label><input id="search-input" type="search" placeholder="${strings.searchPlaceholder}" autocomplete="off"><button id="search-clear-btn" class="search-clear-btn hidden" type="button" title="${strings.clearSearch}" aria-label="${strings.clearSearch}">×</button></div></div><div id="filter-chips" aria-live="polite"></div></div>
        <div id="ticket-scroll"><div id="ticket-list" role="list" aria-live="polite"></div><button id="load-more-row" class="load-more-row hidden" type="button"></button></div>
      </div>
      <div class="tickets-detail"><div id="ticket-detail-card" class="ticket-work-panel ticket-detail-card hidden" aria-live="polite"></div></div>
    </div>
  </section>
  <section class="tab-panel" id="panel-unsynced" role="tabpanel" aria-labelledby="tab-unsynced" hidden>
    <div id="unsynced-panel"><div class="unsynced-header"><div><h2 class="panel-title">${strings.tabUnsynced}</h2><p class="panel-subtitle" id="unsynced-count-label" aria-live="polite"></p></div><button id="sync-all-btn" class="btn btn-primary hidden" type="button"><span class="icon-sync" aria-hidden="true"></span><span>${strings.syncAllBtn}</span></button></div><div id="unsynced-summary" class="unsynced-summary" aria-live="polite"></div><div id="unsynced-feedback" class="operation-feedback hidden" role="status" aria-live="polite"></div><div id="unsynced-list" role="list"></div></div>
  </section>
  <section class="tab-panel" id="panel-comments" role="tabpanel" aria-labelledby="tab-comments" hidden><div id="comments-panel"><div id="comments-list"></div></div></section>
  <section class="tab-panel" id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" hidden><div id="settings-panel"><div id="settings-content"></div><button class="btn btn-secondary settings-reset-btn" id="settings-reset-btn" type="button">${strings.resetSettings}</button></div></section>
</main>
<div id="toast-area" role="status" aria-live="polite" aria-atomic="true"></div>
<script nonce="${nonce}">window.STRINGS = ${JSON.stringify(strings)};</script>
<script nonce="${nonce}">(function(){
${dashboardWebviewScript}
}());</script>
</body>
</html>`;
