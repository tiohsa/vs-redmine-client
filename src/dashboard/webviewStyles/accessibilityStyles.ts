export const accessibilityStyles = {
  selectedTicketContrast: String.raw`body.vscode-high-contrast .ticket-row.selected,
body.vscode-high-contrast-light .ticket-row.selected {
  outline: 1px solid var(--vscode-contrastBorder, var(--app-focus));
  outline-offset: -1px;
}

`,
  focusAndForcedColors: String.raw`/* Focus & High Contrast / Forced Colors */
.comment-card.is-editable:focus-visible,
.comment-edit-icon:focus-visible,
#detail-cancel-btn:focus-visible,
#detail-sync-btn:focus-visible,
#detail-browser-btn:focus-visible,
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
}
`,
};
