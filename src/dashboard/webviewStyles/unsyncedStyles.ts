export const unsyncedStyles = {
  base: String.raw`/* Unsynced */
#unsynced-panel { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; flex-direction: column; gap: 10px; overflow-y: auto; padding: 16px 14px 20px; }
.unsynced-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.panel-title { margin: 0; color: var(--app-text); font-size: 12px; line-height: 1.25; }
.panel-subtitle { margin: 3px 0 0; color: var(--app-text-readable-muted); font-size: var(--app-font-caption); }
.unsynced-summary { display: flex; flex-wrap: wrap; gap: 6px; }
.summary-badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border: 1px solid var(--app-border-subtle); border-radius: var(--app-radius-pill); background: var(--app-surface-raised); color: var(--app-text-secondary); font-size: var(--app-font-label); font-weight: 600; }
.summary-badge strong { color: var(--app-text); font-variant-numeric: tabular-nums; }
.operation-feedback { padding: 8px 10px; border: 1px solid var(--app-border); border-radius: 2px; background: var(--app-surface-raised); color: var(--app-text); font-size: var(--app-font-caption); }
.operation-feedback.success { border-color: var(--app-success); }
.operation-feedback.warning { border-color: var(--app-warning); }
.operation-feedback.error { border-color: var(--app-danger); color: var(--app-danger); }
#unsynced-list { display: flex; flex-direction: column; gap: 8px; }
.unsynced-card { display: grid; grid-template-columns: max-content minmax(0, 1fr) max-content; align-items: center; gap: 10px; min-width: 0; padding: 11px 12px; border: 1px solid var(--app-border); border-radius: 2px; background: var(--app-surface-raised); box-shadow: var(--app-shadow); }
.unsynced-kind-label { align-self: start; padding: 3px 7px; border: 1px solid var(--app-border-subtle); border-radius: var(--app-radius-pill); color: var(--app-text-secondary); font-size: var(--app-font-label); font-weight: 700; white-space: nowrap; }
.unsynced-body { min-width: 0; }
.unsynced-label { overflow: hidden; color: var(--app-text); font-size: var(--app-font-body); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.unsynced-detail { margin-top: 3px; overflow-wrap: anywhere; color: var(--app-text-secondary); font-size: var(--app-font-caption); }
.unsynced-state { display: flex; flex-wrap: wrap; gap: 4px; }
.unsynced-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
.unsynced-actions .btn { min-height: 26px; padding-inline: 9px; }
.unsynced-more { position: relative; align-self: center; }
.unsynced-more summary { list-style: none; }
.unsynced-more summary::-webkit-details-marker { display: none; }
.unsynced-more[open] { flex: 1 1 100%; min-width: 0; grid-column: 1 / -1; }
.unsynced-card:has(.unsynced-more[open]) .unsynced-actions { grid-column: 1 / -1; min-width: 0; align-items: start; }
.unsynced-more-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; padding: 8px; border: 1px solid var(--app-border-subtle); border-radius: 2px; }
.unsynced-action-reason { grid-column: 1 / -1; flex: 1 1 100%; margin: 0; color: var(--app-text-secondary); font-size: var(--app-font-caption); overflow-wrap: anywhere; }
.btn-danger { color: var(--app-danger); }
.unsynced-card:focus { outline: 2px solid var(--app-focus); outline-offset: -2px; }
.project-group-label { padding: 6px 8px; font-size: var(--app-font-caption); color: var(--app-text-secondary); font-weight: 600; }
#abandoned-list { display: flex; flex-direction: column; gap: 8px; }
#abandoned-list .unsynced-card { grid-template-columns: max-content minmax(0, 1fr); }
#abandoned-list pre { max-height: 240px; overflow: auto; white-space: pre-wrap; }

`,
  compactCards: String.raw`.unsynced-header { align-items:center; }
.unsynced-card { gap:5px 9px; padding:8px 9px; border-radius:2px; box-shadow:none; }
#unsynced-list { gap:5px; }
.unsynced-group-title { margin:8px 0 2px; font-size: var(--app-font-caption); color:var(--app-text-secondary); }
.unsynced-kind-label { border:0; padding:0; }
.unsynced-actions .btn { min-height:26px; }
`,
};
