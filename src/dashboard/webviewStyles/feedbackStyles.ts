export const feedbackStyles = {
  toast: String.raw`/* Toast */
#toast-area { position: fixed; z-index: 999; right: 12px; bottom: calc(var(--sync-tray-height, 30px) + 8px); left: 12px; display: flex; flex-direction: column; align-items: stretch; gap: 6px; pointer-events: none; }
.toast { max-width: 560px; align-self: flex-end; padding: 8px 11px; border: 1px solid var(--app-border); border-left: 3px solid var(--app-accent); border-radius: var(--app-radius-md); background: var(--app-surface-raised); color: var(--app-text); box-shadow: var(--app-shadow); font-size: var(--app-font-caption); pointer-events: auto; transition: opacity .2s ease; }
.toast-success { border-left-color: var(--app-success); }
.toast-warning { border-left-color: var(--app-warning); }
.toast-error { border-left-color: var(--app-danger); }
.toast-fade { opacity: 0; }

`,
  syncTray: String.raw`.sync-tray { display:flex; align-items:center; flex:0 0 auto; gap:8px; min-height:46px; padding:7px 14px; border-top:1px solid var(--app-border-strong); background:var(--app-surface-raised); }
.sync-tray-message { flex:1; min-width:0; font-size: var(--app-font-caption); font-weight:600; overflow-wrap:anywhere; }
.sync-tray .btn { min-height:28px; }
`,
  compactSyncTray: String.raw`.sync-tray { min-height:30px; padding:2px 8px; flex-wrap:wrap; }
.sync-tray .btn { min-height:26px; padding:3px 7px; }
`,
  sidebarSyncTray: String.raw`.sync-tray {
  border-top: 1px solid var(--vscode-sideBar-border, var(--app-border-subtle));
  background-color: var(--vscode-sideBar-background, var(--app-bg));
}
`,
  refreshAnimation: String.raw`@media (prefers-reduced-motion: no-preference) {
  @keyframes dashboard-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  #refresh-btn.is-spinning .action-icon {
    animation: dashboard-spin 0.8s linear infinite;
  }
}

`,
};
