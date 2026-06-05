/** Dashboard Webview CSS — VS Code ダークテーマ対応 */
export const dashboardStyles = String.raw`
/* ── Design tokens ────────────────────────────────────────────── */
:root {
  --mm-brand-blue: #1456f0;
  --mm-sky-blue: #3daeff;
  --mm-primary-200: #bfdbfe;
  --mm-primary-500: #3b82f6;
  --mm-primary-600: #2563eb;
  --mm-primary-700: #1d4ed8;

  --mm-text: #222222;
  --mm-text-secondary: #45515e;
  --mm-text-muted: #8e8e93;

  --mm-bg: #ffffff;
  --mm-surface: #ffffff;
  --mm-surface-subtle: #f8f9fb;
  --mm-border: #e5e7eb;

  --mm-radius-button: 8px;
  --mm-radius-control: 13px;
  --mm-radius-card: 12px;
  --mm-radius-pill: 9999px;

  --mm-shadow-subtle: rgba(0,0,0,0.08) 0px 4px 6px;

  --font-ui: "DM Sans","Noto Sans JP",var(--vscode-font-family),system-ui,-apple-system,sans-serif;
  --font-display: "Outfit","DM Sans","Noto Sans JP",var(--vscode-font-family),system-ui,sans-serif;
}

body {
  --surface-0: var(--vscode-editor-background, var(--mm-bg));
  --surface-1: color-mix(in srgb, var(--vscode-editor-background, var(--mm-bg)) 92%, white 8%);
  --surface-2: color-mix(in srgb, var(--vscode-editor-background, var(--mm-bg)) 82%, white 18%);
  --border-subtle: color-mix(in srgb, var(--vscode-panel-border, var(--mm-border)) 60%, transparent);

  --app-bg: var(--vscode-sideBar-background, var(--mm-bg));
  --app-surface: var(--surface-0);
  --app-surface-subtle: var(--surface-1);
  --app-text: var(--vscode-editor-foreground, var(--mm-text));
  --app-text-secondary: var(--vscode-descriptionForeground, var(--mm-text-secondary));
  --app-text-muted: var(--vscode-disabledForeground, var(--mm-text-muted));
  --app-text-readable-muted: var(--vscode-descriptionForeground, #45515e);
  --app-border: var(--vscode-panel-border, var(--mm-border));
  --app-card-border: var(--border-subtle);
  --app-focus: var(--vscode-focusBorder, var(--mm-brand-blue));
  --app-accent: var(--vscode-button-background, var(--mm-brand-blue));
  --app-accent-fg: var(--vscode-button-foreground, #fff);
  --app-accent-hover: var(--vscode-button-hoverBackground, var(--mm-primary-600));
  --app-hover: var(--vscode-list-hoverBackground, rgba(20,86,240,0.07));
  --app-selected: var(--vscode-list-activeSelectionBackground, rgba(20,86,240,0.14));
  --app-selected-fg: var(--vscode-list-activeSelectionForeground, var(--app-text));
  --app-inactive-selected: var(--vscode-list-inactiveSelectionBackground, rgba(20,86,240,0.08));
  --app-badge-bg: var(--vscode-badge-background, var(--mm-brand-blue));
  --app-badge-fg: var(--vscode-badge-foreground, #fff);
  --app-shadow: var(--mm-shadow-subtle);
}

body.vscode-light {
  --surface-0: var(--vscode-editor-background, #ffffff);
  --surface-1: color-mix(in srgb, var(--vscode-editor-background, #ffffff) 92%, black 8%);
  --surface-2: color-mix(in srgb, var(--vscode-editor-background, #ffffff) 82%, black 18%);
  --border-subtle: color-mix(in srgb, var(--vscode-panel-border, #e5e7eb) 60%, transparent);
  --app-bg: var(--vscode-sideBar-background, #ffffff);
  --app-surface: var(--surface-0);
  --app-surface-subtle: var(--surface-1);
  --app-card-border: #e5e7eb;
  --app-text-readable-muted: #45515e;
  --app-shadow: rgba(44,30,116,0.10) 0 2px 12px;
}

body.vscode-dark {
  --surface-0: var(--vscode-editor-background, #1e1e1e);
  --surface-1: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 88%, white 12%);
  --surface-2: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 78%, white 22%);
  --border-subtle: color-mix(in srgb, var(--vscode-panel-border, #3c3c3c) 70%, transparent);
  --app-bg: var(--vscode-sideBar-background, #252526);
  --app-surface: var(--surface-0);
  --app-surface-subtle: var(--surface-1);
  --app-card-border: var(--border-subtle);
  --app-text-readable-muted: var(--vscode-descriptionForeground, #9d9d9d);
  --app-hover: var(--vscode-list-hoverBackground, rgba(255,255,255,0.07));
  --app-selected: var(--vscode-list-activeSelectionBackground, rgba(0,120,212,0.22));
  --app-inactive-selected: var(--vscode-list-inactiveSelectionBackground, rgba(0,120,212,0.12));
  --app-shadow: 0 4px 16px rgba(0,0,0,0.32);
}

body.vscode-high-contrast {
  --surface-0: var(--vscode-editor-background);
  --surface-1: var(--vscode-editor-background);
  --surface-2: var(--vscode-editor-background);
  --border-subtle: var(--vscode-contrastBorder);
  --app-bg: var(--vscode-editor-background);
  --app-surface: var(--vscode-editor-background);
  --app-surface-subtle: var(--vscode-editor-background);
  --app-text: var(--vscode-foreground);
  --app-text-secondary: var(--vscode-foreground);
  --app-text-muted: var(--vscode-foreground);
  --app-text-readable-muted: var(--vscode-foreground);
  --app-border: var(--vscode-contrastBorder);
  --app-card-border: var(--vscode-contrastBorder);
  --app-focus: var(--vscode-focusBorder);
  --app-hover: transparent;
  --app-selected: transparent;
  --app-shadow: none;
}

*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:var(--font-ui);
  font-size:var(--vscode-font-size, 11px);
  color:var(--app-text);
  background:var(--app-bg);
  height:100vh;
  display:flex;
  flex-direction:column;
  overflow:hidden;
  line-height:1.5;
}

/* ── Header ──────────────────────────────────────────────────── */
#header{padding:8px 12px 6px;border-bottom:1px solid var(--app-border);background:var(--app-bg);flex-shrink:0}
#header-label{font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--app-text-readable-muted);margin-bottom:6px;line-height:1.4}
#header-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.project-select{flex:1;min-width:0;height:28px;padding:0 8px;background:var(--vscode-dropdown-background, var(--surface-1));color:var(--vscode-dropdown-foreground, var(--app-text));border:1px solid var(--vscode-input-border, var(--app-card-border));border-radius:var(--mm-radius-button);font:inherit;font-size:11px;cursor:pointer;max-width:180px}
.project-select:focus{outline:1px solid var(--app-focus);outline-offset:1px}
.toggle-children{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--app-text-readable-muted);cursor:pointer;user-select:none;white-space:nowrap}
.toggle-children input{accent-color:var(--app-accent)}
.btn-icon{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--app-text-readable-muted);border-radius:var(--mm-radius-button);cursor:pointer;font-size:13px;flex-shrink:0;transition:background .15s,color .15s}
.btn-icon:hover{background:var(--app-hover);color:var(--app-accent)}
.btn-icon:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px}

/* ── Tabs ─────────────────────────────────────────────────────── */
#tabs{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid var(--app-border);flex-shrink:0;overflow-x:auto;scrollbar-width:none}
#tabs::-webkit-scrollbar{display:none}
.tab{height:24px;padding:0 10px;border-radius:var(--mm-radius-pill);font-size:11px;font-weight:500;color:var(--app-text-readable-muted);cursor:pointer;background:var(--surface-1);border:1px solid var(--border-subtle);white-space:nowrap;user-select:none;transition:background .15s,color .15s,border-color .15s;display:flex;align-items:center;gap:5px}
.tab:hover{background:var(--app-hover);color:var(--app-text);border-color:var(--app-card-border)}
.tab:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px}
.tab.active{background:color-mix(in srgb, var(--app-accent) 22%, transparent);color:var(--app-accent);border-color:color-mix(in srgb,var(--app-accent) 45%,transparent)}
body.vscode-high-contrast .tab{background:transparent;border-color:var(--app-border)}
body.vscode-high-contrast .tab.active{border-color:var(--app-border);background:transparent;text-decoration:underline}
.tab-badge{min-width:14px;height:14px;padding:0 3px;border-radius:var(--mm-radius-pill);background:var(--app-badge-bg);color:var(--app-badge-fg);font-size:9px;font-weight:600;display:flex;align-items:center;justify-content:center}

/* ── Content area ─────────────────────────────────────────────── */
#content{flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0}
.tab-panel{display:none;flex:1;flex-direction:column;overflow:hidden;min-height:0}
.tab-panel.active{display:flex}

/* ── Filter bar ───────────────────────────────────────────────── */
#filter-bar{padding:8px 12px;border-bottom:1px solid var(--app-border);flex-shrink:0}
#search-row{display:flex;gap:6px;align-items:center}
.search-box{position:relative;flex:1;display:flex;align-items:center}
#search-input{width:100%;height:28px;padding:0 30px 0 12px;background:var(--vscode-input-background, var(--surface-1));color:var(--vscode-input-foreground, var(--app-text));border:1px solid var(--vscode-input-border, var(--app-card-border));border-radius:var(--mm-radius-pill);font:inherit;font-size:11px;outline:none;transition:border .15s}
#search-input:focus{outline:1px solid var(--app-focus);outline-offset:1px;border-color:var(--app-focus)}
#search-input::placeholder{color:var(--vscode-input-placeholderForeground, var(--app-text-readable-muted))}
.search-clear-btn{position:absolute;right:6px;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--app-text-readable-muted);border-radius:50%;cursor:pointer;font-size:13px;line-height:1;padding:0;transition:background .15s,color .15s;flex-shrink:0}
.search-clear-btn:hover{background:var(--app-hover);color:var(--app-accent)}
.search-clear-btn:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px}
#quick-filter-row{display:grid;grid-template-columns:auto minmax(120px,1fr) auto auto minmax(120px,1fr);gap:6px;align-items:center;margin-top:6px}
.quick-filter-label{font-size:10px;color:var(--app-text-readable-muted);font-weight:600;white-space:nowrap}
.quick-filter-select{min-height:60px;padding:3px 6px;background:var(--vscode-dropdown-background, var(--surface-1));color:var(--vscode-dropdown-foreground, var(--app-text));border:1px solid var(--vscode-input-border, var(--app-card-border));border-radius:var(--mm-radius-button);font:inherit;font-size:11px}
.quick-filter-select:focus{outline:1px solid var(--app-focus);outline-offset:1px}
.quick-filter-select:disabled{opacity:.65}
.quick-filter-check{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--app-text-readable-muted);white-space:nowrap}
.quick-filter-check input{accent-color:var(--app-accent)}
#filter-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.filter-chip{display:flex;align-items:center;gap:4px;padding:1px 7px 1px 9px;background:color-mix(in srgb, var(--app-accent) 15%, transparent);color:var(--app-accent);border-radius:var(--mm-radius-pill);font-size:10px;font-weight:500;cursor:pointer;border:1px solid transparent}
.filter-chip:hover{border-color:var(--app-accent)}
.filter-chip-x{display:inline-block;width:12px;height:12px;margin-left:2px;position:relative;opacity:.7}
.filter-chip-x::before,.filter-chip-x::after{content:'';position:absolute;top:50%;left:50%;width:8px;height:1.5px;background:currentColor;border-radius:1px}
.filter-chip-x::before{transform:translate(-50%,-50%) rotate(45deg)}
.filter-chip-x::after{transform:translate(-50%,-50%) rotate(-45deg)}
@media (max-width: 780px){
  #quick-filter-row{grid-template-columns:1fr}
  .quick-filter-select{min-height:84px}
}

/* ── Ticket list ──────────────────────────────────────────────── */
#ticket-scroll{flex:1;overflow-y:auto;min-height:0;border-bottom:1px solid var(--border-subtle)}
.ticket-row{position:relative;display:flex;align-items:center;gap:6px;padding:3px 10px 3px 12px;min-height:26px;cursor:pointer;border-bottom:1px solid var(--border-subtle);transition:background .1s}
.ticket-row:hover{background:var(--app-hover)}
.ticket-row.selected{background:var(--app-selected)}
.ticket-row.selected .ticket-subject{font-weight:600;color:var(--app-selected-fg)}
.ticket-row.selected::before{content:"";position:absolute;left:0;top:4px;bottom:4px;width:3px;border-radius:var(--mm-radius-pill);background:var(--app-accent)}
.ticket-row:focus-visible{outline:1px solid var(--app-focus);outline-offset:-1px}
.ticket-row.child-row{border-left:1px solid transparent}
.child-connector{font-size:9px;color:color-mix(in srgb, var(--app-text-readable-muted) 60%, transparent);flex-shrink:0;line-height:1;margin-right:1px}
body.vscode-high-contrast .ticket-row.selected{border-left:3px solid var(--app-border)}
.ticket-indent{width:0;flex-shrink:0}
.expand-btn{background:none;border:none;cursor:pointer;padding:1px 3px;border-radius:4px;color:var(--app-text-readable-muted);font-size:10px;width:16px;min-width:16px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;line-height:1}
.expand-btn:hover{background:var(--app-hover);color:var(--app-accent)}
.expand-btn:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px;background:var(--app-hover)}
body.vscode-high-contrast .expand-btn:focus-visible{outline:2px solid var(--app-focus)}
.expand-placeholder{display:inline-block;width:16px;min-width:16px;flex-shrink:0}

/* ID badge */
.ticket-id{font-size:9px;white-space:nowrap;flex-shrink:0;font-weight:600;padding:1px 6px;min-width:36px;text-align:center;border-radius:var(--mm-radius-pill);background:color-mix(in srgb, var(--app-badge-bg) 22%, var(--surface-2));color:var(--app-text);border:1px solid var(--border-subtle);font-variant-numeric:tabular-nums}
.ticket-row.selected .ticket-id{background:color-mix(in srgb, var(--app-accent) 18%, var(--surface-1));border-color:color-mix(in srgb, var(--app-accent) 35%, transparent)}

.ticket-subject{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;min-width:40px;color:var(--app-text)}
.badges{display:flex;gap:3px;flex-shrink:1;flex-wrap:wrap;justify-content:flex-end;min-width:0}

/* Sync / priority badges */
.badge{padding:1px 5px;border-radius:var(--mm-radius-pill);font-size:9px;font-weight:500;white-space:nowrap;background:var(--surface-1);color:var(--app-text-readable-muted);border:1px solid var(--border-subtle)}
.badge.priority-high{background:rgba(192,57,43,0.12);color:#e05d4b;border-color:rgba(192,57,43,0.25)}
.badge.priority-low{background:rgba(21,128,61,0.12);color:#4caf72;border-color:rgba(21,128,61,0.25)}
.badge.sync-dirty{background:rgba(180,83,9,0.12);color:#d4874b;border-color:rgba(180,83,9,0.25)}
.badge.sync-queued{background:rgba(37,99,235,0.12);color:var(--app-accent);border-color:rgba(37,99,235,0.25)}
.badge.sync-conflict{background:rgba(185,28,28,0.12);color:#e05d5d;border-color:rgba(185,28,28,0.25)}
.badge.sync-failed{background:rgba(185,28,28,0.12);color:#e05d5d;border-color:rgba(185,28,28,0.25)}
.badge.sync-syncing{background:rgba(21,128,61,0.12);color:#4caf72;border-color:rgba(21,128,61,0.25)}
.badge.ticket-status{background:color-mix(in srgb, var(--app-accent) 12%, var(--surface-1));color:var(--app-text);border-color:color-mix(in srgb, var(--app-accent) 38%, transparent)}
.badge.due-overdue{background:rgba(185,28,28,0.12);color:#e05d5d;border-color:rgba(185,28,28,0.25)}
.badge.due-1day{background:rgba(180,83,9,0.12);color:#d4874b;border-color:rgba(180,83,9,0.25)}
.badge.due-3days{background:rgba(161,98,7,0.12);color:#ca8a04;border-color:rgba(161,98,7,0.25)}
.badge.due-7days{background:rgba(30,64,175,0.08);color:var(--app-accent);border-color:rgba(30,64,175,0.2)}
body.vscode-high-contrast .badge,.vscode-high-contrast .unsynced-kind-label{background:transparent;border-color:var(--app-border);color:var(--app-text)}
.load-more-row{padding:8px 12px;text-align:center;color:var(--app-accent);font-size:11px;cursor:pointer;font-weight:500}
.load-more-row:hover{text-decoration:underline}

/* ── Ticket detail card (sticky bottom panel) ─────────────────── */
.ticket-detail-card{
  flex-shrink:0;
  margin:8px 8px 8px;
  padding:6px;
  background:color-mix(in srgb, var(--vscode-panel-background, var(--surface-0)) 94%, black 6%);
  border:1px solid var(--vscode-panel-border, var(--app-card-border));
  border-top:2px solid color-mix(in srgb, var(--app-accent) 45%, transparent);
  border-radius:var(--mm-radius-card);
  box-shadow:var(--app-shadow);
  display:flex;
  flex-direction:column;
  gap:8px
}
.ticket-detail-card.composer-popover{
  position:fixed;
  left:var(--composer-popover-left, 8px);
  top:var(--composer-popover-top, 48px);
  width:var(--composer-popover-width, min(420px, calc(100vw - 16px)));
  max-width:420px;
  max-height:var(--composer-popover-max-height, calc(100vh - 56px));
  margin:0;
  overflow:auto;
  z-index:50;
  box-shadow:0 14px 36px rgba(0,0,0,0.28);
}
.ticket-work-panel{}
.work-panel-head{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
.work-panel-title{font-size:11px;font-weight:600;color:var(--app-text)}
.work-panel-subtitle{font-size:10px;color:var(--app-text-readable-muted)}
.composer-grid{display:flex;flex-direction:column;gap:6px}
.composer-grid-detail{padding-top:2px}
.composer-detail-field{grid-template-columns:70px minmax(0,1fr);font-size:10px}
.composer-description-field{align-items:flex-start}
.composer-description-field span{padding-top:4px}
.composer-required{color:#ef4444;font-size:11px}
.composer-textarea{min-height:60px;resize:vertical;line-height:1.5;padding-top:3px;padding-bottom:3px;font-size:11px}
body.vscode-high-contrast .ticket-detail-card{border-top-color:var(--app-border)}
.detail-head{display:flex;align-items:flex-start;gap:8px;justify-content:space-between}
.detail-title{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;line-height:1.35;min-width:0}
.detail-title span:last-child{overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.detail-toggle{width:20px;height:20px;font-size:11px}
.detail-project,.detail-parent,.detail-readonly{font-size:10px;color:var(--app-text-readable-muted);line-height:1.35}
.detail-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.detail-actions .btn{padding:4px 6px;min-width:0;font-size:11px}
.detail-expanded{display:flex;flex-direction:column;gap:6px;padding-top:8px;border-top:1px solid var(--border-subtle)}
.detail-field,.detail-meta{display:grid;grid-template-columns:70px minmax(0,1fr);align-items:center;gap:6px;font-size:10px}
.detail-field span,.detail-meta span{color:var(--app-text-readable-muted);font-weight:600}
.detail-select,.detail-input{min-width:0;width:100%;background:var(--vscode-input-background, var(--surface-1));color:var(--vscode-input-foreground, var(--app-text));border:1px solid var(--vscode-input-border, var(--app-card-border));border-radius:var(--mm-radius-button);font:inherit;font-size:11px;padding:2px 7px}
.detail-input[type="date"]{color-scheme:light dark;padding-right:6px}
.detail-input[type="date"]::-webkit-calendar-picker-indicator{opacity:1;border-radius:4px;padding:2px;background-color:var(--app-text-readable-muted);cursor:pointer}
body.vscode-light .detail-input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(1)}
body.vscode-dark .detail-input[type="date"]::-webkit-calendar-picker-indicator{filter:none}
body.vscode-high-contrast .detail-input[type="date"]::-webkit-calendar-picker-indicator{background-color:var(--app-text);filter:none;border:1px solid var(--app-border)}
.detail-input[type="date"]:focus::-webkit-calendar-picker-indicator{background-color:var(--app-accent)}
.detail-select:disabled,.detail-input:disabled{color:var(--app-text-readable-muted);opacity:.75}
.detail-select:focus,.detail-input:focus{outline:1px solid var(--app-focus);outline-offset:1px}
.detail-meta strong{font-size:10px;font-weight:600;color:var(--app-text)}

/* ── Ticket action menu (三点メニュー) ────────────────────────── */
.ticket-actions{position:relative;display:inline-flex;align-items:center;flex-shrink:0;margin-left:2px}
.ticket-action-btn{opacity:.45;pointer-events:auto;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--app-text-readable-muted);border-radius:var(--mm-radius-pill);cursor:pointer;flex-shrink:0;transition:opacity .12s,background .12s,color .12s}
.ticket-row:hover .ticket-action-btn,.ticket-row:focus-within .ticket-action-btn,.ticket-row.selected .ticket-action-btn,.ticket-action-btn[aria-expanded="true"]{opacity:1}
.ticket-action-btn:hover,.ticket-action-btn[aria-expanded="true"]{background:var(--app-hover);color:var(--app-accent)}
.ticket-action-btn:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px;opacity:1;pointer-events:auto}
.icon-more{display:inline-block;width:3px;height:3px;border-radius:50%;background:currentColor;box-shadow:-5px 0 0 currentColor,5px 0 0 currentColor;flex-shrink:0}
.ticket-action-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:30;min-width:138px;padding:5px;background:var(--surface-1);border:1px solid var(--app-card-border);border-radius:var(--mm-radius-control);box-shadow:0 4px 20px rgba(0,0,0,0.24);display:flex;flex-direction:column;gap:2px}
.ticket-action-menu button{width:100%;border:none;background:transparent;color:var(--app-text);border-radius:var(--mm-radius-button);padding:5px 10px;text-align:left;font:inherit;font-size:10px;cursor:pointer;line-height:1.4}
.ticket-action-menu button:hover,.ticket-action-menu button:focus-visible{background:var(--app-hover);color:var(--app-accent);outline:none}
body.vscode-high-contrast .ticket-action-btn,body.vscode-high-contrast .ticket-action-menu{border-color:var(--app-border);box-shadow:none}

/* ── Buttons ──────────────────────────────────────────────────── */
.btn{display:inline-flex;align-items:center;justify-content:center;padding:4px 10px;border-radius:var(--mm-radius-button);font-size:11px;font-weight:600;cursor:pointer;border:none;transition:background .15s;line-height:1.5}
.btn:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px}
.btn-primary{background:var(--app-accent);color:var(--app-accent-fg)}
.btn-primary:hover{background:var(--app-accent-hover)}
.btn-secondary{background:var(--surface-1);color:var(--app-text);border:1px solid var(--border-subtle)}
.btn-secondary:hover{background:var(--app-hover);color:var(--app-accent);border-color:color-mix(in srgb, var(--app-accent) 35%, transparent)}
.btn.btn-primary-new{height:28px;padding:0 12px}
body.vscode-high-contrast .btn-primary{border:1px solid var(--app-border)}

/* ── Unsynced panel ───────────────────────────────────────────── */
#unsynced-panel{padding:8px 12px;display:flex;flex-direction:column;gap:4px;overflow-y:auto}
.unsynced-card{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-1);border:1px solid var(--app-card-border);border-radius:var(--mm-radius-card);box-shadow:var(--app-shadow)}
.unsynced-icon{font-size:14px;flex-shrink:0}
.unsynced-body{flex:1;min-width:0}
.unsynced-label{font-size:11px;font-weight:500;color:var(--app-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.unsynced-detail{font-size:10px;color:var(--app-text-readable-muted);margin-top:1px}
.unsynced-actions{display:flex;gap:4px;flex-shrink:0}
#sync-all-btn{width:100%;height:30px;margin-bottom:8px;background:var(--app-accent);color:var(--app-accent-fg);border:none;border-radius:var(--mm-radius-button);font:inherit;font-size:11px;font-weight:600;cursor:pointer;transition:background .15s}
#sync-all-btn:hover{background:var(--app-accent-hover)}
#sync-all-btn:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px}

/* ── Comments panel ───────────────────────────────────────────── */
#comments-panel{padding:8px 12px;overflow-y:auto;display:flex;flex-direction:column;gap:8px}
.comment-card{padding:10px 12px;background:var(--surface-1);border:1px solid var(--app-card-border);border-radius:var(--mm-radius-card);box-shadow:var(--app-shadow)}
.comment-header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px}
.comment-meta{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.comment-status{display:flex;align-items:center;gap:4px;flex-shrink:0}
.comment-author{font-size:11px;font-weight:600;color:var(--app-text)}
.comment-date,.comment-id{font-size:10px;color:var(--app-text-readable-muted)}
.comment-body{font-size:11px;color:var(--app-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.comment-actions{margin-top:6px;display:flex;gap:4px}

/* ── Settings panel ───────────────────────────────────────────── */
#settings-panel{padding:12px;overflow-y:auto}
.settings-section{margin-bottom:16px}
.settings-section h3{font-size:10px;font-weight:600;color:var(--app-text-readable-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
.setting-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-size:11px;gap:8px}
.setting-label{color:var(--app-text);font-weight:500}
.setting-value{color:var(--app-text-readable-muted);font-size:10px}
.setting-input,.setting-select{background:var(--vscode-input-background, var(--surface-1));color:var(--vscode-input-foreground, var(--app-text));border:1px solid var(--vscode-input-border, var(--app-card-border));border-radius:var(--mm-radius-button);font:inherit;font-size:11px;padding:2px 7px}
.setting-input-num{width:64px;text-align:right}
.setting-input:focus,.setting-select:focus{outline:1px solid var(--app-focus);outline-offset:1px}
.settings-reset-btn{width:100%;margin-top:12px;padding:5px;border:1px solid var(--app-card-border);border-radius:var(--mm-radius-button);background:transparent;color:var(--app-text-readable-muted);font:inherit;font-size:11px;cursor:pointer;transition:background .15s}
.settings-reset-btn:hover{background:var(--app-hover);color:#ef4444}
.settings-reset-btn:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px}
.apikey-status{font-size:10px;font-weight:600}
.apikey-status-set{color:var(--vscode-notificationsInfoIcon-foreground,#3b82f6)}
.apikey-status-notset{color:var(--vscode-notificationsWarningIcon-foreground,#f59e0b)}
.apikey-actions{display:flex;gap:6px;padding-top:8px}
.apikey-btn{font-size:11px;padding:3px 10px;height:auto}

/* ── Misc ─────────────────────────────────────────────────────── */
.state-msg{padding:20px 16px;text-align:center;color:var(--app-text-readable-muted);font-size:11px;line-height:1.6}
.state-msg strong{display:block;font-size:12px;font-weight:600;color:var(--app-text-secondary);margin-bottom:4px}
.error-msg{color:#ef4444}
.hidden{display:none!important}

.icon-refresh{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%}
.expand-icon{display:inline-block;width:0;height:0;border-style:solid}
.expand-icon.collapsed{border-width:4px 0 4px 6px;border-color:transparent transparent transparent currentColor}
.expand-icon.expanded{border-width:6px 4px 0 4px;border-color:currentColor transparent transparent transparent}
.unsynced-kind-label{font-size:9px;font-weight:600;padding:1px 5px;border-radius:var(--mm-radius-pill);background:var(--surface-1);color:var(--app-text-readable-muted);border:1px solid var(--app-card-border);white-space:nowrap;flex-shrink:0}

.comments-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.comments-header-label{font-size:11px;font-weight:600;color:var(--app-text-readable-muted)}
.comments-header-actions{display:flex;gap:4px}

/* ── Scrollbar ────────────────────────────────────────────────── */
::-webkit-scrollbar{width:10px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--vscode-scrollbarSlider-background, var(--app-border)) 80%, transparent);border-radius:var(--mm-radius-pill);border:2px solid transparent;background-clip:content-box}
::-webkit-scrollbar-thumb:hover{background:var(--vscode-scrollbarSlider-hoverBackground, var(--app-card-border));background-clip:content-box}

/* ── Work panel composer ──────────────────────────────────── */
.composer-error{margin:8px 16px 0;padding:6px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:var(--mm-radius-button);font-size:11px;color:#ef4444;line-height:1.5}
body.vscode-high-contrast .composer-error{background:transparent;border-color:var(--app-border);color:var(--app-text)}
.composer-loading{padding:20px 16px;text-align:center;color:var(--app-text-readable-muted);font-size:11px}
.composer-actions{display:flex;gap:8px;justify-content:flex-end;padding:12px 16px 16px;border-top:1px solid var(--border-subtle)}
.composer-actions-top{padding:0 0 8px;border-top:none}
.composer-actions .btn{padding:4px 8px;font-size:11px;min-width:0}
.composer-actions .btn:disabled{opacity:.5;cursor:not-allowed}

/* ── Toast ────────────────────────────────────────────────────── */
#toast-area{position:fixed;bottom:12px;left:12px;right:12px;z-index:999;display:flex;flex-direction:column;gap:6px;pointer-events:none}
.toast{padding:7px 12px;border-radius:var(--mm-radius-button);font-size:11px;font-weight:500;background:var(--surface-1);color:var(--app-text);border:1px solid var(--app-card-border);border-left-width:3px;box-shadow:0 4px 16px rgba(0,0,0,0.2);pointer-events:auto;opacity:1;transition:opacity .6s ease}
.toast.toast-fade{opacity:0}
.toast.toast-success{border-left-color:#22c55e}
.toast.toast-error{border-left-color:#ef4444}
.toast.toast-warning{border-left-color:#f59e0b}
.toast.toast-info{border-left-color:var(--app-accent)}
body.vscode-high-contrast .toast{border:1px solid var(--app-border);background:var(--app-bg)}
`;
