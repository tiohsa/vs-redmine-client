import * as assert from "assert";
import * as vscode from "vscode";
import { DashboardFocusCoordinator } from "../dashboard/DashboardFocusCoordinator";
import { scheduleTask } from "../packages/framework-core";

suite("Dashboard search focus", () => {
  test("waits for a cold view to be ready and visible before posting the focus event", async () => {
    const coordinator = new DashboardFocusCoordinator();
    const posted: unknown[] = [];
    const view = {
      visible: false,
      webview: { postMessage: async (event: unknown) => { posted.push(event); return true; } },
    };
    let revealFinished = false;
    const focus = coordinator.focus(async () => { revealFinished = true; });
    await Promise.resolve();
    assert.equal(revealFinished, true);
    assert.deepEqual(posted, []);

    coordinator.setView(view);
    coordinator.markReady(view);
    await new Promise<void>((resolve) => { scheduleTask(resolve, 0); });
    assert.deepEqual(posted, []);

    view.visible = true;
    coordinator.visibilityChanged();
    await focus;

    assert.deepEqual(posted, [{ type: "view.focusTicketSearch" }]);
  });

  test("coalesces repeated requests during reveal and readiness wait", async () => {
    const coordinator = new DashboardFocusCoordinator();
    const posted: unknown[] = [];
    const view = {
      visible: true,
      webview: { postMessage: async (event: unknown) => { posted.push(event); return true; } },
    };
    coordinator.setView(view);
    let finishReveal!: () => void;
    let revealCalls = 0;
    const reveal = (): Promise<void> => {
      revealCalls++;
      return new Promise((resolve) => { finishReveal = resolve; });
    };

    const first = coordinator.focus(reveal);
    const second = coordinator.focus(reveal);
    assert.strictEqual(first, second);
    await Promise.resolve();
    finishReveal();
    await Promise.resolve();
    coordinator.markReady(view);
    await Promise.all([first, second]);

    assert.equal(revealCalls, 1);
    assert.deepEqual(posted, [{ type: "view.focusTicketSearch" }]);
  });

  test("does not post a stale event after reveal fails", async () => {
    const coordinator = new DashboardFocusCoordinator();
    const posted: unknown[] = [];
    const view = {
      visible: true,
      webview: { postMessage: async (event: unknown) => { posted.push(event); return true; } },
    };
    coordinator.setView(view);
    const focus = coordinator.focus(async () => { throw new Error("reveal failed"); });

    await assert.rejects(focus, { message: vscode.l10n.t("Could not open the Dashboard search: {0}", "reveal failed") });
    coordinator.markReady(view);
    assert.deepEqual(posted, []);
  });

  test("expires a request while waiting for ready and ignores a late handshake", async () => {
    const coordinator = new DashboardFocusCoordinator();
    const posted: unknown[] = [];
    const view = {
      visible: true,
      webview: { postMessage: async (event: unknown) => { posted.push(event); return true; } },
    };
    coordinator.setView(view);

    await assert.rejects(coordinator.focus(async () => undefined), {
      message: vscode.l10n.t("Timed out while opening or focusing the Dashboard search."),
    });
    coordinator.markReady(view);
    assert.deepEqual(posted, []);

    await coordinator.focus(async () => undefined);
    assert.deepEqual(posted, [{ type: "view.focusTicketSearch" }]);
  });

  test("disposal cancels its request and a late reveal cannot affect a newer request", async () => {
    const coordinator = new DashboardFocusCoordinator();
    const stalePosted: unknown[] = [];
    const staleView = {
      visible: true,
      webview: { postMessage: async (event: unknown) => { stalePosted.push(event); return true; } },
    };
    coordinator.setView(staleView);
    let finishStaleReveal!: () => void;
    const stale = coordinator.focus(() => new Promise<void>((resolve) => { finishStaleReveal = resolve; }));
    await Promise.resolve();
    coordinator.setView(undefined);
    await assert.rejects(stale, { message: vscode.l10n.t("The Dashboard view changed before it was ready.") });

    const currentPosted: unknown[] = [];
    const currentView = {
      visible: true,
      webview: { postMessage: async (event: unknown) => { currentPosted.push(event); return true; } },
    };
    coordinator.setView(currentView);
    coordinator.markReady(currentView);
    const current = coordinator.focus(async () => undefined);
    await Promise.resolve();
    finishStaleReveal();
    await current;

    assert.deepEqual(stalePosted, []);
    assert.deepEqual(currentPosted, [{ type: "view.focusTicketSearch" }]);
  });
});
