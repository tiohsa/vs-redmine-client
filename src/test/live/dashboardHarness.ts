import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { DashboardController } from "../../dashboard/DashboardController";
import { DashboardMessageRouter } from "../../dashboard/DashboardMessageRouter";
import { DashboardStateStore } from "../../dashboard/DashboardStateStore";
import { buildDashboardHtml } from "../../dashboard/dashboardHtml";
import { buildDashboardStrings } from "../../dashboard/dashboardI18n";
import type { DashboardEvent } from "../../dashboard/dashboardProtocol";
import { onOfflineSyncQueueChanged } from "../../views/offlineSyncStore";
import type { LiveFixture } from "./liveFixture";

type Completion = Extract<DashboardEvent, { type: "operation.success" | "operation.error" }>;
interface Snapshot { text: string; disabled: boolean[]; feedback: string; feedbackClass: string }

/** 実VS Code Webview内のDOM操作を駆動する。製品コードにテスト用入口は追加しない。 */
export const openLiveDashboard = async (live: LiveFixture) => {
  const panel = vscode.window.createWebviewPanel("redmine-sync-live", "Redmine sync UI", vscode.ViewColumn.One, {
    enableScripts: true, retainContextWhenHidden: true,
  });
  const store = new DashboardStateStore();
  const completions: Completion[] = [];
  const pending = new Map<string, { resolve: (value: Snapshot) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const send = (event: DashboardEvent) => { void panel.webview.postMessage(event); };
  const controller = new DashboardController({
    store, syncEngine: live.engine(),
    notifyOperationStarted: (requestId, label) => send({ type: "operation.started", requestId, label }),
    notifySuccess: (requestId, message, level) => {
      const event: Completion = { type: "operation.success", requestId, message, level };
      completions.push(event); send(event);
    },
    notifyError: (requestId, message) => {
      const event: Completion = { type: "operation.error", requestId, message };
      completions.push(event); send(event);
    },
    notifyToast: (level, message) => send({ type: "toast", level, message }),
    onTicketsRefreshed: () => controller.refreshUnsyncedPresentation(),
  });
  const router = new DashboardMessageRouter(controller);
  let ready = false;
  const disposables = [panel, controller, { dispose: store.subscribe((state) => send({ type: "dashboard.state", state })) },
    { dispose: onOfflineSyncQueueChanged(() => controller.refreshUnsyncedPresentation()) },
    panel.webview.onDidReceiveMessage(async (raw: unknown) => {
      if (typeof raw !== "object" || raw === null) { return; }
      if ("type" in raw && raw.type === "test.snapshot" && "id" in raw && typeof raw.id === "string") {
        const waiter = pending.get(raw.id);
        if (!waiter) { return; }
        pending.delete(raw.id); clearTimeout(waiter.timer);
        if (!("text" in raw) || typeof raw.text !== "string" || !("disabled" in raw) || !Array.isArray(raw.disabled) ||
          !raw.disabled.every((value): value is boolean => typeof value === "boolean") ||
          !("feedback" in raw) || typeof raw.feedback !== "string" || !("feedbackClass" in raw) || typeof raw.feedbackClass !== "string") {
          waiter.reject(new Error("Webviewの検証結果が不正です")); return;
        }
        waiter.resolve({ text: raw.text, disabled: raw.disabled, feedback: raw.feedback, feedbackClass: raw.feedbackClass });
        return;
      }
      await router.route(raw);
      if ("type" in raw && raw.type === "dashboard.ready") { ready = true; }
    }),
  ];
  const nonce = randomUUID();
  // DOMのclickは製品のイベントリスナーとacquireVsCodeApiをそのまま通る。
  const driver = `
    window.addEventListener('message', event => {
      const message=event.data;
      if(message.type !== 'test.dom') return;
      if(message.selector){
        const element=document.querySelector(message.selector);
        if(element){ element.focus(); element.click(); if(message.twice) element.click(); }
      }
      queueMicrotask(() => vscode.postMessage({type:'test.snapshot',id:message.id,
        text:document.getElementById('unsynced-list').textContent,
        disabled:[...document.querySelectorAll('#unsynced-list .unsynced-actions button')].map(button=>button.disabled),
        feedback:document.getElementById('unsynced-feedback').textContent,
        feedbackClass:document.getElementById('unsynced-feedback').className}));
    });
  `;
  panel.webview.html = buildDashboardHtml(nonce, buildDashboardStrings()).replace("}());</script>", `${driver}\n}());</script>`);
  const waitFor = async (check: () => boolean, label: string) => {
    const until = Date.now() + 30_000;
    while (!check()) {
      if (Date.now() > until) { throw new Error(`Webview timeout: ${label}`); }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  const dom = (selector?: string, twice = false): Promise<Snapshot> => new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Webview DOM応答がありません")); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    void panel.webview.postMessage({ type: "test.dom", id, selector, twice });
  });
  const dispose = () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("Webview closed")); }
    pending.clear(); disposables.reverse().forEach((item) => item.dispose());
  };
  try {
    await waitFor(() => ready, "dashboard.ready");
    controller.refreshUnsyncedPresentation();
    await dom("#tab-unsynced");
  } catch (error) { dispose(); throw error; }
  return {
    dom, dispose, store, waitFor,
    async click(selector: string, twice = false): Promise<{ result: Completion; snapshot: Snapshot }> {
      const count = completions.length;
      await dom(selector, twice);
      await waitFor(() => completions.length > count, selector);
      return { result: completions[count], snapshot: await dom() };
    },
  };
};

/** Native確認ダイアログの選択だけを固定する。DOM・Router・同期/APIは実物を使う。 */
export const chooseConfirmation = (choice?: string): vscode.Disposable => {
  const original = vscode.window.showWarningMessage;
  vscode.window.showWarningMessage = async <T extends string | vscode.MessageItem>(
    _message: string, ...items: Array<T | vscode.MessageOptions>
  ): Promise<T | undefined> => items.find((item): item is T =>
    typeof item === "string" && item === choice);
  return { dispose: () => { vscode.window.showWarningMessage = original; } };
};
