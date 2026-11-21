export const commentStyles = {
  base: String.raw`/* Comments */
#comments-panel { flex: 1 1 auto; min-width: 0; min-height: 0; overflow-y: auto; padding: 16px 14px 20px; }
.comments-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.comments-header-label { color: var(--app-text); font-size: 15px; font-weight: 700; }
.comments-header-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.comment-list { display: flex; flex-direction: column; gap: 8px; }
.comment-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; padding: 12px; border: 1px solid var(--app-border); border-radius: var(--app-radius-card); background: var(--app-surface-raised); box-shadow: var(--app-shadow); }
.comment-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.comment-meta { display: flex; min-width: 0; align-items: center; flex-wrap: wrap; gap: 7px; }
.comment-author { color: var(--app-text); font-size: var(--app-font-body); font-weight: 700; }
.comment-date, .comment-id { color: var(--app-text-readable-muted); font-size: var(--app-font-label); }
.comment-status { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
.comment-body{font-size: var(--app-font-body);color:var(--app-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.comment-body { grid-column: 1 / -1; }
.comment-actions { grid-column: 2; grid-row: 1; display: flex; flex-wrap: wrap; justify-content: flex-end; align-self: start; gap: 5px; margin-top: 0; }
.comment-actions .btn { min-height: 27px; padding-inline: 9px; }

`,
  metadata: String.raw`.comment-meta{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.comment-status{display:flex;align-items:center;gap:4px;flex-shrink:0}
`,
  detailComments: String.raw`#detail-comments { padding-top:12px; }
#detail-comments .comment-card { background:var(--app-surface); }
`,
  compactComments: String.raw`.comment-card { display:flex; flex-direction:column; gap:5px; padding:8px 9px; border-radius:var(--app-radius-sm); box-shadow:none; }
.comment-header { align-items:center; }
.comment-body { display:block; overflow:visible; font-size: var(--app-font-body); line-height:1.45; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--app-text); }
.comment-body-clamped { display:-webkit-box; overflow:hidden; -webkit-box-orient:vertical; -webkit-line-clamp:3; }
.comment-actions { display:flex; grid-column:auto; grid-row:auto; justify-content:flex-start; gap:5px; margin-top:0; }
.comment-actions .btn { min-height:28px; padding:3px 6px; }
.comment-expand { min-height:28px; padding:3px 6px; border:0; background:transparent; color:var(--app-link); cursor:pointer; }
.comments-header { align-items:center; margin-bottom:6px; }
.comments-header-label { font-size: var(--app-font-body); }
.comments-header-actions { gap:5px; }
`,
  timeline: String.raw`/* Comments section header & timeline */
.comments-header {
  flex: 0 0 auto;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--app-border-subtle));
}
.comments-header-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--app-text);
  font-size: var(--app-font-body);
  font-weight: 600;
}
.comments-header-label .action-icon {
  flex: 0 0 auto;
  opacity: 0.8;
}
.comments-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
#detail-comments {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0;
}
#detail-comments .state-msg {
  min-width: 0;
  padding: 12px 10px;
  overflow-wrap: anywhere;
}
#add-comment-btn {
  min-height: 24px;
  padding: 2px 8px;
  font-size: var(--app-font-label);
}
#reload-comments-btn {
  min-width: 24px;
  min-height: 24px;
  width: 26px;
  height: 26px;
  padding: 0;
}
#detail-comments .comment-list,
.comment-timeline {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  padding-left: 0;
  border-left: 0;
}
#detail-comments .comment-card,
.comment-timeline .comment-card,
.comment-card {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  gap: 4px;
  min-width: 0;
  height: 80px;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid var(--app-border-subtle);
  border-radius: 0;
  background: var(--app-surface);
  overflow: hidden;
}
#detail-comments .comment-card,
.comment-timeline .comment-card {
  background: transparent;
}
.comment-card.is-editable {
  cursor: pointer;
}
#detail-comments .comment-card.is-editable:hover,
#detail-comments .comment-card.is-editable:focus-visible,
.comment-card.is-editable:hover,
.comment-card.is-editable:focus-visible {
  border-color: var(--vscode-focusBorder, var(--app-focus));
  background: var(--app-surface-hover);
}
.comment-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}
.comment-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: nowrap;
  overflow: hidden;
}
.comment-author {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--app-text);
  font-size: var(--app-font-caption);
  font-weight: 700;
}
.comment-date,
.comment-id {
  flex: 0 0 auto;
  white-space: nowrap;
  color: var(--app-text-readable-muted);
  font-size: var(--app-font-label);
}
.comment-edit-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  min-height: 24px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-text-secondary);
  opacity: 0;
  cursor: pointer;
}
.comment-card.is-editable:hover .comment-edit-icon,
.comment-card.is-editable:focus-within .comment-edit-icon,
.comment-edit-icon:focus-visible {
  opacity: 1;
  color: var(--app-text);
}
.comment-sync-btn {
  min-height: 24px;
  padding: 2px 6px;
  font-size: var(--app-font-label);
}
.comment-body {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  font-size: var(--app-font-body);
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--app-text);
}

`,
};
