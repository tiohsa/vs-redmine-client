export const settingsStyles = {
  base: String.raw`/* Settings */
#settings-panel { flex: 1 1 auto; min-width: 0; min-height: 0; overflow-y: auto; padding: 16px 14px 20px; }
#settings-content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.settings-category { display:flex; flex-direction:column; gap:10px; min-width:0; padding:13px; border:1px solid var(--app-border-strong); border-radius:var(--app-radius-card); background:var(--app-surface-raised); }
.settings-category > h2 { margin:0; font-size:14px; }
.settings-category .settings-section { padding:10px; box-shadow:none; background:var(--app-surface); }
.settings-category > .settings-section:first-of-type > h3:first-child { display:none; }
.settings-section { min-width: 0; padding: 13px; border: 1px solid var(--app-border); border-radius: var(--app-radius-card); background: var(--app-surface-raised); box-shadow: var(--app-shadow); }
.settings-section h3 { margin: 0 0 9px; color: var(--app-text); font-size: var(--app-font-body); font-weight: 700; }
.settings-section .maintenance-heading { margin: 12px 0 4px; color: var(--app-text); font-size: var(--app-font-caption); font-weight: 600; }
.settings-section .maintenance-heading:first-of-type { margin-top: 0; }
.maintenance-description { margin: 0 0 8px; color: var(--app-text-secondary); font-size: var(--app-font-caption); line-height: 1.45; }
.maintenance-safety-note { margin: 10px 0 0; color: var(--app-text-secondary); font-size: var(--app-font-label); line-height: 1.45; }
.setting-row { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--app-border-subtle); color: var(--app-text-secondary); font-size: var(--app-font-caption); }
.setting-row:last-child { border-bottom: 0; }
.setting-label { min-width: 0; color: var(--app-text); font-weight: 600; }
.setting-value { min-width: 0; color: var(--app-text-secondary); text-align: right; }
.setting-select { max-width: 180px; }
.setting-input-num { max-width: 72px; text-align: right; }
.setting-check { accent-color: var(--app-accent); }
.setting-row-stacked { align-items: stretch; flex-direction: column; }
.setting-row-stacked .setting-input { width: 100%; max-width: none; }
.setting-warning { margin: 3px 0 7px; color: var(--app-warning); font-size: var(--app-font-label); }
.apikey-status-set { color: var(--app-success); }
.apikey-status-notset { color: var(--app-warning); }
.apikey-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.settings-reset-btn { width: 100%; margin-top: 14px; }
#quick-filter-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; align-items: center; margin-top: 6px; }
.quick-filter-label { color: var(--app-text-readable-muted); font-size: var(--app-font-label); font-weight: 600; white-space: nowrap; }
.quick-filter-select { min-height: 60px; min-width: 0; padding: 3px 6px; border: 1px solid var(--vscode-dropdown-border, var(--app-border)); border-radius: var(--app-radius-sm); background: var(--vscode-dropdown-background, var(--app-surface)); color: var(--vscode-dropdown-foreground, var(--app-text)); font-size: var(--app-font-caption); }
.quick-filter-select:focus { outline: 2px solid var(--app-focus); outline-offset: 1px; }
.quick-filter-select:disabled { opacity: .65; }
.quick-filter-check { display: flex; min-width: 0; align-items: center; gap: 4px; color: var(--app-text-readable-muted); font-size: var(--app-font-label); white-space: nowrap; }
.quick-filter-check input { accent-color: var(--app-accent); }

`,
  compactSections: String.raw`#settings-content { display:block; }
.settings-category { display:block; padding:0; border:0; border-bottom:1px solid var(--app-border); border-radius:0; background:transparent; }
.settings-category > summary { min-height:36px; padding:7px 3px; cursor:pointer; color:var(--app-text); font-size:13px; font-weight:600; }
.settings-category .settings-section { margin:0; padding:4px 4px 10px; border:0; border-top:1px solid var(--app-border-subtle); border-radius:0; background:transparent; }
.settings-category .settings-section:first-of-type { border-top:0; }
.settings-category .settings-section h3 { margin:3px 0 5px; }
.setting-row { padding:6px 0; }
`,
  footerActions: String.raw`.settings-footer-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.settings-footer-actions .settings-reset-btn { margin-top: 0; }
.settings-json-btn { width: 100%; border-radius: 2px; }

`,
};
