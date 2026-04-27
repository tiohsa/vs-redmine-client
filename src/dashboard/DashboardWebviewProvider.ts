import * as crypto from "crypto";
import * as vscode from "vscode";
import { buildDashboardHtml } from "./dashboardHtml";
import { DashboardController } from "./DashboardController";
import { DashboardMessageRouter } from "./DashboardMessageRouter";
import { DashboardStateStore } from "./DashboardStateStore";
import type { DashboardEvent } from "./dashboardProtocol";
import { VIEW_ID_DASHBOARD } from "./dashboardProtocol";

export { VIEW_ID_DASHBOARD };

const generateNonce = (): string => crypto.randomBytes(16).toString("base64");

export class DashboardWebviewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view?: vscode.WebviewView;
  private readonly store: DashboardStateStore;
  private readonly controller: DashboardController;
  private readonly router: DashboardMessageRouter;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {
    this.store = new DashboardStateStore();

    this.controller = new DashboardController({
      store: this.store,
      notifySuccess: (requestId, msg) => {
        this.send({ type: "operation.success", requestId, message: msg });
      },
      notifyError: (requestId, msg) => {
        this.send({ type: "operation.error", requestId, message: msg });
      },
      notifyToast: (level, msg) => {
        this.send({ type: "toast", level, message: msg });
      },
      onTicketsRefreshed: () => {
        void this.controller.initialize();
      },
    });

    this.router = new DashboardMessageRouter(this.controller);

    // ストア変更を webview に流す
    this.disposables.push({
      dispose: this.store.subscribe((state) => {
        this.send({ type: "dashboard.state", state });
      }),
    });

    this.disposables.push(this.controller);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    const nonce = generateNonce();
    webviewView.webview.html = buildDashboardHtml(nonce);

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(async (raw: unknown) => {
        if (token.isCancellationRequested) {
          return;
        }
        await this.router.route(raw);
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this.send({ type: "dashboard.state", state: this.store.getState() });
        }
      }),
    );
  }

  private send(event: DashboardEvent): void {
    if (!this.view?.visible) {
      return;
    }
    void this.view.webview.postMessage(event);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
