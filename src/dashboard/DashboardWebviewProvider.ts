import * as vscode from "vscode";
import { generateDashboardHtml } from "./dashboardHtml";
import { validateDashboardMessage } from "./dashboardMessageValidation";
import { DashboardController, DashboardControllerOptions } from "./DashboardController";
import { DashboardPushMessage } from "./dashboardTypes";

type DashboardProviderOptions = Omit<DashboardControllerOptions, "pushMessage">;

export class DashboardWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "redmine-clientActivityDashboard";

  private view?: vscode.WebviewView;
  private controller?: DashboardController;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly providerOptions: DashboardProviderOptions;

  constructor(opts: DashboardProviderOptions = {}) {
    this.providerOptions = opts;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    const nonce = this.generateNonce();
    webviewView.webview.html = generateDashboardHtml(nonce);

    this.controller?.dispose();
    this.controller = new DashboardController({
      ...this.providerOptions,
      pushMessage: (msg: DashboardPushMessage) => this.pushMessage(msg),
    });

    const msgDisposable = webviewView.webview.onDidReceiveMessage((raw: unknown) => {
      const msg = validateDashboardMessage(raw);
      if (!msg) {return;}
      void this.controller?.handleMessage(msg);
    });

    const visibilityDisposable = webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this.controller) {
        void this.controller.initialize();
      }
    });

    this.disposables.push(msgDisposable, visibilityDisposable);
  }

  private pushMessage(msg: DashboardPushMessage): void {
    if (this.view?.visible) {
      void this.view.webview.postMessage(msg);
    }
  }

  private generateNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  dispose(): void {
    this.controller?.dispose();
    for (const d of this.disposables) {d.dispose();}
  }
}
