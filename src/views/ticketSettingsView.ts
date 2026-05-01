import * as vscode from "vscode";
import { TicketsTreeProvider } from "./ticketsView";

export class TicketSettingsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();

  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly ticketsProvider: TicketsTreeProvider) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    return this.ticketsProvider.getSettingsItems();
  }
}
