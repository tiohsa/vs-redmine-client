import * as vscode from "vscode";
import { browserTargetForUri } from "../../app/browserCommandTarget";
import { onActiveSyncChanged } from "../../app/ticketSync/syncDeletionGuard";
import { getCurrentConnectionScope } from "../../config/connectionScope";
import { scheduleTask } from "../../packages/framework-core";

export class DashboardPendingChangesObserver implements vscode.Disposable {
  private cancelPendingRefresh: (() => void) | undefined;
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly refresh: () => void) {
    const refreshDocumentChanges = (document: vscode.TextDocument): void => {
      const scope = getCurrentConnectionScope();
      if (browserTargetForUri(document.uri, scope)?.connectionScope === scope) { this.scheduleRefresh(); }
    };
    this.disposables = [
      vscode.workspace.onDidOpenTextDocument(refreshDocumentChanges),
      vscode.workspace.onDidChangeTextDocument(event => refreshDocumentChanges(event.document)),
      vscode.workspace.onDidSaveTextDocument(refreshDocumentChanges),
      vscode.workspace.onDidCloseTextDocument(refreshDocumentChanges),
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRefresh()),
      onActiveSyncChanged((scope) => {
        if (scope === getCurrentConnectionScope()) { this.scheduleRefresh(); }
      }),
    ];
  }

  dispose(): void {
    this.cancelPendingRefresh?.();
    this.disposables.forEach(disposable => disposable.dispose());
  }

  private scheduleRefresh(): void {
    this.cancelPendingRefresh?.();
    this.cancelPendingRefresh = scheduleTask(() => {
      this.cancelPendingRefresh = undefined;
      this.refresh();
    }, 100);
  }
}
