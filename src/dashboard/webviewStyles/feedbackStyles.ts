export const feedbackStyles = {
  toast: String.raw`/* Toast */
#toast-area { position: fixed; z-index: 999; right: 12px; bottom: 12px; left: 12px; display: flex; flex-direction: column; align-items: stretch; gap: 6px; pointer-events: none; }
.toast { max-width: 560px; align-self: flex-end; padding: 8px 11px; border: 1px solid var(--app-border); border-left: 3px solid var(--app-accent); border-radius: 2px; background: var(--app-surface-raised); color: var(--app-text); box-shadow: var(--app-shadow); font-size: var(--app-font-caption); pointer-events: auto; transition: opacity .2s ease; }
.toast-success { border-left-color: var(--app-success); }
.toast-warning { border-left-color: var(--app-warning); }
.toast-error { border-left-color: var(--app-danger); }
.toast-fade { opacity: 0; }

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
