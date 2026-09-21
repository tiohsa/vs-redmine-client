/** Dashboard Webview CSS — VS Code Theme Token 対応 */
export const dashboardStyles = String.raw`
:root {
  --app-accent: var(--vscode-button-background, var(--vscode-focusBorder));
  --app-accent-fg: var(--vscode-button-foreground, var(--vscode-editor-background));
  --app-accent-hover: var(--vscode-button-hoverBackground, var(--app-accent));
  --app-link: var(--vscode-textLink-foreground, var(--vscode-foreground));
  --app-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --app-surface: var(--vscode-editor-background, var(--app-bg));
  --app-surface-raised: color-mix(in srgb, var(--vscode-editorWidget-background, var(--app-bg)) 94%, var(--app-text));
  --app-surface-hover: var(--vscode-list-hoverBackground, var(--app-surface-raised));
  --app-selected: var(--vscode-list-activeSelectionBackground, var(--app-surface-hover));
  --app-selected-fg: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
  --app-text: var(--vscode-foreground, var(--vscode-editor-foreground));
  --app-text-secondary: var(--vscode-descriptionForeground, var(--app-text));
  --app-text-readable-muted: var(--vscode-descriptionForeground, var(--app-text));
  --app-text-disabled: var(--vscode-disabledForeground, var(--app-text-secondary));
  --app-border: var(--vscode-contrastBorder, color-mix(in srgb, var(--app-text) 22%, var(--vscode-panel-border, var(--app-surface))));
  --app-border-strong: var(--vscode-contrastBorder, color-mix(in srgb, var(--app-text) 30%, var(--app-surface)));
  --app-border-subtle: var(--vscode-contrastBorder, color-mix(in srgb, var(--app-text) 12%, var(--app-surface)));
  --app-focus: var(--vscode-focusBorder, var(--app-accent));
  --app-badge-bg: var(--vscode-badge-background, var(--app-accent));
  --app-badge-fg: var(--vscode-badge-foreground, var(--app-accent-fg));
  --app-danger: var(--vscode-errorForeground, var(--vscode-notificationsErrorIcon-foreground, var(--app-text)));
  --app-warning: var(--vscode-editorWarning-foreground, var(--vscode-notificationsWarningIcon-foreground, var(--app-text)));
  --app-success: var(--vscode-testing-iconPassed, var(--vscode-charts-green, var(--app-text)));
  --app-radius-sm: 4px;
  --app-radius-md: 8px;
  --app-radius-card: 8px;
  --app-radius-pill: 9999px;
  --app-shadow: 0 4px 14px color-mix(in srgb, var(--app-text) 14%, transparent);
  --app-font: var(--vscode-font-family, system-ui), system-ui, "Noto Sans JP", sans-serif;
}

* { box-sizing: border-box; scrollbar-width: thin; scrollbar-color: var(--vscode-scrollbarSlider-background, color-mix(in srgb, var(--app-text) 30%, transparent)) transparent; }
html, body { width: 100%; height: 100%; }
body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }
body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; }
body {
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--app-bg);
  color: var(--app-text);
  font-family: var(--app-font);
  font-size: var(--vscode-font-size, 13px);
  line-height: 1.5;
}
button, input, select, textarea { font: inherit; }
button { color: inherit; }
button:disabled, input:disabled, select:disabled, textarea:disabled { cursor: not-allowed; opacity: .58; }
.hidden { display: none !important; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

/* Header */
.dashboard-header {
  flex: 0 0 auto;
  margin: 10px 10px 0;
  padding: 12px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-card);
  background: var(--app-surface-raised);
}
.header-row { display: flex; align-items: flex-end; gap: 10px; min-width: 0; }
.project-field { display: flex; min-width: 0; flex: 1 1 220px; max-width: 360px; flex-direction: column; gap: 4px; }
.field-label { color: var(--app-text-secondary); font-size: 11px; font-weight: 600; }
.project-select {
  min-width: 0;
  height: 32px;
  padding: 0 9px;
  border: 1px solid var(--vscode-dropdown-border, var(--app-border));
  border-radius: var(--app-radius-md);
  background: var(--vscode-dropdown-background, var(--app-surface));
  color: var(--vscode-dropdown-foreground, var(--app-text));
}
.toggle-children { display: inline-flex; align-items: center; gap: 6px; min-width: 0; height: 32px; color: var(--app-text-secondary); font-size: 11px; white-space: nowrap; }
.toggle-children input { accent-color: var(--app-accent); }
.header-actions { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }

/* Tabs */
#tabs {
  display: flex;
  flex: 0 0 auto;
  gap: 3px;
  overflow-x: auto;
  padding: 8px 14px;
  border-bottom: 1px solid var(--app-border-strong);
  scrollbar-width: none;
}
#tabs::-webkit-scrollbar { display: none; }
.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 11px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: var(--app-radius-pill);
  background: transparent;
  color: var(--app-text-readable-muted);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.tab:hover { color: var(--app-text); background: var(--app-surface-hover); }
.tab.active { background: var(--app-surface-hover); color: var(--app-text); }
.tab.active::after { position: absolute; right: 10px; bottom: -9px; left: 10px; height: 3px; border-radius: 2px 2px 0 0; background: var(--app-focus); content: ""; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--app-focus); outline-offset: 2px; }
.tab:focus-visible, .btn:focus-visible, .search-clear-btn:focus-visible, .expand-btn:focus-visible, .ticket-row:focus-visible, .setting-check:focus-visible { outline: 2px solid var(--app-focus); outline-offset: 2px; }
.tab-badge { display: inline-flex; min-width: 18px; height: 18px; align-items: center; justify-content: center; padding: 0 5px; border-radius: var(--app-radius-pill); background: var(--app-badge-bg); color: var(--app-badge-fg); font-size: 10px; font-weight: 700; line-height: 1; }

/* Layout */
#content { display: flex; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.tab-panel { display: none; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; }
.tab-panel.active { display: flex; }
.tickets-layout { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; }
.tickets-master, .tickets-detail { display: flex; min-width: 0; min-height: 0; flex-direction: column; }
.tickets-master { container-type: inline-size; flex: 1 1 42%; margin: 12px 0 12px 12px; overflow: hidden; border: 1px solid var(--app-border-strong); border-radius: var(--app-radius-card); background: var(--app-surface-raised); }
.tickets-detail { container-type: inline-size; flex: 1 1 58%; margin: 12px 12px 12px 10px; overflow-y: auto; border-radius: var(--app-radius-card); }

/* Controls and filters */
#filter-bar { flex: 0 0 auto; padding: 12px; border-bottom: 1px solid var(--app-border-subtle); }
#search-row { display: flex; min-width: 0; }
.search-box { position: relative; display: flex; flex: 1 1 auto; min-width: 0; align-items: center; }
#search-input {
  width: 100%;
  height: 36px;
  padding: 0 34px;
  border: 1px solid var(--vscode-input-border, var(--app-border));
  border-radius: var(--app-radius-pill);
  outline: none;
  background: var(--vscode-input-background, var(--app-surface));
  color: var(--vscode-input-foreground, var(--app-text));
}
#search-input::placeholder { color: var(--vscode-input-placeholderForeground, var(--app-text-readable-muted)); }
#search-input:focus { border-color: var(--app-focus); box-shadow: 0 0 0 1px var(--app-focus); }
.search-clear-btn { position: absolute; right: 7px; display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--app-text-secondary); cursor: pointer; }
.search-clear-btn:hover { background: var(--app-surface-hover); color: var(--app-text); }
.filter-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
#filter-chips { display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: 5px; }
.ticket-count { margin-left: auto; color: var(--app-text-secondary); font-size: 10px; font-variant-numeric: tabular-nums; }
.filter-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--app-border); border-radius: var(--app-radius-pill); background: var(--app-surface); color: var(--app-text-secondary); font-size: 10px; }

/* Ticket list */
#ticket-scroll { flex: 1; overflow-y: auto; min-height: 0; background: var(--app-surface); }
#ticket-list { min-width: 0; }
.ticket-row { position: relative; display: flex; align-items: center; gap: 7px; min-width: 0; min-height: 46px; padding: 8px 12px; border-bottom: 1px solid var(--app-border-subtle); cursor: pointer; }
.ticket-row:hover { background: var(--app-surface-hover); }
.ticket-row:focus-visible { outline-offset: -2px; }
.ticket-row.selected { background: var(--app-selected); color: var(--app-selected-fg); }
.ticket-row.selected::before { position: absolute; top: 3px; bottom: 3px; left: 0; width: 4px; border-radius: var(--app-radius-pill); background: var(--app-focus); content: ""; }
.ticket-row.selected .ticket-id, .ticket-row.selected .ticket-action-btn, .ticket-row.selected .expand-btn { color: inherit; }
.ticket-id { flex: 0 0 auto; padding: 2px 6px; border: 1px solid var(--app-border-subtle); border-radius: var(--app-radius-pill); color: var(--app-text-secondary); font-size: 10px; font-variant-numeric: tabular-nums; font-weight: 700; }
.ticket-subject { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.ticket-row.selected .ticket-subject { font-weight: 700; }
.badges { display: flex; flex: 0 1 auto; flex-wrap: wrap; justify-content: flex-end; gap: 4px; min-width: 0; }
.badge { display: inline-flex; align-items: center; gap: 3px; min-width: 0; padding: 2px 6px; border: 1px solid var(--app-border-subtle); border-radius: var(--app-radius-pill); background: var(--app-surface-raised); color: var(--app-text-secondary); font-size: 10px; font-weight: 600; line-height: 1.25; white-space: nowrap; }
.badge-icon { font-size: 11px; line-height: 1; }
.badge.sync-dirty, .badge.sync-queued { border-color: color-mix(in srgb, var(--app-link) 55%, var(--app-border)); color: var(--app-link); }
.badge.sync-conflict, .badge.sync-failed { border-color: color-mix(in srgb, var(--app-danger) 55%, var(--app-border)); color: var(--app-danger); }
.badge.sync-syncing { border-color: color-mix(in srgb, var(--app-success) 55%, var(--app-border)); color: var(--app-success); }
.badge.due-overdue { border-color: color-mix(in srgb, var(--app-danger) 55%, var(--app-border)); color: var(--app-danger); }
.badge.due-1day, .badge.due-3days { border-color: color-mix(in srgb, var(--app-warning) 55%, var(--app-border)); color: var(--app-warning); }
.badge.due-7days { border-color: color-mix(in srgb, var(--app-link) 55%, var(--app-border)); color: var(--app-link); }
.ticket-status { overflow: hidden; text-overflow: ellipsis; }
.ticket-metadata { max-width: 120px; overflow: hidden; text-overflow: ellipsis; display: inline-block; border-color: var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-surface-raised); color: var(--app-text); font-size: 11px; font-weight: 500; line-height: 1.4; }
.ticket-priority { border-color: color-mix(in srgb, var(--app-link) 45%, var(--app-border)); background: color-mix(in srgb, var(--app-link) 10%, var(--app-surface)); }
.avatar { display: inline-flex; flex: 0 0 auto; width: 24px; height: 24px; align-items: center; justify-content: center; border: 1px solid var(--app-border); border-radius: 50%; background: var(--app-surface-raised); color: var(--app-accent); font-size: 10px; font-weight: 700; line-height: 1; }
.ticket-avatar { margin-left: 2px; }
.ticket-actions { position: relative; display: inline-flex; flex: 0 0 auto; }
.ticket-action-btn{opacity:.45;pointer-events:auto;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--app-radius-pill);background:transparent;color:var(--app-text-secondary);cursor:pointer;}
.ticket-row:hover .ticket-action-btn, .ticket-row:focus-within .ticket-action-btn, .ticket-row.selected .ticket-action-btn, .ticket-action-btn[aria-expanded="true"] { opacity: 1; }
.ticket-action-btn:hover, .ticket-action-btn[aria-expanded="true"] { background: var(--app-surface-hover); color: var(--app-accent); }
.ticket-action-menu { position: fixed; z-index: 20; display: flex; min-width: 156px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow-y: auto; flex-direction: column; gap: 2px; padding: 5px; border: 1px solid var(--app-border); border-radius: var(--app-radius-md); background: var(--app-surface-raised); box-shadow: var(--app-shadow); }
.ticket-action-menu button { padding: 6px 9px; border: 0; border-radius: var(--app-radius-sm); background: transparent; color: var(--app-text); cursor: pointer; text-align: left; font-size: 11px; }
.ticket-action-menu button:hover, .ticket-action-menu button:focus-visible { background: var(--app-surface-hover); color: var(--app-accent); outline: 0; }
.expand-btn { display: inline-flex; flex: 0 0 20px; width: 20px; height: 24px; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: var(--app-radius-sm); background: transparent; color: var(--app-text-secondary); cursor: pointer; }
.expand-btn:hover { background: var(--app-surface-hover); color: var(--app-accent); }
.expand-icon { display: inline-block; width: 0; height: 0; border-style: solid; }
.expand-icon.collapsed { border-width: 4px 0 4px 6px; border-color: transparent transparent transparent currentColor; }
.expand-icon.expanded { border-width: 6px 4px 0; border-color: currentColor transparent transparent; }
.expand-placeholder { display: inline-block; flex: 0 0 20px; width: 20px; }
.child-connector { flex: 0 0 auto; color: var(--app-text-secondary); font-size: 12px; }
.load-more-row { display: block; width: 100%; padding: 9px 12px; border: 0; background: transparent; color: var(--app-accent); cursor: pointer; font-size: 11px; text-align: center; }
.load-more-row:hover { background: var(--app-surface-hover); text-decoration: underline; }
.state-msg { padding: 28px 16px; color: var(--app-text-readable-muted); font-size: 12px; text-align: center; }
.state-msg strong { display: block; margin-bottom: 4px; color: var(--app-text); }
.state-msg { overflow-wrap: anywhere; }
.state-msg p { margin: 8px 0 16px; }
.loading-state::before { display: block; width: 20px; height: 20px; margin: 0 auto 10px; border: 2px solid var(--app-border); border-top-color: var(--app-focus); border-radius: 50%; content: ""; animation: dashboard-spin 1s linear infinite; }
@keyframes dashboard-spin { to { transform: rotate(360deg); } }
#ticket-detail-empty { margin: auto; max-width: 360px; }
.error-msg { color: var(--app-danger); }

/* Ticket detail / composer */
.ticket-detail-card { flex: 0 0 auto; padding: 14px; border: 1px solid var(--app-border-strong); border-radius: var(--app-radius-card); background: var(--app-surface-raised); }
.ticket-detail-card.composer-popover { position: fixed; z-index: 50; top: var(--composer-popover-top, 48px); left: var(--composer-popover-left, 8px); width: var(--composer-popover-width, min(420px, calc(100vw - 16px))); max-width: 420px; max-height: var(--composer-popover-max-height, calc(100vh - 56px)); margin: 0; overflow: auto; }
.detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.detail-title { flex: 1 1 auto; flex-wrap: wrap; display: flex; min-width: 0; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; }
.detail-title > span:last-child { overflow-wrap: anywhere; }
.detail-toggle { flex: 0 0 auto; width: 28px; height: 28px; padding: 0; }
.detail-project, .detail-parent, .detail-readonly { margin-top: 6px; color: var(--app-text-readable-muted); font-size: 11px; }
.detail-description { margin: 12px 0; color: var(--app-text-secondary); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.detail-description-collapsed { display: -webkit-box; max-height: 4.5em; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
/* Detail sections follow the storyboard while fitting the sidebar. */
.detail-header-actions { display: flex; flex: 0 0 auto; gap: 4px; align-items: center; }
.detail-header-actions .ticket-action-btn { opacity: 1; }
.detail-project { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
.detail-section { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--app-border-subtle); }
.detail-section h3 { margin: 0; padding-left: 9px; border-left: 3px solid var(--app-focus); font-size: 12px; font-weight: 600; color: var(--app-text); }
.detail-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.detail-metadata-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; }
.detail-meta strong { min-width: 0; color: var(--app-text); font-weight: 500; overflow-wrap: anywhere; }
.detail-hint { margin: 8px 0 0; color: var(--app-text-secondary); font-size: 11px; overflow-wrap: anywhere; }
.detail-sync-state { display: flex; align-items: center; gap: 7px; margin-top: 10px; font-size: 12px; font-weight: 600; }
.detail-sync-state::before { content: ""; width: 8px; height: 8px; border: 1px solid currentColor; border-radius: 50%; background: currentColor; }
.detail-sync-state.sync-dirty, .detail-sync-state.sync-queued { color: var(--app-link); }
.detail-sync-state.sync-failed, .detail-sync-state.sync-conflict { color: var(--app-danger); }
.detail-sync-state.sync-syncing { color: var(--app-link); }
.detail-sync-state.sync-syncing::before { width: 12px; height: 12px; border-width: 2px; border-top-color: transparent; background: transparent; animation: dashboard-spin 1s linear infinite; }
.detail-description-warning { margin: 10px 0; padding: 7px 9px; border-left: 3px solid var(--app-warning); background: color-mix(in srgb, var(--app-warning) 8%, var(--app-surface)); color: var(--app-text); font-size: 11px; overflow-wrap: anywhere; }
.metadata-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
.detail-actions .detail-sync-button { border-color: var(--app-success); }
.detail-sync-button[aria-busy="true"] .action-icon { animation: dashboard-spin 1s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .detail-sync-state.sync-syncing::before, .detail-sync-button[aria-busy="true"] .action-icon { animation: none; }
}
.detail-field, .detail-meta { display: grid; grid-template-columns: minmax(72px, 30%) minmax(0, 1fr); align-items: center; gap: 8px; color: var(--app-text-secondary); font-size: 11px; }
.detail-field > span, .detail-meta > span { font-weight: 600; }
.detail-select, .detail-input, .setting-input, .setting-select { min-width: 0; width: 100%; padding: 5px 7px; border: 1px solid var(--vscode-input-border, var(--app-border)); border-radius: var(--app-radius-sm); background: var(--vscode-input-background, var(--app-surface)); color: var(--vscode-input-foreground, var(--app-text)); }
.detail-select:focus, .detail-input:focus, .setting-input:focus, .setting-select:focus, .project-select:focus { outline: 2px solid var(--app-focus); outline-offset: 1px; }
.detail-input[type="date"] { color-scheme: inherit; }
.detail-input[type="date"]::-webkit-calendar-picker-indicator { opacity: 1; padding: 2px; border-radius: var(--app-radius-sm); background-color: var(--app-text-readable-muted); cursor: pointer; }
.detail-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; margin-top: 14px; }
.detail-actions .btn { min-width: 0; min-height: 34px; padding-inline: 7px; overflow-wrap: anywhere; }
.work-panel-head { display: flex; flex-direction: column; gap: 4px; }
.work-panel-title { color: var(--app-text); font-size: 15px; font-weight: 700; }
.work-panel-subtitle { color: var(--app-text-readable-muted); font-size: 11px; }
.composer-grid { display: flex; flex-direction: column; gap: 7px; margin-top: 12px; }
.composer-detail-field { grid-template-columns: minmax(78px, 30%) minmax(0, 1fr); }
.composer-required { color: var(--app-danger); }
.composer-description-field { align-items: start; }
.composer-textarea { min-height: 76px; resize: vertical; }
.composer-error { margin-top: 9px; padding: 7px 9px; border: 1px solid var(--app-danger); border-radius: var(--app-radius-sm); color: var(--app-danger); font-size: 11px; }
.composer-loading { padding: 24px 0; color: var(--app-text-readable-muted); text-align: center; }
.composer-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--app-border-subtle); }

/* Buttons */
.btn { display: inline-flex; min-height: 30px; align-items: center; justify-content: center; gap: 6px; padding: 5px 11px; border: 1px solid transparent; border-radius: var(--app-radius-md); cursor: pointer; font-size: 11px; font-weight: 700; line-height: 1.3; }
.btn-primary { border-color: var(--app-accent); background: var(--app-accent); color: var(--app-accent-fg); }
.btn-primary:hover { background: var(--app-accent-hover); }
.btn-secondary { border-color: var(--app-border); background: var(--app-surface); color: var(--app-text); }
.btn-secondary:hover { border-color: var(--app-accent); background: var(--app-surface-hover); color: var(--app-accent); }
.btn-icon-label { min-width: 30px; }
.btn-icon-label .btn-label { display: inline; }
.btn-primary-new { white-space: nowrap; }
.icon-refresh { display: inline-block; width: 13px; height: 13px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; }
.icon-plus { position: relative; display: inline-block; width: 12px; height: 12px; }
.icon-plus::before, .icon-plus::after { position: absolute; top: 5px; left: 1px; width: 10px; height: 2px; border-radius: 2px; background: currentColor; content: ""; }
.icon-plus::after { transform: rotate(90deg); }
.icon-sync { position: relative; display: inline-block; width: 13px; height: 13px; border: 2px solid currentColor; border-left-color: transparent; border-radius: 50%; }
.icon-sync::after { position: absolute; right: -3px; bottom: -2px; width: 0; height: 0; border-width: 3px 0 3px 4px; border-style: solid; border-color: transparent transparent transparent currentColor; content: ""; }
.action-icon { flex: 0 0 16px; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.search-icon { position: absolute; left: 12px; color: var(--app-text-secondary); pointer-events: none; }

/* Unsynced */
#unsynced-panel { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; flex-direction: column; gap: 10px; overflow-y: auto; padding: 16px 14px 20px; }
.unsynced-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.panel-title { margin: 0; color: var(--app-text); font-size: 16px; line-height: 1.25; }
.panel-subtitle { margin: 3px 0 0; color: var(--app-text-readable-muted); font-size: 11px; }
.unsynced-summary { display: flex; flex-wrap: wrap; gap: 6px; }
.summary-badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border: 1px solid var(--app-border-subtle); border-radius: var(--app-radius-pill); background: var(--app-surface-raised); color: var(--app-text-secondary); font-size: 10px; font-weight: 600; }
.summary-badge strong { color: var(--app-text); font-variant-numeric: tabular-nums; }
.operation-feedback { padding: 8px 10px; border: 1px solid var(--app-border); border-radius: var(--app-radius-md); background: var(--app-surface-raised); color: var(--app-text); font-size: 11px; }
.operation-feedback.success { border-color: var(--app-success); }
.operation-feedback.warning { border-color: var(--app-warning); }
.operation-feedback.error { border-color: var(--app-danger); color: var(--app-danger); }
#unsynced-list { display: flex; flex-direction: column; gap: 8px; }
.unsynced-card { display: grid; grid-template-columns: max-content minmax(0, 1fr) max-content; align-items: center; gap: 10px; min-width: 0; padding: 11px 12px; border: 1px solid var(--app-border); border-radius: var(--app-radius-card); background: var(--app-surface-raised); box-shadow: var(--app-shadow); }
.unsynced-kind-label { align-self: start; padding: 3px 7px; border: 1px solid var(--app-border-subtle); border-radius: var(--app-radius-pill); color: var(--app-text-secondary); font-size: 10px; font-weight: 700; white-space: nowrap; }
.unsynced-body { min-width: 0; }
.unsynced-label { overflow: hidden; color: var(--app-text); font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.unsynced-detail { margin-top: 3px; overflow-wrap: anywhere; color: var(--app-text-secondary); font-size: 11px; }
.unsynced-state { display: flex; flex-wrap: wrap; gap: 4px; }
.unsynced-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
.unsynced-actions .btn { min-height: 28px; padding-inline: 9px; }

/* Comments */
#comments-panel { flex: 1 1 auto; min-width: 0; min-height: 0; overflow-y: auto; padding: 16px 14px 20px; }
.comments-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.comments-header-label { color: var(--app-text); font-size: 15px; font-weight: 700; }
.comments-header-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.comment-list { display: flex; flex-direction: column; gap: 8px; }
.comment-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; padding: 12px; border: 1px solid var(--app-border); border-radius: var(--app-radius-card); background: var(--app-surface-raised); box-shadow: var(--app-shadow); }
.comment-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.comment-meta { display: flex; min-width: 0; align-items: center; flex-wrap: wrap; gap: 7px; }
.comment-author { color: var(--app-text); font-size: 12px; font-weight: 700; }
.comment-date, .comment-id { color: var(--app-text-readable-muted); font-size: 10px; }
.comment-status { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
.comment-body{font-size:11px;color:var(--app-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.comment-body { grid-column: 1 / -1; }
.comment-actions { grid-column: 2; grid-row: 1; display: flex; flex-wrap: wrap; justify-content: flex-end; align-self: start; gap: 5px; margin-top: 0; }
.comment-actions .btn { min-height: 27px; padding-inline: 9px; }

/* Settings */
#settings-panel { flex: 1 1 auto; min-width: 0; min-height: 0; overflow-y: auto; padding: 16px 14px 20px; }
#settings-content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.settings-section { min-width: 0; padding: 13px; border: 1px solid var(--app-border); border-radius: var(--app-radius-card); background: var(--app-surface-raised); box-shadow: var(--app-shadow); }
.settings-section h3 { margin: 0 0 9px; color: var(--app-text); font-size: 12px; font-weight: 700; }
.setting-row { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--app-border-subtle); color: var(--app-text-secondary); font-size: 11px; }
.setting-row:last-child { border-bottom: 0; }
.setting-label { min-width: 0; color: var(--app-text); font-weight: 600; }
.setting-value { min-width: 0; color: var(--app-text-secondary); text-align: right; }
.setting-select { max-width: 180px; }
.setting-input-num { max-width: 72px; text-align: right; }
.setting-check { accent-color: var(--app-accent); }
.setting-row-stacked { align-items: stretch; flex-direction: column; }
.setting-row-stacked .setting-input { width: 100%; max-width: none; }
.setting-warning { margin: 3px 0 7px; color: var(--app-warning); font-size: 10px; }
.apikey-status-set { color: var(--app-success); }
.apikey-status-notset { color: var(--app-warning); }
.apikey-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.settings-reset-btn { width: 100%; margin-top: 14px; }
#quick-filter-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; align-items: center; margin-top: 6px; }
.quick-filter-label { color: var(--app-text-readable-muted); font-size: 10px; font-weight: 600; white-space: nowrap; }
.quick-filter-select { min-height: 60px; min-width: 0; padding: 3px 6px; border: 1px solid var(--vscode-dropdown-border, var(--app-border)); border-radius: var(--app-radius-sm); background: var(--vscode-dropdown-background, var(--app-surface)); color: var(--vscode-dropdown-foreground, var(--app-text)); font-size: 11px; }
.quick-filter-select:focus { outline: 2px solid var(--app-focus); outline-offset: 1px; }
.quick-filter-select:disabled { opacity: .65; }
.quick-filter-check { display: flex; min-width: 0; align-items: center; gap: 4px; color: var(--app-text-readable-muted); font-size: 10px; white-space: nowrap; }
.quick-filter-check input { accent-color: var(--app-accent); }

/* Toast */
#toast-area { position: fixed; z-index: 999; right: 12px; bottom: 12px; left: 12px; display: flex; flex-direction: column; align-items: stretch; gap: 6px; pointer-events: none; }
.toast { max-width: 560px; align-self: flex-end; padding: 8px 11px; border: 1px solid var(--app-border); border-left: 3px solid var(--app-accent); border-radius: var(--app-radius-md); background: var(--app-surface-raised); color: var(--app-text); box-shadow: var(--app-shadow); font-size: 11px; pointer-events: auto; transition: opacity .2s ease; }
.toast-success { border-left-color: var(--app-success); }
.toast-warning { border-left-color: var(--app-warning); }
.toast-error { border-left-color: var(--app-danger); }
.toast-fade { opacity: 0; }

/* Narrow Sidebar / responsive checkpoints */
@media (max-width: 699px) {
  .dashboard-header { padding: 9px 10px 8px; }
  .header-row { flex-wrap: wrap; }
  .project-field { flex-basis: 140px; max-width: none; }
  .toggle-children { order: 4; flex-basis: 100%; }
  .tickets-layout { flex-direction: column; overflow-y: auto; }
  .tickets-master, .tickets-detail { flex: 0 0 auto; }
  .tickets-master { margin: 8px; }
  .tickets-detail { margin: 8px; }
  .tickets-master { min-height: 180px; }
  .tickets-layout:has(.ticket-detail-card:not(.hidden):not(.composer-popover)) .tickets-master { flex: 0 0 auto; max-height: 40vh; }
  .tickets-detail:has(.ticket-detail-card.hidden) { display: none; }
  .tickets-detail { overflow: visible; }
  .unsynced-card { grid-template-columns: max-content minmax(0, 1fr); }
  .unsynced-state, .unsynced-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .unsynced-actions .btn { flex: 1 1 auto; }
  #settings-content { grid-template-columns: minmax(0, 1fr); }
  .comments-header { flex-direction: column; }
  .comments-header-actions { justify-content: flex-start; }
  .comment-actions { grid-column: 1 / -1; grid-row: 3; justify-content: flex-start; margin-top: 9px; }
  #quick-filter-row { grid-template-columns: minmax(0, 1fr); }
  .quick-filter-select { min-height: 84px; width: 100%; }
  .quick-filter-label { margin-top: 4px; }
  .quick-filter-check { white-space: normal; }
}
@media (max-width: 480px) {
  #tabs { padding-inline: 8px; }
  .tab { padding-inline: 8px; font-size: 11px; }
  .btn-icon-label .btn-label { display: none; }
  .header-actions { margin-left: auto; }
  .header-actions .btn { padding-inline: 8px; }
  .ticket-row { gap: 5px; padding-inline: 8px; }
  .badges { gap: 3px; }
  .ticket-subject { font-size: 11px; }
  .detail-metadata-grid { grid-template-columns: minmax(0, 1fr); }
  .unsynced-header { flex-direction: column; }
  .unsynced-header #sync-all-btn { width: 100%; }
}
@container (max-width: 500px) {
  .detail-metadata-grid { grid-template-columns: minmax(0, 1fr); }
}
@container (max-width: 280px) {
  .detail-actions { grid-template-columns: minmax(0, 1fr); }
  .detail-field, .detail-meta { grid-template-columns: minmax(0, 1fr); gap: 4px; }
}
/* 実際の一覧幅で折り返し、分割表示でも件名と操作を確保する。 */
@container (max-width: 460px) {
  .ticket-row { flex-wrap: wrap; }
  .ticket-subject { flex-basis: calc(100% - 150px); }
  .badges { order: 1; flex-basis: 100%; flex-wrap: wrap; justify-content: flex-start; padding-left: 25px; }
  .badges:empty { display: none; }
}
@media (max-width: 360px) {
  .detail-actions { grid-template-columns: minmax(0, 1fr); }
  .detail-title { font-size: 13px; }
  .project-field { flex-basis: 100%; }
  .header-actions { width: 100%; margin-left: 0; }
  .header-actions .btn { flex: 1 1 0; }
  .unsynced-card { grid-template-columns: minmax(0, 1fr); }
  .unsynced-kind-label, .unsynced-state, .unsynced-actions { grid-column: auto; }
  .unsynced-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 700px) {
  .unsynced-card { grid-template-columns: max-content minmax(0, 1fr) max-content max-content; }
  .unsynced-state { grid-column: 3; }
  .unsynced-actions { grid-column: 4; }
}
@media (min-width: 1000px) {
  .tickets-master { flex-basis: 38%; }
  .tickets-detail { flex-basis: 62%; }
  #settings-content { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .ticket-detail-card { padding: 18px; }
}

body.vscode-high-contrast-light .tab-panel,
body.vscode-high-contrast-light .ticket-row,
body.vscode-high-contrast-light .unsynced-card,
body.vscode-high-contrast-light .comment-card,
body.vscode-high-contrast-light .settings-section,
body.vscode-high-contrast-light .ticket-detail-card,
body.vscode-high-contrast-light .ticket-action-menu,
body.vscode-high-contrast .tab-panel,
body.vscode-high-contrast .ticket-row,
body.vscode-high-contrast .unsynced-card,
body.vscode-high-contrast .comment-card,
body.vscode-high-contrast .settings-section,
body.vscode-high-contrast .ticket-detail-card,
body.vscode-high-contrast .ticket-action-menu { border-color: var(--vscode-contrastBorder, var(--app-border)); box-shadow: none; }
body.vscode-high-contrast .ticket-row.selected { border-left: 3px solid var(--app-focus); }
body.vscode-high-contrast .badge, body.vscode-high-contrast .summary-badge, body.vscode-high-contrast .unsynced-kind-label { border-color: var(--vscode-contrastBorder, var(--app-border)); background: transparent; color: var(--app-text); }
body.vscode-high-contrast .btn-primary { border: 1px solid var(--vscode-contrastBorder, var(--app-border)); }
body.vscode-high-contrast .btn-secondary { border-color: var(--vscode-contrastBorder, var(--app-border)); }
body.vscode-high-contrast .tab.active { border-bottom-width: 3px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; } }

/* Existing renderer contract: retain these compact component selectors for extensions/tests. */
.ticket-id{border-radius:var(--mm-radius-pill);font-variant-numeric:tabular-nums}
.comment-meta{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.comment-status{display:flex;align-items:center;gap:4px;flex-shrink:0}
:root { --mm-radius-pill: var(--app-radius-pill); }
#ticket-scroll{flex:1;overflow-y:auto;min-height:0;border-bottom:1px solid var(--app-border-subtle)}
.ticket-detail-card{border-top:2px solid var(--app-accent)}
.ticket-detail-card.composer-popover{max-width:420px;overflow:auto;z-index:50}
`;
