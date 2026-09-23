import { dashboardActionIcon } from "./dashboardActionIcons";
import { DashboardStrings } from "./dashboardI18n";
import { dashboardStyles } from "./dashboardStyles";
import { dashboardWebviewScript } from "./dashboardWebviewScript";

/** Dashboard Webview HTML を生成する */
export const buildDashboardHtml = (nonce: string, strings: DashboardStrings): string => `<!DOCTYPE html>
<html lang="${strings.language.replace(/[^a-zA-Z0-9-]/g, '') || 'en'}">
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
    <div class="project-field"><label class="field-label sr-only" for="project-select">${strings.selectProjectTitle}</label><select class="project-select" id="project-select" title="${strings.selectProjectTitle}"><option value="">${strings.selectProjectPlaceholder}</option></select></div>
    <label class="toggle-children" for="include-children"><input type="checkbox" id="include-children"><span>${strings.includeChildren}</span></label>
    <div class="header-actions">
      <button class="btn btn-secondary btn-icon-label" id="refresh-btn" type="button" title="${strings.refresh}" aria-label="${strings.refresh}">${dashboardActionIcon("refresh")}<span class="btn-label">${strings.refresh}</span></button>
      <button class="btn btn-primary btn-primary-new" id="new-ticket-btn" type="button" title="${strings.newTicket}" aria-label="${strings.newTicket}">${dashboardActionIcon("child")}<span>${strings.newTicket}</span></button>
    </div>
  </div>
</header>
<div id="tabs" role="tablist" aria-label="${strings.dashboardTitle}">
  <button class="tab active" id="tab-tickets" role="tab" aria-selected="true" aria-controls="panel-tickets" data-tab="tickets" tabindex="0" type="button">${strings.tabTickets}</button>
  <button class="tab" id="tab-unsynced" role="tab" aria-selected="false" aria-controls="panel-unsynced" data-tab="unsynced" tabindex="-1" type="button">${strings.tabUnsynced} <span class="tab-badge hidden" id="unsynced-badge" aria-label="0">0</span></button>
  <button class="tab" id="tab-settings" role="tab" aria-selected="false" aria-controls="panel-settings" data-tab="settings" tabindex="-1" type="button">${strings.tabSettings}</button>
</div>
<main id="content">
  <section class="tab-panel active" id="panel-tickets" role="tabpanel" aria-labelledby="tab-tickets">
    <div class="tickets-layout">
      <div class="tickets-master">
        <div id="filter-bar"><div id="search-row"><div class="search-box"><label class="sr-only" for="search-input">${strings.searchPlaceholder}</label><svg class="action-icon search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg><input id="search-input" type="text" role="searchbox" placeholder="${strings.searchPlaceholder}" autocomplete="off"><button id="search-clear-btn" class="search-clear-btn hidden" type="button" title="${strings.clearSearch}" aria-label="${strings.clearSearch}">×</button></div><button class="filter-tool-btn" id="advanced-filters-btn" aria-haspopup="dialog" type="button" title="${strings.advancedFilters}" aria-label="${strings.advancedFilters}">${dashboardActionIcon("filter")}<span id="advanced-filter-count" class="tool-count hidden"></span></button><div class="layout-control"><button class="filter-tool-btn" id="layout-btn" type="button" aria-expanded="false" aria-controls="layout-popover" title="${strings.layoutModeLabel}" aria-label="${strings.layoutModeLabel}">${dashboardActionIcon("layout")}</button></div></div><div class="quick-filter-row" role="group" aria-label="${strings.quickFiltersLabel}"><button class="quick-filter" data-quick-filter="mine" aria-pressed="false" type="button">${strings.quickMyIssues}</button><button class="quick-filter" data-quick-filter="open" aria-pressed="false" type="button">${strings.quickOpen}</button><button class="quick-filter" data-quick-filter="overdue" aria-pressed="false" type="button">${strings.quickOverdue}</button><button class="quick-filter" data-quick-filter="unsynced" aria-pressed="false" type="button">${strings.quickUnsynced}</button></div><div class="filter-summary"><span id="ticket-count" class="ticket-count" role="status"></span><div id="filter-chips" aria-live="polite"></div></div></div>
        <div id="ticket-scroll"><div id="ticket-list" role="list" aria-label="${strings.tabTickets}"></div><button id="load-more-row" class="load-more-row hidden" type="button"></button></div>
      </div>
      <div class="tickets-detail"><div id="ticket-detail-empty" class="state-msg">${strings.selectTicketHint}</div><div id="ticket-detail-card" class="ticket-work-panel ticket-detail-card hidden"></div></div>
    </div>
  </section>
  <section class="tab-panel" id="panel-unsynced" role="tabpanel" aria-labelledby="tab-unsynced" hidden>
    <div id="unsynced-panel"><div class="unsynced-header"><div><h2 class="panel-title">${strings.tabUnsynced}</h2><p class="panel-subtitle" id="unsynced-count-label" aria-live="polite"></p></div><button id="sync-all-btn" class="btn btn-primary hidden" type="button">${dashboardActionIcon("sync")}<span>${strings.syncAllBtn}</span></button></div><div id="unsynced-summary" class="unsynced-summary" aria-live="polite"></div><div id="unsynced-feedback" class="operation-feedback hidden" role="status" aria-live="polite"></div><div id="unsynced-list" role="list"></div></div>
  </section>
  <section class="tab-panel" id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" hidden><div id="settings-panel"><div id="settings-content"></div><button class="btn btn-secondary settings-reset-btn" id="settings-reset-btn" type="button">${strings.resetSettings}</button></div></section>
</main>
<div id="sync-tray" class="sync-tray"></div>
<div id="layout-popover" class="layout-popover hidden"><label for="ticket-layout-mode">${strings.layoutModeLabel}</label><select id="ticket-layout-mode" class="layout-mode-select"><option value="auto">${strings.layoutAuto}</option><option value="single">${strings.layoutSingle}</option><option value="split">${strings.layoutSplit}</option></select></div>
<div id="advanced-filter-dialog" class="filter-dialog hidden" role="dialog" aria-modal="true" aria-labelledby="filter-dialog-title"><div class="filter-dialog-card"><div class="filter-dialog-head"><h2 id="filter-dialog-title">${strings.advancedFilters}</h2><button id="filter-dialog-close" class="btn btn-secondary" type="button" aria-label="${strings.closeFilters}">×</button></div><div id="filter-dialog-fields"></div><div class="filter-dialog-actions"><button id="filter-dialog-reset" class="btn btn-secondary" type="button">${strings.resetFilters}</button><button id="filter-dialog-apply" class="btn btn-primary" type="button">${strings.applyFilters}</button></div></div></div>
<div id="toast-area" role="status" aria-live="polite" aria-atomic="true"></div>
<script nonce="${nonce}">window.STRINGS = ${JSON.stringify(strings)};</script>
<script nonce="${nonce}">(function(){
${dashboardWebviewScript}
}());</script>
</body>
</html>`;
