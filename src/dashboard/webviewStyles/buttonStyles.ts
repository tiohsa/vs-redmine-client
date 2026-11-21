export const buttonStyles = String.raw`/* Buttons */
.btn { display: inline-flex; min-height: 30px; align-items: center; justify-content: center; gap: 6px; padding: 5px 11px; border: 1px solid transparent; border-radius: var(--app-radius-md); cursor: pointer; font-size: var(--app-font-caption); font-weight: 700; line-height: 1.3; }
.btn-primary { border-color: var(--app-accent); background: var(--app-accent); color: var(--app-accent-fg); }
.btn-primary:hover { background: var(--app-accent-hover); }
.btn-secondary { border-color: var(--app-border); background: var(--app-surface); color: var(--app-text); }
.btn-secondary:hover { border-color: var(--app-accent); background: var(--app-surface-hover); color: var(--app-accent); }
.btn-icon-label { min-width: 30px; }
.btn-icon-label .btn-label { display: inline; }
.btn-primary-new { white-space: nowrap; }
.action-icon { flex: 0 0 16px; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.search-icon { position: absolute; left: 12px; color: var(--app-text-secondary); pointer-events: none; }

`;
