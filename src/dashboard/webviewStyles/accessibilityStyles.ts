export const accessibilityStyles = {
  selectedTicketContrast: String.raw`body.vscode-high-contrast .ticket-row.selected,
body.vscode-high-contrast .ticket-row.is-unsynced.selected,
body.vscode-high-contrast-light .ticket-row.selected,
body.vscode-high-contrast-light .ticket-row.is-unsynced.selected,
body.vscode-high-contrast .comment-card.selected,
body.vscode-high-contrast-light .comment-card.selected {
  background-color: var(--vscode-list-inactiveSelectionBackground, var(--app-selected));
  outline: 1px solid var(--vscode-contrastBorder, var(--app-focus));
  outline-offset: -1px;
}
body.vscode-high-contrast:focus-within .ticket-row.selected,
body.vscode-high-contrast:focus-within .ticket-row.is-unsynced.selected,
body.vscode-high-contrast-light:focus-within .ticket-row.selected,
body.vscode-high-contrast-light:focus-within .ticket-row.is-unsynced.selected,
body.vscode-high-contrast:focus-within .comment-card.selected,
body.vscode-high-contrast-light:focus-within .comment-card.selected {
  background-color: var(--vscode-list-activeSelectionBackground, var(--app-selected));
}

`,
  focusAndForcedColors: String.raw`/* Focus & High Contrast / Forced Colors */
.comment-card.is-editable:focus-visible,
.comment-hover-action-btn:focus-visible,
.ticket-hover-action-btn:focus-visible,
#detail-cancel-btn:focus-visible,
#add-comment-btn:focus-visible,
#reload-comments-btn:focus-visible,
.expand-btn:focus-visible,
.quick-filter:focus-visible {
  outline: 2px solid var(--vscode-focusBorder, var(--app-focus));
  outline-offset: 2px;
}
@media (forced-colors: active) {
  .tab.active {
    border-bottom: 3px solid Highlight;
  }
  .ticket-row.selected,
  .comment-card.selected {
    outline: 2px solid Highlight;
    outline-offset: -2px;
  }
}
`,
};
