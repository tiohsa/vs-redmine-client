export const ticketListStyles = {
  base: String.raw`/* Ticket list */
#ticket-scroll { flex: 1; overflow-y: auto; min-height: 0; background: var(--app-surface); }
#ticket-list { min-width: 0; }
.ticket-row { position: relative; display: flex; align-items: center; gap: 7px; min-width: 0; min-height: 46px; padding: 8px 12px; border-bottom: 1px solid var(--app-border-subtle); cursor: pointer; }
.ticket-row:hover { background: var(--app-surface-hover); }
.ticket-row:focus-visible { outline-offset: -2px; }
.ticket-row.selected { background: var(--app-selected); color: var(--app-selected-fg); }
.ticket-row.selected::before { position: absolute; top: 3px; bottom: 3px; left: 0; width: 4px; border-radius: var(--app-radius-pill); background: var(--app-focus); content: ""; }
.ticket-row.selected .ticket-id, .ticket-row.selected .ticket-action-btn, .ticket-row.selected .expand-btn { color: inherit; }
.ticket-id { flex: 0 0 auto; padding: 2px 6px; border: 1px solid var(--app-border-subtle); border-radius: var(--app-radius-pill); color: var(--app-text-secondary); font-size: var(--app-font-label); font-variant-numeric: tabular-nums; font-weight: 700; }
.ticket-subject { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--app-font-body); }
.ticket-row.selected .ticket-subject { font-weight: 700; }
.badges { display: flex; flex: 0 1 auto; flex-wrap: wrap; justify-content: flex-end; gap: 4px; min-width: 0; }
.badge { display: inline-flex; align-items: center; gap: 3px; min-width: 0; padding: 2px 6px; border: 1px solid var(--app-border-subtle); border-radius: var(--app-radius-pill); background: var(--app-surface-raised); color: var(--app-text-secondary); font-size: var(--app-font-label); font-weight: 600; line-height: 1.25; white-space: nowrap; }
.badge-icon { font-size: var(--app-font-caption); line-height: 1; }
.badge.sync-dirty, .badge.sync-queued { border-color: color-mix(in srgb, var(--app-link) 55%, var(--app-border)); color: var(--app-link); }
.badge.sync-conflict, .badge.sync-failed { border-color: color-mix(in srgb, var(--app-danger) 55%, var(--app-border)); color: var(--app-danger); }
.badge.sync-syncing { border-color: color-mix(in srgb, var(--app-link) 55%, var(--app-border)); color: var(--app-link); }
.badge.sync-review { border-color: var(--app-warning); color: var(--app-warning); }
.detail-sync-state.sync-review { color: var(--app-warning); }
.badge.due-overdue { border-color: color-mix(in srgb, var(--app-danger) 55%, var(--app-border)); color: var(--app-danger); }
.badge.due-1day, .badge.due-3days { border-color: color-mix(in srgb, var(--app-warning) 55%, var(--app-border)); color: var(--app-warning); }
.badge.due-7days { border-color: color-mix(in srgb, var(--app-link) 55%, var(--app-border)); color: var(--app-link); }
.ticket-status { overflow: hidden; text-overflow: ellipsis; }
.ticket-metadata { max-width: 120px; overflow: hidden; text-overflow: ellipsis; display: inline-block; border-color: var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-surface-raised); color: var(--app-text); font-size: var(--app-font-caption); font-weight: 500; line-height: 1.4; }
.ticket-priority { border-color: color-mix(in srgb, var(--app-link) 45%, var(--app-border)); background: color-mix(in srgb, var(--app-link) 10%, var(--app-surface)); }
.avatar { display: inline-flex; flex: 0 0 auto; width: 24px; height: 24px; align-items: center; justify-content: center; border: 1px solid var(--app-border); border-radius: 50%; background: var(--app-surface-raised); color: var(--app-accent); font-size: var(--app-font-label); font-weight: 700; line-height: 1; }
.ticket-avatar { margin-left: 2px; }
.ticket-actions { position: relative; display: inline-flex; flex: 0 0 auto; }
.ticket-action-btn{opacity:.45;pointer-events:auto;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--app-radius-pill);background:transparent;color:var(--app-text-secondary);cursor:pointer;}
.ticket-row:hover .ticket-action-btn, .ticket-row:focus-within .ticket-action-btn, .ticket-row.selected .ticket-action-btn, .ticket-action-btn[aria-expanded="true"] { opacity: 1; }
.ticket-action-btn:hover, .ticket-action-btn[aria-expanded="true"] { background: var(--app-surface-hover); color: var(--app-accent); }
.ticket-action-menu { position: fixed; z-index: 20; display: flex; min-width: 156px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow-y: auto; flex-direction: column; gap: 2px; padding: 5px; border: 1px solid var(--app-border); border-radius: var(--app-radius-md); background: var(--app-surface-raised); box-shadow: var(--app-shadow); }
.ticket-action-menu button { display: flex; align-items: center; gap: 6px; padding: 6px 9px; border: 0; border-radius: var(--app-radius-sm); background: transparent; color: var(--app-text); cursor: pointer; text-align: left; font-size: var(--app-font-caption); }
.ticket-action-menu button:hover, .ticket-action-menu button:focus-visible { background: var(--app-surface-hover); color: var(--app-accent); outline: 0; }
.expand-btn { display: inline-flex; flex: 0 0 20px; width: 20px; height: 24px; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: var(--app-radius-sm); background: transparent; color: var(--app-text-secondary); cursor: pointer; }
.expand-btn:hover { background: var(--app-surface-hover); color: var(--app-accent); }
.expand-icon { display: inline-block; width: 0; height: 0; border-style: solid; }
.expand-icon.collapsed { border-width: 4px 0 4px 6px; border-color: transparent transparent transparent currentColor; }
.expand-icon.expanded { border-width: 6px 4px 0; border-color: currentColor transparent transparent; }
.expand-placeholder { display: inline-block; flex: 0 0 20px; width: 20px; }
.child-connector { flex: 0 0 auto; color: var(--app-text-secondary); font-size: var(--app-font-body); }
.load-more-row { display: block; width: 100%; padding: 9px 12px; border: 0; background: transparent; color: var(--app-accent); cursor: pointer; font-size: var(--app-font-caption); text-align: center; }
.load-more-row:hover { background: var(--app-surface-hover); text-decoration: underline; }
.load-more-row[aria-disabled="true"] { cursor: progress; text-decoration: none; color: var(--app-text-readable-muted); }
.state-msg { padding: 28px 16px; color: var(--app-text-readable-muted); font-size: var(--app-font-body); text-align: center; }
.state-msg strong { display: block; margin-bottom: 4px; color: var(--app-text); }
.state-msg { overflow-wrap: anywhere; }
.state-msg p { margin: 8px 0 16px; }
.loading-state::before { display: block; width: 20px; height: 20px; margin: 0 auto 10px; border: 2px solid var(--app-border); border-top-color: var(--app-focus); border-radius: 50%; content: ""; animation: dashboard-spin 1s linear infinite; }
@keyframes dashboard-spin { to { transform: rotate(360deg); } }
#ticket-detail-empty { margin: auto; max-width: 360px; }
.error-msg { color: var(--app-danger); }

`,
  ticketIdentifier: String.raw`/* Existing renderer contract: retain these compact component selectors for extensions/tests. */
.ticket-id{border-radius:var(--mm-radius-pill);font-variant-numeric:tabular-nums}
`,
  scrollContainer: String.raw`#ticket-scroll{flex:1;overflow-y:auto;min-height:0;border-bottom:1px solid var(--app-border-subtle)}
`,
  compactRows: String.raw`.ticket-row { gap:5px; min-height:50px; padding:5px 8px 6px; border-left:3px solid var(--tracker-color, transparent); border-bottom:1px solid color-mix(in srgb, var(--app-text) 5%, transparent); }
.ticket-row.tracker-bug { --tracker-color: var(--app-tracker-bug); }
.ticket-row.tracker-feature { --tracker-color: var(--app-tracker-feature); }
.ticket-row.tracker-task { --tracker-color: var(--app-tracker-task); }
.ticket-row.tracker-neutral { --tracker-color: var(--app-tracker-neutral); }
.ticket-row.is-unsynced { background:color-mix(in srgb, var(--app-link) 7%, transparent); }
.ticket-row.is-unsynced:hover { background:color-mix(in srgb, var(--app-link) 12%, var(--app-surface-hover)); }
.ticket-row.selected, .ticket-row.is-unsynced.selected { background:var(--app-selected); color:var(--app-selected-fg); }
.ticket-indent-guide { position:absolute; top:0; bottom:0; width:1px; background:var(--vscode-tree-indentGuidesStroke, color-mix(in srgb, var(--app-text) 16%, transparent)); pointer-events:none; }
.ticket-row-content { display:flex; flex:1 1 auto; min-width:0; flex-direction:column; gap:3px; }
.ticket-row-main { display:flex; min-width:0; align-items:baseline; gap:6px; }
.ticket-row-main .ticket-id { padding:0; border:0; background:transparent; color:var(--app-text-secondary); font-family:var(--app-mono-font); font-size: var(--app-font-label); font-weight:500; }
.ticket-row-main .ticket-subject { display:-webkit-box; overflow:hidden; min-width:0; color:var(--app-text); font-weight:500; white-space:normal; overflow-wrap:anywhere; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-height:1.35; }
.ticket-row.selected .ticket-row-main .ticket-subject { color:var(--app-selected-fg); font-weight:700; }
.ticket-row-meta { display:flex; min-width:0; align-items:center; flex-wrap:wrap; gap:4px 8px; color:var(--app-text-secondary); font-size: var(--app-font-caption); line-height:1.25; }
.ticket-attribute { flex:0 1 auto; min-width:0; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ticket-meta-item { flex:0 1 auto; min-width:0; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--app-text-secondary); font-size: var(--app-font-label); }
.ticket-meta-due { font-variant-numeric:tabular-nums; }
.ticket-meta-due.is-overdue { color:var(--app-danger); font-weight:600; }
.ticket-row-meta .badge { flex:0 0 auto; padding:1px 5px; font-size: var(--app-font-label); }
.ticket-row.selected .ticket-attribute, .ticket-row.selected .ticket-meta-item { color:inherit; }
.ticket-row.selected .ticket-meta-due.is-overdue { color:var(--app-danger); background:color-mix(in srgb, var(--app-surface) 85%, transparent); padding:0 4px; border-radius:var(--app-radius-sm); }
.ticket-action-btn { opacity:1; border:1px solid var(--app-border-subtle); border-radius:var(--app-radius-sm); background:var(--app-surface); color:var(--app-text); }
.expand-btn,.expand-placeholder { flex-basis:24px; width:24px; }
.expand-btn { height:28px; }
.expand-placeholder { display:none; }
`,
  sidebarScroll: String.raw`#ticket-scroll {
  background-color: var(--vscode-sideBar-background, var(--app-bg));
  border-bottom-color: var(--vscode-sideBar-border, var(--app-border-subtle));
}

`,
  sidebarRows: String.raw`.ticket-row {
  position: relative;
  display: block;
  min-height: 52px;
  padding: 8px 8px 8px 12px;
  border-left: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--vscode-sideBar-border, var(--app-border-subtle)) 60%, transparent);
  background: transparent;
}
.ticket-row:hover { background-color: var(--vscode-list-hoverBackground, var(--app-surface-hover)); }
.ticket-row.is-unsynced:not(.selected) {
  background-color: color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground, var(--app-warning)) 8%, transparent);
}
.ticket-row.is-unsynced:not(.selected):hover {
  background-color: color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground, var(--app-warning)) 12%, var(--vscode-list-hoverBackground, var(--app-surface-hover)));
}
.ticket-row.selected, .ticket-row.is-unsynced.selected {
  background-color: color-mix(in oklab, var(--vscode-list-inactiveSelectionBackground, var(--app-surface-hover)) 86%, var(--app-focus));
  color: var(--vscode-foreground, var(--app-text));
}
body:focus-within .ticket-row.selected, body:focus-within .ticket-row.is-unsynced.selected {
  background-color: color-mix(in oklab, var(--vscode-list-activeSelectionBackground, var(--app-surface-hover)) 78%, var(--app-focus));
  color: var(--vscode-list-activeSelectionForeground, var(--app-selected-fg));
}
.ticket-row.selected::before { content: none; }

.ticket-tracker-bar {
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 0 1px 1px 0;
  background-color: var(--vscode-textLink-foreground, var(--vscode-charts-blue, var(--app-accent)));
  pointer-events: none;
}
.ticket-row.tracker-bug .ticket-tracker-bar { background-color: var(--vscode-editorError-foreground, var(--app-danger)); }
.ticket-row.tracker-feature .ticket-tracker-bar { background-color: var(--vscode-gitDecoration-addedResourceForeground, var(--app-success)); }
.ticket-row.tracker-task .ticket-tracker-bar,
.ticket-row.tracker-neutral .ticket-tracker-bar { background-color: var(--vscode-textLink-foreground, var(--vscode-charts-blue, var(--app-accent))); }

.ticket-indent-guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: var(--vscode-tree-indentGuidesStroke, color-mix(in srgb, var(--app-text) 25%, transparent));
  opacity: 0.45;
  pointer-events: none;
}
.ticket-indent-branch {
  position: absolute;
  top: 16px;
  width: 8px;
  height: 1px;
  background-color: var(--vscode-tree-indentGuidesStroke, color-mix(in srgb, var(--app-text) 25%, transparent));
  opacity: 0.45;
  pointer-events: none;
}

.ticket-row-content { display: flex; flex-direction: column; gap: 0; min-width: 0; }
.ticket-row-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
}
.ticket-row-title-group {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1 1 auto;
}
.ticket-row-main .expand-btn {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  margin-left: -4px;
  border-radius: 2px;
  color: inherit;
}
.ticket-row-main .expand-btn:hover { background-color: color-mix(in srgb, var(--vscode-foreground, var(--app-text)) 15%, transparent); }
.ticket-row-main .ticket-id {
  font-family: var(--app-mono-font);
  font-size: 11px;
  font-weight: 400;
  opacity: 0.7;
  color: inherit;
  flex: 0 0 auto;
}
.priority-indicator {
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  flex: 0 0 auto;
}
.priority-indicator.priority-urgent { color: var(--vscode-editorError-foreground, var(--app-danger)); }
.priority-indicator.priority-high { color: var(--vscode-editorWarning-foreground, var(--app-warning)); }
.ticket-row-main .ticket-subject {
  display: block;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  -webkit-line-clamp: unset;
  font-size: var(--app-font-body);
  font-weight: 500;
  line-height: 1.4;
  color: inherit;
}
.ticket-row.selected .ticket-row-main .ticket-subject { color: inherit; font-weight: 600; }

.ticket-row-meta {
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
  line-height: 1.3;
  color: inherit;
}
.ticket-meta-left { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.ticket-meta-right { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }

.status-pill {
  display: inline-flex;
  align-items: center;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 2px;
  border: 1px solid color-mix(in srgb, var(--vscode-foreground, var(--app-text)) 30%, transparent);
  font-size: 10px;
  font-weight: 500;
  line-height: 1.3;
  color: inherit;
}
.status-pill.status-new {
  border-color: color-mix(in srgb, var(--vscode-textLink-foreground, var(--app-link)) 45%, transparent);
  color: var(--vscode-textLink-foreground, var(--app-link));
}
.status-pill.status-in-progress {
  border-color: color-mix(in srgb, var(--vscode-editorWarning-foreground, var(--app-warning)) 45%, transparent);
  color: var(--vscode-editorWarning-foreground, var(--app-warning));
}
.status-pill.status-resolved {
  border-color: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground, var(--app-success)) 45%, transparent);
  color: var(--vscode-gitDecoration-addedResourceForeground, var(--app-success));
}
body:focus-within .ticket-row.selected .status-pill {
  border-color: color-mix(in srgb, var(--vscode-list-activeSelectionForeground, var(--app-selected-fg)) 55%, transparent);
  color: var(--vscode-list-activeSelectionForeground, var(--app-selected-fg));
}

.unsynced-inline-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 500;
  color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--app-warning));
  white-space: nowrap;
}
.unsynced-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background-color: currentColor;
}
.ticket-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground, var(--app-text-secondary));
}
.ticket-meta-item .action-icon { width: 11px; height: 11px; flex-basis: 11px; }
body:focus-within .ticket-row.selected .ticket-meta-item:not(.is-overdue) {
  color: color-mix(in srgb, var(--vscode-list-activeSelectionForeground, var(--app-selected-fg)) 80%, transparent);
}
.ticket-meta-due.is-overdue {
  color: var(--vscode-editorError-foreground, var(--app-danger));
  font-weight: 600;
}

#ticket-list.is-compact .ticket-row { min-height: 30px; padding-top: 5px; padding-bottom: 5px; }
#ticket-list.is-compact .ticket-row-meta { display: none; }

.empty-clear-link {
  margin-top: 6px;
  padding: 2px 6px;
  border: 0;
  background: transparent;
  color: var(--vscode-textLink-foreground, var(--app-link));
  font-size: 12px;
  cursor: pointer;
}
.empty-clear-link:hover { text-decoration: underline; }

`,
  draftRows: String.raw`.ticket-row.is-draft {
  border-left-color: var(--app-modified);
}

.ticket-id.ticket-id-new {
  color: var(--app-modified);
  font-weight: 700;
  letter-spacing: 0.02em;
}

`,
};
