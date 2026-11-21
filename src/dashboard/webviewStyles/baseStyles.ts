export const baseStyles = {
  theme: String.raw`
:root {
  --app-accent: var(--vscode-button-background, var(--vscode-focusBorder));
  --app-accent-fg: var(--vscode-button-foreground, var(--vscode-editor-background));
  --app-accent-hover: var(--vscode-button-hoverBackground, var(--app-accent));
  --app-link: var(--vscode-textLink-foreground, var(--vscode-foreground));
  --app-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --app-surface: var(--vscode-editor-background, var(--app-bg));
  --app-surface-raised: color-mix(in srgb, var(--vscode-editorWidget-background, var(--app-bg)) 94%, var(--app-text));
  --app-surface-hover: var(--vscode-list-hoverBackground, var(--app-surface-raised));
  --app-selected: var(--vscode-list-activeSelectionBackground, var(--app-surface-hover));
  --app-selected-fg: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
  --app-text: var(--vscode-foreground, var(--vscode-editor-foreground));
  --app-text-secondary: var(--vscode-descriptionForeground, var(--app-text));
  --app-text-readable-muted: var(--vscode-descriptionForeground, var(--app-text));
  --app-text-disabled: var(--vscode-disabledForeground, var(--app-text-secondary));
  --app-border: var(--vscode-contrastBorder, color-mix(in srgb, var(--app-text) 22%, var(--vscode-panel-border, var(--app-surface))));
  --app-border-strong: var(--vscode-contrastBorder, color-mix(in srgb, var(--app-text) 30%, var(--app-surface)));
  --app-border-subtle: var(--vscode-contrastBorder, color-mix(in srgb, var(--app-text) 12%, var(--app-surface)));
  --app-focus: var(--vscode-focusBorder, var(--app-accent));
  --app-badge-bg: var(--vscode-badge-background, var(--app-accent));
  --app-badge-fg: var(--vscode-badge-foreground, var(--app-accent-fg));
  --app-danger: var(--vscode-errorForeground, var(--vscode-notificationsErrorIcon-foreground, var(--app-text)));
  --app-warning: var(--vscode-editorWarning-foreground, var(--vscode-notificationsWarningIcon-foreground, var(--app-text)));
  --app-success: var(--vscode-testing-iconPassed, var(--vscode-charts-green, var(--app-text)));
  --app-tracker-bug: var(--vscode-charts-red, var(--app-danger));
  --app-tracker-feature: var(--vscode-charts-green, var(--app-success));
  --app-tracker-task: var(--vscode-charts-blue, var(--app-link));
  --app-tracker-neutral: var(--app-border-strong);
  --app-mono-font: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  --app-radius-sm: 4px;
  --app-radius-md: 8px;
  --app-radius-card: 8px;
  --app-radius-pill: 9999px;
  --app-shadow: 0 4px 14px color-mix(in srgb, var(--app-text) 14%, transparent);
  --app-font-body: var(--vscode-font-size, 13px);
  --app-font-caption: max(12px, calc(var(--app-font-body) - 1px));
  --app-font-label: max(11px, calc(var(--app-font-body) - 2px));
  --app-font: var(--vscode-font-family, system-ui), system-ui, "Noto Sans JP", sans-serif;
}

* { box-sizing: border-box; scrollbar-width: thin; scrollbar-color: var(--vscode-scrollbarSlider-background, color-mix(in srgb, var(--app-text) 30%, transparent)) transparent; }
html, body { width: 100%; height: 100%; }
body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }
body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; }
body {
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--app-bg);
  color: var(--app-text);
  font-family: var(--app-font);
  font-size: var(--vscode-font-size, 13px);
  line-height: 1.5;
}
button, input, select, textarea { font: inherit; }
button { color: inherit; }
button:disabled, input:disabled, select:disabled, textarea:disabled { cursor: not-allowed; opacity: .58; }
.hidden { display: none !important; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

`,
  identifierRadius: String.raw`:root { --mm-radius-pill: var(--app-radius-pill); }
`,
  sidebarTheme: String.raw`/* VS Code sidebar theme */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.35)); }
::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.65)); }

body {
  background-color: var(--vscode-sideBar-background, var(--app-bg));
  color: var(--vscode-sideBar-foreground, var(--app-text));
}

`,
};
