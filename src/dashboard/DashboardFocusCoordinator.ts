import * as vscode from "vscode";
import { scheduleTask } from "../packages/framework-core";
import type { DashboardEvent } from "./dashboardProtocol";

export type DashboardFocusView = {
  visible: boolean;
  webview: { postMessage: (message: DashboardEvent) => Thenable<boolean> };
};
type ActiveFocusRequest = {
  resolve: () => void;
  reject: (error: Error) => void;
  cancelTimeout: () => void;
  posting: boolean;
  revealComplete: boolean;
};

export class DashboardFocusCoordinator {
  private view?: DashboardFocusView;
  private readyView?: DashboardFocusView;
  private flight?: Promise<void>;
  private active?: ActiveFocusRequest;

  setView(view: DashboardFocusView | undefined): void {
    if (this.view && this.view !== view && this.active) {
      this.cancel(new Error(vscode.l10n.t("The Dashboard view changed before it was ready.")));
    }
    this.view = view;
    this.readyView = undefined;
  }

  markReady(view: DashboardFocusView): void {
    if (this.view !== view) { return; }
    this.readyView = view;
    this.tryPost();
  }

  visibilityChanged(): void {
    this.tryPost();
  }

  focus(reveal: () => Thenable<unknown>): Promise<void> {
    if (this.flight) { return this.flight; }

    const promise = new Promise<void>((resolve, reject) => {
      const active: ActiveFocusRequest = { resolve, reject, cancelTimeout: () => undefined, posting: false, revealComplete: false };
      active.cancelTimeout = scheduleTask(() => {
        if (this.active === active) {
          this.cancel(new Error(vscode.l10n.t("Timed out while opening or focusing the Dashboard search.")));
        }
      }, 5000);
      this.active = active;
      void Promise.resolve().then(reveal).then(() => {
        if (this.active !== active) { return; }
        active.revealComplete = true;
        this.tryPost();
      }, (error: unknown) => {
        if (this.active === active) {
          this.cancel(new Error(vscode.l10n.t("Could not open the Dashboard search: {0}", error instanceof Error ? error.message : String(error))));
        }
      });
    });

    this.flight = promise;
    void promise.finally(() => {
      if (this.flight === promise) { this.flight = undefined; }
    }).catch(() => undefined);
    return promise;
  }

  cancel(error: Error): void {
    const active = this.active;
    if (!active) { return; }
    this.active = undefined;
    active.cancelTimeout();
    active.reject(error);
  }

  private async post(view: DashboardFocusView, active: ActiveFocusRequest): Promise<void> {
    active.posting = true;
    try {
      const event: DashboardEvent = { type: "view.focusTicketSearch" };
      const accepted = await view.webview.postMessage(event);
      if (!accepted) { throw new Error(vscode.l10n.t("The Dashboard did not accept the search focus request.")); }
      if (this.active === active) {
        this.active = undefined;
        active.cancelTimeout();
        active.resolve();
      }
    } catch (error) {
      if (this.active === active) {
        this.cancel(new Error(vscode.l10n.t("Could not focus the Dashboard search: {0}", error instanceof Error ? error.message : String(error))));
      }
    }
  }

  private tryPost(): void {
    const active = this.active;
    const view = this.view;
    if (!active || !active.revealComplete || active.posting || !view?.visible || this.readyView !== view) { return; }
    void this.post(view, active);
  }
}
