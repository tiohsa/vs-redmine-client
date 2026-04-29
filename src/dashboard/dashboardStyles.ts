/** Dashboard Webview CSS — light / dark / high-contrast theme対応 */
export const dashboardStyles = String.raw`
/* ── Design tokens (mm-*) ────────────────────────────────────── */
:root {
  --mm-brand-blue: #1456f0;
  --mm-sky-blue: #3daeff;
  --mm-primary-200: #bfdbfe;
  --mm-primary-500: #3b82f6;
  --mm-primary-600: #2563eb;
  --mm-primary-700: #1d4ed8;
  --mm-brand-pink: #ea5ec1;

  --mm-text: #222222;
  --mm-text-strong: #18181b;
  --mm-text-secondary: #45515e;
  --mm-text-muted: #8e8e93;

  --mm-bg: #ffffff;
  --mm-surface: #ffffff;
  --mm-surface-subtle: #f8f9fb;
  --mm-border: #e5e7eb;
  --mm-border-subtle: #f2f3f5;

  --mm-radius-button: 8px;
  --mm-radius-control: 13px;
  --mm-radius-card: 18px;
  --mm-radius-hero-card: 22px;
  --mm-radius-pill: 9999px;

  --mm-shadow-subtle: rgba(0,0,0,0.08) 0px 4px 6px;
  --mm-shadow-brand: rgba(44,30,116,0.16) 0px 0px 15px;

  --font-ui: "DM Sans","Noto Sans JP",var(--vscode-font-family),system-ui,-apple-system,sans-serif;
  --font-display: "Outfit","DM Sans","Noto Sans JP",var(--vscode-font-family),system-ui,sans-serif;
}

body {
  --app-bg: var(--vscode-sideBar-background, var(--mm-bg));
  --app-surface: var(--vscode-editor-background, var(--mm-surface));
  --app-surface-subtle: var(--vscode-sideBarSectionHeader-background, var(--mm-surface-subtle));
  --app-text: var(--vscode-foreground, var(--mm-text));
  --app-text-secondary: var(--vscode-descriptionForeground, var(--mm-text-secondary));
  --app-text-muted: var(--vscode-disabledForeground, var(--mm-text-muted));
  --app-text-readable-muted: var(--vscode-descriptionForeground, #45515e);
  --app-border: var(--vscode-panel-border, var(--mm-border));
  --app-card-border: var(--vscode-panel-border, var(--mm-border));
  --app-focus: var(--vscode-focusBorder, var(--mm-brand-blue));
  --app-accent: var(--mm-brand-blue);
  --app-accent-hover: var(--mm-primary-600);
  --app-hover: rgba(20,86,240,0.07);
  --app-selected: rgba(20,86,240,0.12);
  --app-shadow: var(--mm-shadow-subtle);
}

body.vscode-light {
  --app-bg: var(--vscode-sideBar-background, #ffffff);
  --app-surface: var(--vscode-editor-background, #ffffff);
  --app-surface-subtle: #f8f9fb;
  --app-hover: rgba(20,86,240,0.07);
  --app-selected: rgba(20,86,240,0.12);
  --app-card-border: #e5e7eb;
  --app-text-readable-muted: #45515e;
  --app-shadow: rgba(44,30,116,0.12) 0 0 15px;
}

body.vscode-dark {
  --app-bg: var(--vscode-sideBar-background, #181e25);
  --app-surface: var(--vscode-editor-background, #22262e);
  --app-surface-subtle: rgba(255,255,255,0.04);
  --app-hover: rgba(96,165,250,0.12);
  --app-selected: rgba(96,165,250,0.18);
  --app-card-border: var(--vscode-panel-border, #2e3340);
  --app-text-readable-muted: var(--vscode-descriptionForeground, #c8d2dc);
  --app-shadow: none;
}

body.vscode-high-contrast {
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
  font-size:13px;
  color:var(--app-text);
  background:var(--app-bg);
  height:100vh;
  display:flex;
  flex-direction:column;
  overflow:hidden;
  line-height:1.5;
}

#header{padding:10px 12px 8px;border-bottom:1px solid var(--app-border);background:var(--app-bg);flex-shrink:0}
#header h1{font-family:var(--font-display);font-size:14px;font-weight:600;color:var(--app-text);letter-spacing:-.01em;margin-bottom:8px;line-height:1.5}
#header-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.project-select{flex:1;min-width:0;padding:4px 8px;background:var(--vscode-dropdown-background, var(--app-surface));color:var(--vscode-dropdown-foreground, var(--app-text));border:1px solid var(--vscode-input-border, var(--app-border));border-radius:var(--mm-radius-button);font:inherit;font-size:12px;cursor:pointer;max-width:180px}
.project-select:focus{outline:1px solid var(--app-focus);outline-offset:1px}
.toggle-children{display:flex;align-items:center;gap:4px;font-size:11.5px;color:var(--app-text-readable-muted);cursor:pointer;user-select:none;white-space:nowrap}
.toggle-children input{accent-color:var(--app-accent)}
.btn-icon{width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--app-text-readable-muted);border-radius:var(--mm-radius-button);cursor:pointer;font-size:15px;flex-shrink:0;transition:background .15s}
.btn-icon:hover{background:var(--app-hover);color:var(--app-accent)}
.btn-icon:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px}

#tabs{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid var(--app-border);flex-shrink:0;overflow-x:auto;scrollbar-width:none}
#tabs::-webkit-scrollbar{display:none}
.tab{padding:6px 12px;border-radius:var(--mm-radius-pill);font-size:12px;font-weight:500;color:var(--app-text-readable-muted);cursor:pointer;border:1px solid transparent;white-space:nowrap;user-select:none;transition:background .15s,color .15s;display:flex;align-items:center;gap:5px}
.tab:hover{background:var(--app-hover);color:var(--app-accent)}
.tab:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px}
.tab.active{background:var(--app-selected);color:var(--app-accent);border-color:color-mix(in srgb,var(--app-accent) 30%,transparent)}
body.vscode-high-contrast .tab.active{border-color:var(--app-border);background:transparent;text-decoration:underline}
.tab-badge{min-width:16px;height:16px;padding:0 4px;border-radius:var(--mm-radius-pill);background:var(--app-accent);color:#fff;font-size:10px;font-weight:600;display:flex;align-items:center;justify-content:center}

#content{flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0}
.tab-panel{display:none;flex:1;flex-direction:column;overflow:hidden;min-height:0}
.tab-panel.active{display:flex}

#filter-bar{padding:8px 12px;border-bottom:1px solid var(--app-border);flex-shrink:0}
#search-row{display:flex;gap:6px;align-items:center}
#search-input{flex:1;padding:5px 10px;background:var(--vscode-input-background, var(--app-surface));color:var(--vscode-input-foreground, var(--app-text));border:1px solid var(--vscode-input-border, var(--app-border));border-radius:var(--mm-radius-pill);font:inherit;font-size:12px;outline:none;transition:border .15s}
#search-input:focus{outline:1px solid var(--app-focus);outline-offset:1px}
#search-input::placeholder{color:var(--app-text-readable-muted)}
#filter-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.filter-chip{display:flex;align-items:center;gap:4px;padding:2px 8px 2px 10px;background:var(--app-selected);color:var(--app-accent);border-radius:var(--mm-radius-pill);font-size:11px;font-weight:500;cursor:pointer;border:1px solid transparent}
.filter-chip:hover{border-color:var(--app-accent)}
.filter-chip-x{display:inline-block;width:12px;height:12px;margin-left:2px;position:relative;opacity:.7}
.filter-chip-x::before,.filter-chip-x::after{content:'';position:absolute;top:50%;left:50%;width:8px;height:1.5px;background:currentColor;border-radius:1px}
.filter-chip-x::before{transform:translate(-50%,-50%) rotate(45deg)}
.filter-chip-x::after{transform:translate(-50%,-50%) rotate(-45deg)}

#ticket-scroll{flex:1;overflow-y:auto;min-height:0;border-bottom:1px solid color-mix(in srgb,var(--app-border) 75%,var(--app-text) 25%)}
.ticket-row{position:relative;display:flex;align-items:center;gap:6px;padding:6px 12px;cursor:pointer;border-bottom:1px solid var(--app-border);transition:background .1s}
.ticket-row:hover{background:var(--app-hover)}
.ticket-row.selected{background:var(--app-selected)}
.ticket-row.selected::before{content:"";position:absolute;left:0;top:6px;bottom:6px;width:3px;border-radius:var(--mm-radius-pill);background:var(--app-accent)}
.ticket-row:focus-visible{outline:1px solid var(--app-focus);outline-offset:-1px}
.ticket-row.child-row{border-left:2px solid var(--app-accent)}
.child-connector{font-size:10px;color:var(--app-text-readable-muted);flex-shrink:0;line-height:1;margin-right:1px}
body.vscode-high-contrast .ticket-row.selected{border-left:3px solid var(--app-border)}
.ticket-indent{width:0;flex-shrink:0}
.expand-btn{background:none;border:none;cursor:pointer;padding:1px 3px;border-radius:4px;color:var(--app-text-readable-muted);font-size:11px;width:18px;min-width:18px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;line-height:1}
.expand-btn:hover{background:var(--app-hover);color:var(--app-accent)}
.expand-btn:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px;background:var(--app-hover)}
body.vscode-high-contrast .expand-btn:focus-visible{outline:2px solid var(--app-focus)}
.expand-placeholder{display:inline-block;width:18px;min-width:18px;flex-shrink:0}
.ticket-id{font-size:11px;color:var(--app-text-readable-muted);white-space:nowrap;flex-shrink:0;min-width:auto;font-weight:700;padding:1px 6px;border:1px solid var(--app-card-border);border-radius:var(--mm-radius-pill);background:var(--app-surface-subtle);font-variant-numeric:tabular-nums}
.ticket-subject{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;min-width:40px}
.badges{display:flex;gap:3px;flex-shrink:1;flex-wrap:wrap;justify-content:flex-end;min-width:0}
.badge{padding:2px 7px;border-radius:var(--mm-radius-pill);font-size:10.5px;font-weight:500;white-space:nowrap;background:var(--app-surface-subtle);color:var(--app-text-readable-muted);border:1px solid var(--app-card-border)}
.badge.priority-high{background:#fff0f0;color:#c0392b;border-color:#fca5a5}
.badge.priority-low{background:#f0fff4;color:#15803d;border-color:#86efac}
.badge.sync-dirty{background:#fff7ed;color:#b45309;border-color:#fcd34d}
.badge.sync-queued{background:#eff6ff;color:var(--app-accent);border-color:var(--mm-primary-200)}
.badge.sync-conflict{background:#fef2f2;color:#b91c1c;border-color:#fca5a5}
.badge.sync-failed{background:#fef2f2;color:#b91c1c;border-color:#fca5a5}
.badge.sync-syncing{background:#f0fdf4;color:#15803d;border-color:#bbf7d0}
body.vscode-high-contrast .badge,body.vscode-high-contrast .unsynced-kind-label{background:transparent;border-color:var(--app-border)}
body.vscode-high-contrast .badge.priority-high,body.vscode-high-contrast .badge.priority-low,body.vscode-high-contrast .badge.sync-dirty,body.vscode-high-contrast .badge.sync-queued,body.vscode-high-contrast .badge.sync-conflict,body.vscode-high-contrast .badge.sync-failed,body.vscode-high-contrast .badge.sync-syncing{background:transparent;color:var(--app-text);border-color:var(--app-border)}
.load-more-row{padding:10px 12px;text-align:center;color:var(--app-accent);font-size:12px;cursor:pointer;font-weight:500}
.load-more-row:hover{text-decoration:underline}

.ticket-detail-card{flex-shrink:0;margin:0 8px 8px;padding:10px;background:var(--app-surface);border:1px solid var(--app-card-border);border-top:3px solid color-mix(in srgb,var(--app-accent) 55%,var(--app-border) 45%);border-radius:8px;box-shadow:var(--app-shadow);display:flex;flex-direction:column;gap:6px}
body.vscode-high-contrast .ticket-detail-card{border-top-color:var(--app-border)}
.detail-head{display:flex;align-items:flex-start;gap:8px;justify-content:space-between}
.detail-title{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;line-height:1.35;min-width:0}
.detail-title span:last-child{overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.detail-toggle{width:22px;height:22px;font-size:13px}
.detail-project,.detail-parent,.detail-readonly{font-size:11.5px;color:var(--app-text-readable-muted);line-height:1.35}
.detail-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
.detail-actions .btn{padding:4px 6px;min-width:0}
.detail-expanded{display:flex;flex-direction:column;gap:6px;padding-top:4px;border-top:1px solid var(--app-border)}
.detail-field,.detail-meta{display:grid;grid-template-columns:70px minmax(0,1fr);align-items:center;gap:6px;font-size:11.5px}
.detail-field span,.detail-meta span{color:var(--app-text-readable-muted);font-weight:600}
.detail-select,.detail-input{min-width:0;width:100%;background:var(--vscode-input-background, var(--app-surface));color:var(--vscode-input-foreground, var(--app-text));border:1px solid var(--vscode-input-border, var(--app-border));border-radius:var(--mm-radius-button);font:inherit;font-size:12px;padding:3px 7px}
.detail-input[type="date"]{color-scheme:light dark;padding-right:6px}
.detail-input[type="date"]::-webkit-calendar-picker-indicator{opacity:1;border-radius:4px;padding:2px;background-color:var(--app-text-readable-muted);cursor:pointer}
body.vscode-light .detail-input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(1)}
body.vscode-dark .detail-input[type="date"]::-webkit-calendar-picker-indicator{filter:none}
body.vscode-high-contrast .detail-input[type="date"]::-webkit-calendar-picker-indicator{background-color:var(--app-text);filter:none;border:1px solid var(--app-border)}
.detail-input[type="date"]:focus::-webkit-calendar-picker-indicator{background-color:var(--app-accent)}
.detail-select:disabled,.detail-input:disabled{color:var(--app-text-readable-muted);opacity:.75}
.detail-select:focus,.detail-input:focus{outline:1px solid var(--app-focus);outline-offset:1px}
.detail-meta strong{font-size:11.5px;font-weight:600;color:var(--app-text)}
.ticket-actions{position:relative;display:inline-flex;align-items:center;flex-shrink:0;margin-left:2px}
.ticket-action-btn{opacity:.45;pointer-events:auto;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--app-text-readable-muted);border-radius:var(--mm-radius-button);cursor:pointer;flex-shrink:0;transition:opacity .12s,background .12s,color .12s}
.ticket-row:hover .ticket-action-btn,.ticket-row:focus-within .ticket-action-btn,.ticket-row.selected .ticket-action-btn,.ticket-action-btn[aria-expanded="true"]{opacity:1}
.ticket-action-btn:hover,.ticket-action-btn[aria-expanded="true"]{background:var(--app-hover);color:var(--app-accent)}
.ticket-action-btn:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px;opacity:1;pointer-events:auto}
.icon-more{display:inline-block;width:3px;height:3px;border-radius:50%;background:currentColor;box-shadow:-5px 0 0 currentColor,5px 0 0 currentColor;flex-shrink:0}
.ticket-action-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:30;min-width:138px;padding:5px;background:var(--app-surface);border:1px solid var(--app-card-border);border-radius:var(--mm-radius-control);box-shadow:var(--app-shadow);display:flex;flex-direction:column;gap:2px}
.ticket-action-menu button{width:100%;border:none;background:transparent;color:var(--app-text);border-radius:var(--mm-radius-button);padding:5px 8px;text-align:left;font:inherit;font-size:11.5px;cursor:pointer;line-height:1.4}
.ticket-action-menu button:hover,.ticket-action-menu button:focus-visible{background:var(--app-hover);color:var(--app-accent);outline:none}
body.vscode-high-contrast .ticket-action-btn,body.vscode-high-contrast .ticket-action-menu{border-color:var(--app-border);box-shadow:none}

.btn{padding:4px 12px;border-radius:var(--mm-radius-button);font-size:11.5px;font-weight:600;cursor:pointer;border:none;transition:background .15s;line-height:1.5}
.btn:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px}
.btn-primary{background:var(--app-accent);color:#fff}
.btn-primary:hover{background:var(--app-accent-hover)}
.btn-secondary{background:transparent;color:var(--app-text-readable-muted);border:1px solid var(--app-card-border)}
.btn-secondary:hover{background:var(--app-hover);color:var(--app-accent)}
body.vscode-high-contrast .btn-primary{border:1px solid var(--app-border)}

#unsynced-panel{padding:8px 12px;display:flex;flex-direction:column;gap:4px;overflow-y:auto}
.unsynced-card{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--app-surface);border:1px solid var(--app-card-border);border-radius:var(--mm-radius-card);box-shadow:var(--app-shadow)}
.unsynced-icon{font-size:16px;flex-shrink:0}
.unsynced-body{flex:1;min-width:0}
.unsynced-label{font-size:12.5px;font-weight:500;color:var(--app-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.unsynced-detail{font-size:11px;color:var(--app-text-readable-muted);margin-top:1px}
.unsynced-actions{display:flex;gap:4px;flex-shrink:0}
#sync-all-btn{width:100%;padding:8px;margin-bottom:8px;background:var(--app-accent);color:#fff;border:none;border-radius:var(--mm-radius-button);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;transition:background .15s}
#sync-all-btn:hover{background:var(--app-accent-hover)}
#sync-all-btn:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px}

#comments-panel{padding:8px 12px;overflow-y:auto;display:flex;flex-direction:column;gap:8px}
.comment-card{padding:10px 12px;background:var(--app-surface);border:1px solid var(--app-card-border);border-radius:var(--mm-radius-card);box-shadow:var(--app-shadow)}
.comment-header{display:flex;justify-content:space-between;margin-bottom:6px}
.comment-author{font-size:12px;font-weight:600;color:var(--app-text)}
.comment-date{font-size:11px;color:var(--app-text-readable-muted)}
.comment-body{font-size:12px;color:var(--app-text-secondary);white-space:pre-wrap;word-break:break-word}
.comment-actions{margin-top:6px;display:flex;gap:4px}

#settings-panel{padding:12px;overflow-y:auto}
.settings-section{margin-bottom:16px}
.settings-section h3{font-size:11.5px;font-weight:600;color:var(--app-text-readable-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
.setting-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--app-border);font-size:12.5px;gap:8px}
.setting-label{color:var(--app-text);font-weight:500}
.setting-value{color:var(--app-text-readable-muted);font-size:11.5px}
.setting-input,.setting-select{background:var(--vscode-input-background, var(--app-surface));color:var(--vscode-input-foreground, var(--app-text));border:1px solid var(--vscode-input-border, var(--app-border));border-radius:var(--mm-radius-button);font:inherit;font-size:12px;padding:3px 7px}
.setting-input-num{width:64px;text-align:right}
.setting-input:focus,.setting-select:focus{outline:1px solid var(--app-focus);outline-offset:1px}
.settings-reset-btn{width:100%;margin-top:12px;padding:7px;border:1px solid var(--app-card-border);border-radius:var(--mm-radius-button);background:transparent;color:var(--app-text-readable-muted);font:inherit;font-size:12px;cursor:pointer;transition:background .15s}
.settings-reset-btn:hover{background:var(--app-hover);color:#ef4444}
.settings-reset-btn:focus-visible{outline:1px solid var(--app-focus);outline-offset:1px}

.state-msg{padding:24px 16px;text-align:center;color:var(--app-text-readable-muted);font-size:12.5px;line-height:1.6}
.state-msg strong{display:block;font-size:14px;font-weight:600;color:var(--app-text-secondary);margin-bottom:4px}
.error-msg{color:#ef4444}
.hidden{display:none!important}

.icon-refresh{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%}
.expand-icon{display:inline-block;width:0;height:0;border-style:solid}
.expand-icon.collapsed{border-width:4px 0 4px 6px;border-color:transparent transparent transparent currentColor}
.expand-icon.expanded{border-width:6px 4px 0 4px;border-color:currentColor transparent transparent transparent}
.unsynced-kind-label{font-size:10.5px;font-weight:600;padding:2px 6px;border-radius:var(--mm-radius-pill);background:var(--app-surface-subtle);color:var(--app-text-readable-muted);border:1px solid var(--app-card-border);white-space:nowrap;flex-shrink:0}

.comments-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.comments-header-label{font-size:12px;font-weight:600;color:var(--app-text-readable-muted)}
.comments-header-actions{display:flex;gap:4px}

::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--app-border);border-radius:var(--mm-radius-pill)}

#toast-area{position:fixed;bottom:12px;left:12px;right:12px;z-index:999;display:flex;flex-direction:column;gap:6px;pointer-events:none}
.toast{padding:8px 12px;border-radius:var(--mm-radius-button);font-size:12px;font-weight:500;background:var(--app-surface);color:var(--app-text);border:1px solid var(--app-border);border-left-width:3px;box-shadow:var(--mm-shadow-subtle);pointer-events:auto;opacity:1;transition:opacity .6s ease}
.toast.toast-fade{opacity:0}
.toast.toast-success{border-left-color:#22c55e}
.toast.toast-error{border-left-color:#ef4444}
.toast.toast-warning{border-left-color:#f59e0b}
.toast.toast-info{border-left-color:var(--app-accent)}
body.vscode-high-contrast .toast{border:1px solid var(--app-border);background:var(--app-bg)}
`;
