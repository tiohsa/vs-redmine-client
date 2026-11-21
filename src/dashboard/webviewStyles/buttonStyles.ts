export const buttonStyles = String.raw`/* Buttons */
.btn { display: inline-flex; min-height: 26px; align-items: center; justify-content: center; gap: 6px; padding: 3px 10px; border: 1px solid transparent; border-radius: 2px; cursor: pointer; font-size: var(--app-font-caption); font-weight: 500; line-height: 1.3; }
.btn-primary { border-color: var(--vscode-button-background, var(--app-accent)); background: var(--vscode-button-background, var(--app-accent)); color: var(--vscode-button-foreground, var(--app-accent-fg)); }
.btn-primary:hover { background: var(--vscode-button-hoverBackground, var(--app-accent-hover)); }
.btn-secondary { border-color: transparent; background: var(--vscode-button-secondaryBackground, var(--app-surface-raised)); color: var(--vscode-button-secondaryForeground, var(--app-text)); }
.btn-secondary:hover { border-color: transparent; background: var(--vscode-button-secondaryHoverBackground, var(--app-surface-hover)); color: var(--vscode-button-secondaryForeground, var(--app-text)); }
.btn-icon-label { min-width: 26px; }
.btn-icon-label .btn-label { display: inline; }
.btn-primary-new { white-space: nowrap; }
.action-icon { flex: 0 0 14px; width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.search-icon { position: absolute; left: 12px; color: var(--app-text-secondary); pointer-events: none; }

`;
