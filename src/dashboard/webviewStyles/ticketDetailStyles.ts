export const ticketDetailStyles = {
  base: String.raw`/* Ticket detail / composer */
.ticket-detail-card { flex: 0 0 auto; min-width: 0; width: 100%; max-width: 100%; padding: 14px; border: 1px solid var(--app-border-strong); border-radius: var(--app-radius-card); background: var(--app-surface-raised); }
.detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.detail-title { flex: 1 1 auto; flex-wrap: wrap; display: flex; min-width: 0; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; }
.detail-title > span:last-child { overflow-wrap: anywhere; }
.detail-toggle { flex: 0 0 auto; width: 28px; height: 28px; padding: 0; }
.detail-project, .detail-parent, .detail-readonly { margin-top: 6px; color: var(--app-text-readable-muted); font-size: var(--app-font-caption); }
.detail-description { margin: 12px 0; color: var(--app-text-secondary); font-size: var(--app-font-body); white-space: pre-wrap; overflow-wrap: anywhere; }
.detail-description-collapsed { display: -webkit-box; max-height: 4.5em; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
/* Detail sections follow the storyboard while fitting the sidebar. */
.detail-header-actions { display: flex; flex: 0 0 auto; gap: 4px; align-items: center; }
.detail-header-actions .ticket-action-btn { opacity: 1; }
.detail-project { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
.detail-section { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--app-border-subtle); }
.detail-section h3 { margin: 0; padding-left: 9px; border-left: 3px solid var(--app-focus); font-size: var(--app-font-body); font-weight: 600; color: var(--app-text); }
.detail-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.detail-metadata-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; }
.detail-meta strong { min-width: 0; color: var(--app-text); font-weight: 500; overflow-wrap: anywhere; }
.detail-hint { margin: 8px 0 0; color: var(--app-text-secondary); font-size: var(--app-font-caption); overflow-wrap: anywhere; }
.detail-sync-state { display: flex; align-items: center; gap: 7px; margin-top: 10px; font-size: var(--app-font-body); font-weight: 600; }
.detail-sync-state::before { content: ""; width: 8px; height: 8px; border: 1px solid currentColor; border-radius: 50%; background: currentColor; }
.detail-sync-state.sync-dirty, .detail-sync-state.sync-queued { color: var(--app-link); }
.detail-sync-state.sync-failed, .detail-sync-state.sync-conflict { color: var(--app-danger); }
.detail-sync-state.sync-syncing { color: var(--app-link); }
.detail-sync-state.sync-syncing::before { width: 12px; height: 12px; border-width: 2px; border-top-color: transparent; background: transparent; animation: dashboard-spin 1s linear infinite; }
.detail-description-warning { margin: 10px 0; padding: 7px 9px; border-left: 3px solid var(--app-warning); background: color-mix(in srgb, var(--app-warning) 8%, var(--app-surface)); color: var(--app-text); font-size: var(--app-font-caption); overflow-wrap: anywhere; }
.metadata-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
.detail-actions .detail-sync-button { border-color: var(--app-link); }
.detail-sync-button[aria-busy="true"] .action-icon { animation: dashboard-spin 1s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .detail-sync-state.sync-syncing::before, .detail-sync-button[aria-busy="true"] .action-icon { animation: none; }
}
.detail-field, .detail-meta { display: grid; grid-template-columns: minmax(72px, 30%) minmax(0, 1fr); align-items: center; gap: 8px; color: var(--app-text-secondary); font-size: var(--app-font-caption); }
.detail-field > span, .detail-meta > span { font-weight: 600; }
.detail-select, .detail-input, .setting-input, .setting-select { min-width: 0; width: 100%; padding: 5px 7px; border: 1px solid var(--vscode-input-border, var(--app-border)); border-radius: var(--app-radius-sm); background: var(--vscode-input-background, var(--app-surface)); color: var(--vscode-input-foreground, var(--app-text)); }
.detail-select:focus, .detail-input:focus, .setting-input:focus, .setting-select:focus, .project-select-trigger:focus { outline: 2px solid var(--app-focus); outline-offset: 1px; }
.detail-input[type="date"] { color-scheme: inherit; }
.detail-input[type="date"]::-webkit-calendar-picker-indicator { opacity: 1; padding: 2px; border-radius: var(--app-radius-sm); background-color: var(--app-text-readable-muted); cursor: pointer; }
.detail-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; margin-top: 14px; }
.detail-actions .btn { min-width: 0; min-height: 34px; padding-inline: 7px; overflow-wrap: anywhere; }
.work-panel-head { display: flex; flex-direction: column; gap: 4px; }
.work-panel-title { color: var(--app-text); font-size: 15px; font-weight: 700; }
.work-panel-subtitle { color: var(--app-text-readable-muted); font-size: var(--app-font-caption); }
.composer-grid { display: flex; flex-direction: column; gap: 7px; margin-top: 12px; }
.composer-detail-field { grid-template-columns: minmax(78px, 30%) minmax(0, 1fr); }
.composer-required { color: var(--app-danger); }
.composer-description-field { align-items: start; }
.composer-textarea { min-height: 76px; resize: vertical; }
.composer-error { margin-top: 9px; padding: 7px 9px; border: 1px solid var(--app-danger); border-radius: var(--app-radius-sm); color: var(--app-danger); font-size: var(--app-font-caption); }
.composer-loading { padding: 24px 0; color: var(--app-text-readable-muted); text-align: center; }
.composer-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--app-border-subtle); }
.composer-actions .btn { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }

`,
  cardAccent: String.raw`.ticket-detail-card{border-top:2px solid var(--app-accent)}
`,
  controls: String.raw`.detail-chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
.detail-actions { display:flex; flex-wrap:wrap; align-items:center; }
.detail-actions .btn { flex:0 1 auto; }
.detail-more { margin-left:auto; }
.detail-tabs { display:flex; gap:4px; margin-top:18px; border-bottom:1px solid var(--app-border); }
.detail-tabs button { padding:8px 10px; border:0; border-bottom:2px solid transparent; background:transparent; color:var(--app-text-secondary); cursor:pointer; }
.detail-tabs button[aria-selected="true"] { color:var(--app-text); border-bottom-color:var(--app-focus); }
`,
  compactDetails: String.raw`.ticket-detail-card { min-height:100%; padding:10px 12px; border:0; border-top:0; border-radius:0; background:var(--app-surface); }
.detail-head { gap:5px; }
.detail-title { font-size:14px; line-height:1.35; }
.detail-title .ticket-id { padding:0; border:0; }
.detail-project { margin-top:3px; }
.detail-sync-line { margin-top:5px; }
.detail-sync-state { margin:0; font-size: var(--app-font-caption); }
.detail-actions { display:flex; gap:5px; margin-top:8px; flex-wrap:wrap; }
.detail-actions .btn { flex:0 1 auto; min-height:29px; padding:4px 7px; }
.detail-actions .detail-icon-button,.detail-icon-button { min-width:29px; min-height:29px; padding:4px; }
.detail-more { margin-left:0; }
.detail-tabs { margin-top:8px; }
.detail-tabs button { min-height:32px; padding:5px 9px; }
.detail-section { margin-top:8px; padding-top:8px; }
.detail-metadata { padding:0; border:0; }
.detail-metadata summary { display:flex; align-items:center; gap:8px; min-height:29px; cursor:pointer; color:var(--app-text); font-weight:600; }
.detail-metadata summary::marker { color:var(--app-text-secondary); }
.metadata-summary { min-width:0; overflow:hidden; color:var(--app-text-secondary); font-size: var(--app-font-caption); font-weight:400; text-overflow:ellipsis; white-space:nowrap; }
.detail-metadata[open] .metadata-summary { display:none; }
.detail-metadata .detail-section-head { justify-content:flex-end; margin:4px 0; }
.detail-section-head { margin-bottom:5px; }
.detail-description { margin:6px 0; }
`,
  drawer: String.raw`/* Comments-only Detail Drawer (48% bottom split, fixed 2-row header + comments header, scrollable comments) */
.tickets-layout:not(.layout-split):not(.layout-single) .tickets-detail {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ticket-detail-card {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-top: 1px solid var(--app-border);
  border-radius: 0;
  background: color-mix(in srgb, var(--vscode-sideBar-background, var(--app-bg)) 92%, var(--app-text));
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.18);
}
body.vscode-high-contrast .ticket-detail-card,
body.vscode-high-contrast-light .ticket-detail-card {
  background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background, var(--app-bg)));
}
.ticket-detail-card:has(.composer-grid) {
  overflow-y: auto;
  padding: 10px 12px;
}
.ticket-detail-card.tracker-bug { --tracker-color: var(--app-tracker-bug); }
.ticket-detail-card.tracker-feature { --tracker-color: var(--app-tracker-feature); }
.ticket-detail-card.tracker-task { --tracker-color: var(--app-tracker-task); }
.ticket-detail-card.tracker-neutral { --tracker-color: var(--app-tracker-neutral); }

.detail-header-fixed {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--app-border-subtle));
  background: transparent;
}
.detail-head-row1 {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1 1 auto;
}
.detail-tracker-bar {
  flex: 0 0 3px;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: var(--tracker-color, var(--app-tracker-neutral));
}
.detail-head-row1 .ticket-id {
  flex: 0 0 auto;
  font-family: var(--app-mono-font);
  font-size: var(--app-font-label);
  color: var(--app-text-secondary);
}
#detail-cancel-btn {
  flex: 0 0 auto;
  min-width: 24px;
  min-height: 24px;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 2px;
}
.detail-header-fixed .detail-sync-state {
  flex: 0 0 auto;
  margin: 0;
  font-size: var(--app-font-label);
  font-weight: 600;
}
.detail-header-fixed .detail-sync-state.hidden {
  display: none;
}
`,
};
