import * as vscode from "vscode";

export const SELECTION_HIGHLIGHT_ICON_ID = "circle-filled";
export const SELECTION_HIGHLIGHT_COLOR_ID = "charts.blue";

export const SELECTION_HIGHLIGHT_ICON = new vscode.ThemeIcon(
  SELECTION_HIGHLIGHT_ICON_ID,
  new vscode.ThemeColor(SELECTION_HIGHLIGHT_COLOR_ID),
);
