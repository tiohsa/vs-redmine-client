import * as vscode from "vscode";

export const SELECTION_HIGHLIGHT_COLOR_ID = "charts.blue";

export const createSelectionIcon = (
  iconId: string,
  isSelected: boolean,
): vscode.ThemeIcon =>
  new vscode.ThemeIcon(
    iconId,
    isSelected ? new vscode.ThemeColor(SELECTION_HIGHLIGHT_COLOR_ID) : undefined,
  );
