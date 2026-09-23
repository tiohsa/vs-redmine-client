import * as assert from "assert";
import { runInNewContext } from "vm";
import { dashboardWebviewScript } from "../dashboard/dashboardWebviewScript";

const extract = (start: string, end: string): string => {
  const from = dashboardWebviewScript.indexOf(start);
  const to = dashboardWebviewScript.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return dashboardWebviewScript.slice(from, to);
};

const functions = extract("function flattenAll(", "// ── Operation feedback")
  + extract("function deriveSyncTrayState(", "function endOperation(");

interface TrayState {
  tickets: Array<{ id: number; syncState: string; children: unknown[] }>;
  unsynced: { totalCount: number; items: Array<{ lifecycle?: string; key?: { kind?: string; ticketId?: number } }> };
}
interface FakeElement {
  textContent: string;
  className: string;
  dataset: Record<string, string>;
  disabled: boolean;
  click?: () => void;
  addEventListener: (name: string, action: () => void) => void;
}

const present = (state: TrayState, clickLabel?: string): { text: string; buttons: string[]; actions: Array<{ type: string; ticketId?: number }> } => {
  const children: Array<{ textContent: string; click?: () => void }> = [];
  const actions: Array<{ type: string; ticketId?: number }> = [];
  const tray = { replaceChildren: () => { children.length = 0; }, appendChild: (child: typeof children[number]) => { children.push(child); } };
  const document = {
    getElementById: () => tray,
    createElement: (): FakeElement => {
      const element: FakeElement = { textContent: "", className: "", dataset: {}, disabled: false, addEventListener: (_name, action) => { element.click = action; } };
      return element;
    },
  };
  runInNewContext(`${functions}\nrenderSyncTray();`, {
    state, document, activeSyncRequests: new Set(),
    STRINGS: { syncTrayAttention: "Attention", syncTrayItems: "{0} pending", syncTrayAllClear: "All clear", syncTrayReviewConflict: "Review", syncTrayOpenUnsynced: "Open Unsynced", syncTrayOpenEditor: "Open in Editor", syncTrayFailedTicket: "Ticket #{0} failed to sync", syncAllBtn: "Sync All" },
    activateTab: (name: string) => { actions.push({ type: `tab:${name}` }); },
    req: (type: string, extra?: { ticketId: number }) => { actions.push({ type, ticketId: extra?.ticketId }); },
  });
  const buttons = children.slice(1);
  for (const button of buttons) {
    if (button.textContent === clickLabel) { button.click?.(); }
  }
  return { text: children[0].textContent, buttons: buttons.map((button) => button.textContent), actions };
};

const state = (syncState = "Synced", lifecycle?: string, count = 0, queuedTicketId?: number): TrayState => ({
  tickets: [{ id: 10, syncState, children: [] }],
  unsynced: { totalCount: count, items: lifecycle ? [{ lifecycle, ...(queuedTicketId === undefined ? {} : { key: { kind: "ticket", ticketId: queuedTicketId } }) }] : [] },
});

suite("Dashboard sync attention tray", () => {
  test("未同期なしと通常の未同期を区別する", () => {
    assert.deepStrictEqual(present(state()).buttons, []);
    assert.ok(present(state()).text.includes("All clear"));
    assert.deepStrictEqual(present(state("Queued", "queued", 2)).buttons, ["Sync All"]);
  });

  test("競合レビューは再同期せず既存の conflict-review request を送る", () => {
    const result = present(state("Conflict", undefined, 1), "Review");
    assert.deepStrictEqual(result.buttons, ["Review", "Open Unsynced"]);
    assert.deepStrictEqual(result.actions, [{ type: "tab:tickets" }, { type: "ticket.reviewConflict", ticketId: 10 }]);
  });

  test("RecoveryPending と CommitUnknown は Open Unsynced へ誘導する", () => {
    for (const item of [state("RecoveryPending", "recovery_pending", 1), state("CommitUnknown", "commit_unknown", 1)]) {
      const result = present(item);
      assert.ok(result.text.includes("Attention"));
      assert.deepStrictEqual(result.buttons, ["Open Unsynced"]);
    }
  });

  test("Failed に対応するキューがあれば Open Unsynced を表示する", () => {
    assert.deepStrictEqual(present(state("Failed", "queued", 1, 10)).buttons, ["Open Unsynced"]);
  });

  test("キューのない Failed はチケットを示し既存の Open in Editor 経路を使う", () => {
    const result = present(state("Failed"), "Open in Editor");
    assert.ok(result.text.includes("Ticket #10 failed to sync"));
    assert.deepStrictEqual(result.buttons, ["Open in Editor"]);
    assert.deepStrictEqual(result.actions, [{ type: "tab:tickets" }, { type: "ticket.openEditor", ticketId: 10 }]);
  });
});
