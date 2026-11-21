export const headerStyles = {
  base: String.raw`/* Header */
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
.field-label { color: var(--app-text-secondary); font-size: var(--app-font-caption); font-weight: 600; }
.project-select-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; width: 100%; height: 31px; padding: 0 9px; border: 1px solid var(--vscode-dropdown-border, var(--app-border)); border-radius: var(--app-radius-md); background: var(--vscode-dropdown-background, var(--app-surface)); color: var(--vscode-dropdown-foreground, var(--app-text)); text-align: left; cursor: pointer; }
.project-select-trigger:focus-visible { outline: 2px solid var(--app-focus); outline-offset: 1px; }
.project-select-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-select-chevron { flex: 0 0 auto; color: var(--app-text-secondary); }
.project-picker-popup[hidden] { display: none !important; }
.project-picker-popup { position: fixed; z-index: 80; display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 8px; overflow: hidden; border: 1px solid var(--app-border-strong); border-radius: 2px; background: var(--app-surface); color: var(--app-text); box-shadow: var(--app-shadow); }
.project-picker-popup h2 { margin: 0; }
.project-search-control { display: flex; flex: 0 0 auto; min-width: 0; height: 26px; border: 1px solid var(--vscode-dropdown-border, var(--app-border)); border-radius: 2px; background: var(--vscode-dropdown-background, var(--app-surface)); }
.project-search-input { min-width: 0; width: 100%; padding: 0 8px; border: 0; outline: 0; background: transparent; color: var(--vscode-dropdown-foreground, var(--app-text)); font: inherit; }
.project-search-input:focus-visible { outline: 2px solid var(--app-focus); outline-offset: -2px; border-radius: 2px; }
.project-search-clear { flex: 0 0 26px; border: 0; background: transparent; color: var(--app-text-secondary); cursor: pointer; font: inherit; font-size: 18px; }
.project-search-clear[hidden], .project-search-empty[hidden] { display: none; }
.project-search-empty { margin: 0; color: var(--app-text-secondary); font-size: var(--app-font-caption); }
.project-listbox { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.project-option { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 32px; padding: 4px 8px; border-radius: 2px; cursor: pointer; }
.project-option:hover, .project-option-active { background: var(--app-surface-hover); }
.project-option[aria-selected="true"] .project-option-name { font-weight: 600; }
.project-option-copy { display: flex; min-width: 0; flex-direction: column; }
.project-option-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-option-identifier { overflow: hidden; color: var(--app-text-secondary); font-size: var(--app-font-label); line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
.project-option-check { flex: 0 0 auto; color: var(--app-accent); }
.toggle-children { display: inline-flex; align-items: center; gap: 6px; min-width: 0; height: 32px; color: var(--app-text-secondary); font-size: var(--app-font-caption); white-space: nowrap; }
.toggle-children input { accent-color: var(--app-accent); }
.toggle-children[hidden] { display: none; }
.header-actions { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }

`,
  compactHeader: String.raw`/* Dashboard 全体の密度。色とフォーカスは VS Code のテーマトークンを使う。 */
.dashboard-header { margin:0; padding:3px 8px; border:0; border-bottom:1px solid var(--app-border-subtle); border-radius:0; background:var(--app-bg); }
.header-row { align-items:center; gap:6px; flex-wrap:nowrap; }
.project-field { flex:1 1 110px; max-width:none; }
.project-select-trigger { width:100%; height:28px; }
.toggle-children { order:0; flex:0 0 auto; height:28px; gap:0; }
.toggle-children-btn { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; padding:0; border:1px solid var(--app-border); border-radius:var(--app-radius-sm); background:var(--app-surface); color:var(--app-text-secondary); cursor:pointer; }
.toggle-children-btn:hover { background:var(--app-surface-hover); color:var(--app-text); }
.toggle-children-btn[aria-pressed="true"] { border-color:var(--app-focus); background:color-mix(in srgb, var(--app-focus) 18%, var(--app-surface)); color:var(--app-text); }
.toggle-children-btn:focus-visible { outline:2px solid var(--app-focus); outline-offset:2px; }
.header-actions { gap:4px; }
.header-actions .btn { min-height:28px; padding:3px 7px; }
.header-actions #refresh-btn .btn-label { display:none; }
@media (max-width:480px) { .btn-primary-new span { display:none; } }
`,
  sidebarHeader: String.raw`.dashboard-header {
  padding: 6px 10px;
  border-bottom: 0;
  background-color: var(--vscode-sideBar-background, var(--app-bg));
}
.header-row { gap: 6px; }

.project-select-trigger {
  height: 26px;
  padding: 0 8px;
  border-radius: 2px;
  border: 1px solid var(--vscode-input-border, transparent);
  background-color: var(--vscode-input-background, var(--vscode-dropdown-background, var(--app-surface)));
  color: var(--vscode-input-foreground, var(--vscode-dropdown-foreground, var(--app-text)));
  font-size: 12px;
}
.project-select-trigger:focus { border-color: var(--vscode-focusBorder, var(--app-focus)); outline: none; }

.toggle-children { height: 26px; }
.toggle-children-btn {
  width: 26px;
  height: 26px;
  border-radius: 2px;
  border: 1px solid transparent;
  background-color: var(--vscode-button-secondaryBackground, var(--app-surface-raised));
  color: var(--vscode-button-secondaryForeground, var(--app-text));
}
.toggle-children-btn:hover {
  background-color: var(--vscode-button-secondaryHoverBackground, var(--app-surface-hover));
  color: var(--vscode-button-secondaryForeground, var(--app-text));
}
.toggle-children-btn[aria-pressed="true"] {
  border-color: transparent;
  background-color: var(--vscode-button-background, var(--app-accent));
  color: var(--vscode-button-foreground, var(--app-accent-fg));
}
.toggle-children-btn[aria-pressed="true"]:hover {
  background-color: var(--vscode-button-hoverBackground, var(--app-accent-hover));
  color: var(--vscode-button-foreground, var(--app-accent-fg));
}

.header-actions { gap: 2px; }
.header-actions .btn {
  min-height: 26px;
  padding: 3px 6px;
  border-radius: 2px;
  border-color: transparent;
  font-weight: 500;
}
.header-actions .btn-secondary {
  background-color: transparent;
  color: var(--vscode-sideBar-foreground, var(--app-text));
}
.header-actions .btn-secondary:hover {
  background-color: var(--vscode-list-hoverBackground, var(--app-surface-hover));
  border-color: transparent;
  color: var(--vscode-sideBar-foreground, var(--app-text));
}
.header-actions .btn-primary-new {
  background-color: var(--vscode-button-background, var(--app-accent));
  color: var(--vscode-button-foreground, var(--app-accent-fg));
}
.header-actions .btn-primary-new:hover {
  background-color: var(--vscode-button-hoverBackground, var(--app-accent-hover));
}
.btn-icon-only { width: 26px; padding: 0 !important; }
#density-btn[aria-pressed="true"] {
  background-color: var(--vscode-button-background, var(--app-accent));
  color: var(--vscode-button-foreground, var(--app-accent-fg));
}
#density-btn[aria-pressed="true"]:hover {
  background-color: var(--vscode-button-hoverBackground, var(--app-accent-hover));
}
.action-icon { width: 14px; height: 14px; flex-basis: 14px; }

`,
};
