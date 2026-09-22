/** Dashboard の同じ操作には、静的 HTML と動的描画で共通のアイコンを使う。 */
export const dashboardActionPaths = {
  browser: "M14 3h7v7M21 3 10 14M10 3H3v18h18v-7",
  cancel: "M6 6l12 12M18 6 6 18",
  open: "M3 7V5h6l2 3h10v12H3V7Z",
  comment: "M4 4h16v13H9l-5 4V4Z",
  sync: "M20 8a8 8 0 0 0-14-2L3 9m0-6v6h6M4 16a8 8 0 0 0 14 2l3-3m0 6v-6h-6",
  refresh: "M20 8a8 8 0 1 0 0 8M20 3v5h-5",
  child: "M12 5v14M5 12h14",
} as const;

export const dashboardActionIcon = (name: keyof typeof dashboardActionPaths): string =>
  `<svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${dashboardActionPaths[name]}"/></svg>`;
