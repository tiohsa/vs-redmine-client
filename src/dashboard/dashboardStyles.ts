export const getDashboardStyles = (): string => `
  :root {
    --brand-blue: #1456f0;
    --brand-blue-hover: #0e44cc;
    --color-bg: var(--vscode-sideBar-background, #fff);
    --color-surface: var(--vscode-editor-background, #f5f7fa);
    --color-border: var(--vscode-panel-border, #e0e4ec);
    --color-text: var(--vscode-foreground, #181e25);
    --color-text-muted: var(--vscode-descriptionForeground, #6b7280);
    --color-accent: var(--vscode-focusBorder, #1456f0);
    --color-error: var(--vscode-errorForeground, #d32f2f);
    --color-warning: var(--vscode-editorWarning-foreground, #b45309);
    --color-success: var(--vscode-testing-iconPassed, #16a34a);
    --radius-sm: 8px;
    --radius-md: 13px;
    --radius-lg: 18px;
    --radius-pill: 22px;
    --shadow-sm: 0 1px 3px rgba(0,0,0,.06);
    --shadow-md: 0 2px 8px rgba(0,0,0,.08);
    --font-sans: 'DM Sans', 'Noto Sans JP', 'Outfit', system-ui, sans-serif;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--color-text);
    background: var(--color-bg);
    line-height: 1.5;
  }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg);
    flex-wrap: wrap;
  }

  .header select {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 12px;
  }

  .header-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    flex-shrink: 0;
  }

  .header-btn:hover { background: var(--color-surface); }
  .header-btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 1px; }

  .header-btn.primary {
    background: var(--brand-blue);
    color: #fff;
    width: auto;
    padding: 3px 10px;
    border-radius: var(--radius-pill);
    font-size: 11px;
    font-weight: 600;
  }

  .header-btn.primary:hover { background: var(--brand-blue-hover); }

  /* Tabs */
  #tabs {
    display: flex;
    gap: 2px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg);
  }

  .tab {
    padding: 3px 12px;
    border: none;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--color-text-muted);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background .12s, color .12s;
  }

  .tab:hover { background: var(--color-surface); color: var(--color-text); }

  .tab.active {
    background: var(--brand-blue);
    color: #fff;
  }

  .tab:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 1px; }

  .tab .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 99px;
    background: rgba(255,255,255,.3);
    color: inherit;
    font-size: 10px;
    margin-left: 4px;
  }

  .tab:not(.active) .badge {
    background: var(--color-border);
    color: var(--color-text-muted);
  }

  /* Panels */
  .panel { display: none; padding: 8px 0; }
  .panel.active { display: block; }

  /* Ticket list */
  .ticket-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    cursor: pointer;
    border-left: 3px solid transparent;
    min-height: 28px;
  }

  .ticket-row:hover { background: var(--color-surface); }

  .ticket-row.selected {
    border-left-color: var(--brand-blue);
    background: color-mix(in srgb, var(--brand-blue) 8%, transparent);
  }

  .ticket-row:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }

  .expand-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    flex-shrink: 0;
    font-size: 10px;
    padding: 0;
  }

  .expand-btn:hover { background: var(--color-border); }
  .expand-btn:focus-visible { outline: 2px solid var(--color-accent); }
  .expand-spacer { width: 14px; flex-shrink: 0; }

  .ticket-id {
    color: var(--color-text-muted);
    font-size: 10px;
    flex-shrink: 0;
    min-width: 36px;
  }

  .ticket-subject {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .due-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .due-indicator.overdue { background: var(--color-error); }
  .due-indicator.soon { background: var(--color-warning); }

  .load-more {
    display: block;
    width: calc(100% - 20px);
    margin: 6px 10px;
    padding: 5px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 11px;
    cursor: pointer;
    text-align: center;
  }

  .load-more:hover { background: var(--color-border); }
  .load-more:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 1px; }

  /* Detail card */
  .detail-card {
    margin: 8px 10px;
    padding: 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    box-shadow: var(--shadow-sm);
  }

  .detail-title {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 6px;
    color: var(--color-text);
  }

  .detail-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }

  .meta-chip {
    padding: 1px 7px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border);
    font-size: 10px;
    color: var(--color-text-muted);
  }

  .detail-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 8px;
  }

  .action-btn {
    padding: 3px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-pill);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 11px;
    cursor: pointer;
  }

  .action-btn:hover { border-color: var(--brand-blue); color: var(--brand-blue); }
  .action-btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 1px; }
  .action-btn.primary { background: var(--brand-blue); border-color: var(--brand-blue); color: #fff; }
  .action-btn.primary:hover { background: var(--brand-blue-hover); }

  /* Comments */
  .comment-card {
    margin: 4px 10px;
    padding: 8px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }

  .comment-header {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 4px;
  }

  .comment-author { font-weight: 600; font-size: 11px; }
  .comment-date { color: var(--color-text-muted); font-size: 10px; }
  .comment-body { font-size: 11px; white-space: pre-wrap; word-break: break-word; }

  .comment-actions { margin-top: 6px; display: flex; gap: 4px; }

  /* Unsynced */
  .unsynced-card {
    margin: 4px 10px;
    padding: 7px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .unsynced-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
  .unsynced-actions { display: flex; gap: 4px; flex-shrink: 0; }

  .sync-all-btn {
    display: block;
    width: calc(100% - 20px);
    margin: 6px 10px;
    padding: 5px;
    background: var(--brand-blue);
    border: none;
    border-radius: var(--radius-sm);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
  }

  .sync-all-btn:hover { background: var(--brand-blue-hover); }
  .sync-all-btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 1px; }

  /* Settings */
  .settings-section { padding: 8px 10px; }
  .settings-section-title {
    font-size: 10px;
    font-weight: 700;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: .04em;
    margin-bottom: 6px;
  }

  .settings-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px solid var(--color-border);
  }

  .settings-row:last-child { border-bottom: none; }
  .settings-label { flex: 1; font-size: 11px; }

  .settings-row select,
  .settings-row input[type="number"],
  .settings-row input[type="text"] {
    padding: 2px 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 11px;
    width: 110px;
  }

  .settings-row input[type="checkbox"] { cursor: pointer; }

  /* Toast */
  #toast-container {
    position: fixed;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    z-index: 9999;
    pointer-events: none;
  }

  .toast {
    padding: 6px 14px;
    border-radius: var(--radius-pill);
    font-size: 11px;
    font-weight: 500;
    box-shadow: var(--shadow-md);
    color: #fff;
    animation: toast-in .2s ease;
    pointer-events: auto;
  }

  @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  .toast.info { background: #181e25; }
  .toast.warning { background: var(--color-warning); }
  .toast.error { background: var(--color-error); }

  /* Misc */
  .empty-state {
    padding: 20px 10px;
    text-align: center;
    color: var(--color-text-muted);
    font-size: 11px;
  }

  .loading-indicator {
    padding: 10px;
    text-align: center;
    color: var(--color-text-muted);
    font-size: 11px;
  }

  /* High contrast support */
  @media (forced-colors: active) {
    .ticket-row.selected { border-left: 3px solid Highlight; }
    .tab.active { forced-color-adjust: none; background: Highlight; color: HighlightText; }
    .toast { forced-color-adjust: none; }
    .detail-card, .comment-card, .unsynced-card { border: 1px solid ButtonText; box-shadow: none; }
  }
`;
