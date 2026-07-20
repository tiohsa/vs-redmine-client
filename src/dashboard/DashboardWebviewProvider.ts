import * as crypto from "crypto";
import * as vscode from "vscode";
import { buildDashboardHtml } from "./dashboardHtml";
import { buildDashboardStrings } from "./dashboardI18n";
import { DashboardController } from "./DashboardController";
import { DashboardMessageRouter } from "./DashboardMessageRouter";
import { DashboardStateStore } from "./DashboardStateStore";
import type { DashboardEvent, DashboardState } from "./dashboardProtocol";
import { VIEW_ID_DASHBOARD } from "./dashboardProtocol";

export { VIEW_ID_DASHBOARD };

const generateNonce = (): string => crypto.randomBytes(16).toString("base64");

export class DashboardWebviewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view?: vscode.WebviewView;
  private latestState?: DashboardState;
  private readonly store: DashboardStateStore;
  private readonly controller: DashboardController;
  private readonly router: DashboardMessageRouter;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {
    this.store = new DashboardStateStore();

    this.controller = new DashboardController({
      store: this.store,
      notifyOperationStarted: (requestId, label) => {
        this.send({ type: "operation.started", requestId, label });
      },
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
    webviewView.webview.html = buildDashboardHtml(nonce, buildDashboardStrings());

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(async (raw: unknown) => {
        if (token.isCancellationRequested) {
          return;
        }
        await this.router.route(raw);
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible && this.latestState) {
          this.send({ type: "dashboard.state", state: this.latestState });
        }
      }),
    );
  }

  private send(event: DashboardEvent): void {
    if (event.type === "dashboard.state") {
      this.latestState = event.state;
    }
    if (!this.view?.visible) {
      return;
    }
    void this.view.webview.postMessage(event);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  refreshTickets(): void {
    this.controller.refreshTickets();
  }

  refreshCommentsForTicket(ticketId: number): void {
    this.controller.refreshCommentsForTicket(ticketId);
  }

  refreshUnsynced(): void {
    this.controller.refreshUnsyncedPresentation();
  }

  refreshSettings(): void {
    this.controller.refreshSettings();
  }

  selectProject(projectId: number): Promise<void> {
    return this.controller.selectProject(projectId);
  }

  updateTicketSubject(ticketId: number, subject: string): void {
    this.controller.updateTicketSubject(ticketId, subject);
  }

  notifyTicketChanged(): void {
    this.controller.notifyTicketChanged();
  }

  resetForConnectionChange(): Promise<void> {
    return this.controller.resetForConnectionChange();
  }

  getStateSnapshot(): DashboardState {
    return this.store.getState();
  }
}
