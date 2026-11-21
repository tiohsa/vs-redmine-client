export const filterStyles = {
  base: String.raw`/* Controls and filters */
#filter-bar { flex: 0 0 auto; padding: 12px; border-bottom: 1px solid var(--app-border-subtle); }
#search-row { display: flex; min-width: 0; align-items: center; gap: 8px; }
.search-box { position: relative; display: flex; flex: 1 1 auto; min-width: 0; align-items: center; }
.layout-mode-select {
  flex: 0 0 auto;
  width: auto;
  max-width: 132px;
  height: 26px;
  padding: 0 7px;
  border: 1px solid var(--vscode-dropdown-border, var(--app-border));
  border-radius: 2px;
  background: var(--vscode-dropdown-background, var(--app-surface));
  color: var(--vscode-dropdown-foreground, var(--app-text));
}
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
.search-clear-btn { position: absolute; right: 7px; display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 2px; background: transparent; color: var(--app-text-secondary); cursor: pointer; }
.search-clear-btn:hover { background: var(--app-surface-hover); color: var(--app-text); }
.filter-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
#filter-chips { display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: 5px; }
.ticket-count { margin-left: auto; color: var(--app-text-secondary); font-size: var(--app-font-label); font-variant-numeric: tabular-nums; }
.filter-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--app-border); border-radius: var(--app-radius-pill); background: var(--app-surface); color: var(--app-text-secondary); font-size: var(--app-font-label); }

`,
  quickFilters: String.raw`.quick-filter-row { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.quick-filter { padding:4px 9px; border:1px solid var(--app-border); border-radius:var(--app-radius-pill); background:var(--app-surface); color:var(--app-text-secondary); cursor:pointer; font-size: var(--app-font-caption); }
.quick-filter:hover { background:var(--app-surface-hover); color:var(--app-text); }
.quick-filter[aria-pressed="true"] { border-color:var(--app-focus); background:color-mix(in srgb,var(--app-focus) 18%,var(--app-surface)); color:var(--app-text); }
.quick-filter[data-preferred="true"][aria-pressed="false"] { border-style:dashed; }
`,
  dialog: String.raw`.filter-dialog { position:fixed; z-index:50; inset:0; display:flex; align-items:center; justify-content:center; padding:16px; background:color-mix(in srgb,var(--app-bg) 65%,transparent); }
.filter-dialog-card { width:min(440px,100%); max-height:min(640px,90vh); overflow:auto; padding:16px; border:1px solid var(--app-border-strong); border-radius:2px; background:var(--app-surface-raised); box-shadow:var(--app-shadow); }
.filter-dialog-head,.filter-dialog-actions { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.filter-dialog-head h2 { margin:0; font-size:15px; }
#filter-dialog-close { width:26px; min-width:26px; height:26px; min-height:26px; padding:0; border-radius:2px; }
#filter-dialog-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:14px 0; }
#filter-dialog-fields label { display:flex; flex-direction:column; gap:4px; min-width:0; font-size: var(--app-font-caption); color:var(--app-text-secondary); }
#filter-dialog-fields input,#filter-dialog-fields select { min-width:0; width:100%; padding:5px; border:1px solid var(--vscode-input-border,var(--app-border)); border-radius:2px; background:var(--vscode-input-background,var(--app-surface)); color:var(--vscode-input-foreground,var(--app-text)); }
#filter-dialog-fields .filter-check { flex-direction:row; align-items:center; }
#filter-dialog-fields .filter-check input { width:auto; }
.filter-dialog-actions { justify-content:flex-end; }
body.vscode-high-contrast .quick-filter,body.vscode-high-contrast-light .quick-filter,body.vscode-high-contrast .toggle-children-btn,body.vscode-high-contrast-light .toggle-children-btn,body.vscode-high-contrast .filter-dialog-card,body.vscode-high-contrast-light .filter-dialog-card,body.vscode-high-contrast .settings-category,body.vscode-high-contrast-light .settings-category { border-color:var(--vscode-contrastBorder,var(--app-border-strong)); box-shadow:none; }
`,
  compactFilters: String.raw`#filter-bar { padding:5px 8px 4px; }
#search-row { gap:5px; }
#search-input { height:28px; padding:0 28px; border-radius:var(--app-radius-sm); }
.search-icon { left:8px; }
.search-clear-btn { width:26px; height:26px; right:1px; }
.filter-tool-btn { display:inline-flex; flex:0 0 28px; width:28px; height:28px; align-items:center; justify-content:center; gap:2px; padding:0 3px; border:1px solid var(--app-border); border-radius:var(--app-radius-sm); background:var(--app-surface); color:var(--app-text); cursor:pointer; }
.filter-tool-btn:hover,.filter-tool-btn[aria-expanded="true"] { background:var(--app-surface-hover); }
.tool-count { position:absolute; top:-5px; right:-5px; min-width:15px; padding:0 2px; border-radius:8px; background:var(--app-badge-bg); color:var(--app-badge-fg); font-size: var(--app-font-label); line-height:15px; }
#advanced-filters-btn { position:relative; }
.layout-control { position:relative; flex:0 0 auto; }
.layout-popover { position:fixed; z-index:30; display:grid; gap:5px; min-width:min(170px,calc(100vw - 16px)); max-width:calc(100vw - 16px); padding:9px; border:1px solid var(--app-border-strong); border-radius:2px; background:var(--app-surface-raised); box-shadow:var(--app-shadow); }
.layout-popover label { font-size: var(--app-font-caption); }
.layout-mode-select { width:100%; max-width:none; height:26px; }
.quick-filter-bar { display:flex; align-items:center; gap:6px; min-width:0; margin-top:4px; }
.quick-filter-row { display:flex; flex:1 1 auto; min-width:0; flex-wrap:nowrap; gap:4px; margin-top:0; overflow-x:auto; padding:1px 0; scrollbar-width:none; }
.quick-filter-row::-webkit-scrollbar { display:none; }
.quick-filter { flex:0 0 auto; min-height:22px; padding:2px 8px; border-radius:var(--app-radius-pill); font-size: var(--app-font-label); line-height:1.3; white-space:nowrap; }
.ticket-count { flex:0 0 auto; margin-left:auto; white-space:nowrap; }
#filter-chips { flex:0 1 auto; margin-top:4px; color:var(--app-text-secondary); font-size: var(--app-font-label); }
#filter-chips:empty { display:none; }
`,
  sidebarFilters: String.raw`#filter-bar {
  padding: 8px;
  border-bottom: 1px solid var(--vscode-sideBar-border, var(--app-border-subtle));
  background-color: var(--vscode-sideBar-background, var(--app-bg));
}
#search-row { gap: 4px; }
#search-input {
  height: 26px;
  padding: 0 24px 0 26px;
  border-radius: 2px;
  border: 1px solid var(--vscode-input-border, transparent);
  background-color: var(--vscode-input-background, var(--app-surface));
  color: var(--vscode-input-foreground, var(--app-text));
  font-size: 12px;
}
#search-input:focus {
  border-color: var(--vscode-focusBorder, var(--app-focus));
  box-shadow: none;
}
.search-icon { left: 7px; width: 12px; height: 12px; opacity: 0.65; }
.search-clear-btn { width: 22px; height: 22px; right: 2px; font-size: 14px; }
.filter-tool-btn {
  width: 26px;
  height: 26px;
  flex-basis: 26px;
  border-radius: 2px;
  border-color: transparent;
  background-color: var(--vscode-button-secondaryBackground, var(--app-surface-raised));
  color: var(--vscode-button-secondaryForeground, var(--app-text));
}
.filter-tool-btn:hover, .filter-tool-btn[aria-expanded="true"] {
  background-color: var(--vscode-button-secondaryHoverBackground, var(--app-surface-hover));
}

.quick-filter-bar { margin-top: 6px; gap: 6px; }
.quick-filter-row { gap: 4px; padding: 0; }
.quick-filter {
  min-height: 20px;
  padding: 2px 8px;
  border-radius: 2px;
  border: 1px solid transparent;
  background-color: var(--vscode-button-secondaryBackground, var(--app-surface-raised));
  color: var(--vscode-button-secondaryForeground, var(--app-text));
  font-size: 11px;
  line-height: 1.35;
}
.quick-filter:hover {
  background-color: var(--vscode-button-secondaryHoverBackground, var(--app-surface-hover));
  color: var(--vscode-button-secondaryForeground, var(--app-text));
}
.quick-filter[aria-pressed="true"] {
  border-color: transparent;
  background-color: var(--vscode-button-background, var(--app-accent));
  color: var(--vscode-button-foreground, var(--app-accent-fg));
}
.quick-filter[aria-pressed="true"]:hover {
  background-color: var(--vscode-button-hoverBackground, var(--app-accent-hover));
  color: var(--vscode-button-foreground, var(--app-accent-fg));
}
.ticket-count { font-size: 10px; opacity: 0.75; }

`,
};
