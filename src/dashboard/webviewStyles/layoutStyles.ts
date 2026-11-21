export const layoutStyles = {
  base: String.raw`/* Tabs */
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
  font-size: var(--app-font-body);
  font-weight: 600;
  white-space: nowrap;
}
.tab:hover { color: var(--app-text); background: var(--app-surface-hover); }
.tab.active { background: var(--app-surface-hover); color: var(--app-text); }
.tab.active::after { position: absolute; right: 10px; bottom: -9px; left: 10px; height: 3px; border-radius: 2px 2px 0 0; background: var(--app-focus); content: ""; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--app-focus); outline-offset: 2px; }
.tab:focus-visible, .btn:focus-visible, .search-clear-btn:focus-visible, .expand-btn:focus-visible, .ticket-row:focus-visible, .setting-check:focus-visible { outline: 2px solid var(--app-focus); outline-offset: 2px; }
.tab-badge { display: inline-flex; min-width: 18px; height: 18px; align-items: center; justify-content: center; padding: 0 5px; border-radius: var(--app-radius-pill); background: var(--app-badge-bg); color: var(--app-badge-fg); font-size: var(--app-font-label); font-weight: 700; line-height: 1; }

/* Layout */
#content { display: flex; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.tab-panel { display: none; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; }
.tab-panel.active { display: flex; }
.tickets-layout { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; }
.tickets-master, .tickets-detail { display: flex; min-width: 0; min-height: 0; flex-direction: column; }
.tickets-master { container-type: inline-size; flex: 1 1 42%; margin: 12px 0 12px 12px; overflow: hidden; border: 1px solid var(--app-border-strong); border-radius: var(--app-radius-card); background: var(--app-surface-raised); }
.tickets-detail { container-type: inline-size; flex: 1 1 58%; margin: 12px 12px 12px 10px; overflow-y: auto; border-radius: var(--app-radius-card); }

`,
  responsive: String.raw`/* Narrow Sidebar / responsive checkpoints */
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
  .tickets-layout:has(.ticket-detail-card:not(.hidden)) .tickets-master { flex: 0 0 auto; max-height: 40vh; }
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
  .tab { padding-inline: 8px; font-size: var(--app-font-caption); }
  .btn-icon-label .btn-label { display: none; }
  .header-actions { margin-left: auto; }
  .header-actions .btn { padding-inline: 8px; }
  .layout-mode-select { max-width: 84px; }
  .ticket-row { gap: 5px; padding-inline: 8px; }
  .badges { gap: 3px; }
  .ticket-subject { font-size: var(--app-font-body); }
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
  .ticket-detail-card { padding: 8px; }
  .composer-actions { align-items: stretch; flex-direction: column; }
  .composer-actions .btn { width: 100%; }
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

/* 手動選択はレスポンシブの自動レイアウトより優先する。 */
.tickets-layout.layout-single { flex-direction: column; overflow-y: auto; }
.tickets-layout.layout-single .tickets-master,
.tickets-layout.layout-single .tickets-detail { flex: 0 0 auto; }
.tickets-layout.layout-single .tickets-master { min-height: 180px; margin: 8px; }
.tickets-layout.layout-single:has(.ticket-detail-card:not(.hidden)) .tickets-master { max-height: 40vh; }
.tickets-layout.layout-single .tickets-detail { margin: 8px; overflow: visible; }
.tickets-layout.layout-single .tickets-detail:has(.ticket-detail-card.hidden) { display: none; }
.tickets-layout.layout-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; padding: 12px; overflow: hidden; }
.tickets-layout.layout-split .tickets-master { min-width: 0; min-height: 0; max-height: none; margin: 0; }
.tickets-layout.layout-split:has(.ticket-detail-card:not(.hidden)) .tickets-master { max-height: none; }
.tickets-layout.layout-split .tickets-detail { display: flex; min-width: 0; min-height: 0; margin: 0; overflow-y: auto; }

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

`,
  narrowControls: String.raw`@media (max-width:480px) { #filter-dialog-fields { grid-template-columns:minmax(0,1fr); } .sync-tray { flex-wrap:wrap; } }

`,
  compactTicketPanels: String.raw`#tabs { gap:0; min-height:30px; padding:0 8px; }
.tab { min-height:30px; padding:0 10px; border-radius:0; font-size: var(--app-font-body); }
.tab.active { background:transparent; border-bottom-color:var(--app-focus); }
.tab.active::after { content:none; }
.tab-badge { min-width:16px; height:16px; padding-inline:4px; }
.tickets-master { margin:0; border:0; border-right:1px solid var(--app-border-subtle); border-radius:0; background:var(--app-surface); }
.tickets-detail { margin:0; padding:0; border-radius:0; background:var(--app-surface); }
.tickets-detail:has(.ticket-detail-card.hidden) { display:none; }
`,
  compactSecondaryPanels: String.raw`#unsynced-panel,#settings-panel { gap:7px; padding:10px; }
`,
  responsiveOverrides: String.raw`@media (max-width:699px) {
  .dashboard-header { padding:4px 7px; }
  .header-row { flex-wrap:nowrap; }
  .project-field { flex-basis:80px; }
  .toggle-children { order:0; flex-basis:auto; }
  .header-actions { width:auto; margin-left:auto; }
  .header-actions .btn { flex:0 0 auto; }
  .tickets-layout:not(.layout-split):not(.layout-single) { flex-direction:column; overflow:hidden; }
  .tickets-layout:not(.layout-split):not(.layout-single) .tickets-master { flex:1 1 52%; min-height:100px; max-height:none; margin:0; }
  .tickets-layout:not(.layout-split):not(.layout-single):has(.ticket-detail-card:not(.hidden)) .tickets-master { flex:1 1 52%; max-height:none; }
  .tickets-layout:not(.layout-split):not(.layout-single) .tickets-detail { flex:0 0 48%; height:48%; min-height:0; margin:0; overflow:hidden; display:flex; flex-direction:column; border-top:0; }
  .tickets-layout:not(.layout-split):not(.layout-single) .tickets-detail:has(.ticket-detail-card.hidden) { display:none; }
  .comments-header { flex-direction:row; }
  .comment-actions { grid-column:auto; grid-row:auto; }
  .unsynced-actions .btn { flex:0 1 auto; }
}
@media (max-width:320px) {
  .header-row { flex-wrap:nowrap; }
  .project-field { flex-basis:80px; min-width:0; }
  .header-actions { width:auto; margin-left:auto; }
  .header-actions .btn { flex:0 0 auto; }
}
@container (max-width:460px) {
  .ticket-row { flex-wrap:nowrap; }
  .ticket-row-main .ticket-subject { flex-basis:auto; }
  .ticket-row-meta { padding-left:0; }
}
@container (max-width:280px) {
  .detail-actions { display:flex; }
  .detail-actions .btn { flex:1 1 auto; }
}
@media (min-width:1000px) {
  .tickets-master { flex-basis:42%; }
  .tickets-detail { flex-basis:58%; }
}
/* 詳細がある間だけ一覧を畳む。閉じると元のレイアウトに戻る。 */
.tickets-layout.layout-detail-focus:has(.ticket-detail-card:not(.hidden)) { display: flex; flex-direction: column; }
.tickets-layout.layout-detail-focus:has(.ticket-detail-card:not(.hidden)) .tickets-master { display: none; }
.tickets-layout.layout-detail-focus:has(.ticket-detail-card:not(.hidden)) .tickets-detail { flex: 1 1 auto; height: auto; width: 100%; max-height: none; border: 0; }
.detail-focus-option { display: flex; align-items: center; gap: 6px; margin-top: 8px; }

`,
  sidebarPanels: String.raw`#tabs {
  gap: 16px;
  min-height: 30px;
  padding: 0 10px;
  border-bottom: 1px solid var(--vscode-sideBar-border, var(--app-border-subtle));
  background-color: var(--vscode-sideBar-background, var(--app-bg));
}
.tab {
  min-height: 28px;
  padding: 5px 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-sideBar-foreground, var(--app-text));
  opacity: 0.75;
}
.tab:hover { opacity: 1; background: transparent; color: var(--vscode-sideBar-foreground, var(--app-text)); }
.tab.active {
  opacity: 1;
  background: transparent;
  border-bottom-color: var(--vscode-focusBorder, var(--app-focus));
  color: var(--vscode-sideBar-foreground, var(--app-text));
}
.tab-badge {
  min-width: 16px;
  height: 16px;
  padding: 0 6px;
  border-radius: 9999px;
  background-color: var(--vscode-badge-background, var(--app-badge-bg));
  color: var(--vscode-badge-foreground, var(--app-badge-fg));
  font-family: var(--app-mono-font);
  font-size: 10px;
  font-weight: 600;
}
.tab-badge-unsynced {
  background-color: color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground, var(--app-warning)) 25%, transparent);
  color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--app-warning));
}

.tickets-master {
  background-color: var(--vscode-sideBar-background, var(--app-bg));
  border-right-color: var(--vscode-sideBar-border, var(--app-border-subtle));
}
`,
};
