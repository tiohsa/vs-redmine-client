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
  + extract("function renderSyncTray(", "function endOperation(");

interface TrayState {
  tickets: Array<{ id: number; syncState: string; children: unknown[] }>;
  unsynced: { totalCount: number; items: Array<{ lifecycle?: string }> };
}
interface FakeElement {
  textContent: string;
  className: string;
  dataset: Record<string, string>;
  disabled: boolean;
  click?: () => void;
  addEventListener: (name: string, action: () => void) => void;
}

const present = (state: TrayState): { text: string; buttons: string[]; actions: Array<{ type: string; ticketId?: number }> } => {
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
    STRINGS: { syncTrayAttention: "Attention", syncTrayItems: "{0} pending", syncTrayAllClear: "All clear", syncTrayReviewConflict: "Review", syncTrayOpenUnsynced: "Open Unsynced", syncAllBtn: "Sync All" },
    activateTab: (name: string) => { actions.push({ type: `tab:${name}` }); },
    req: (type: string, extra?: { ticketId: number }) => { actions.push({ type, ticketId: extra?.ticketId }); },
  });
  const buttons = children.slice(1);
  for (const button of buttons) {
    if (button.textContent === "Review") { button.click?.(); }
  }
  return { text: children[0].textContent, buttons: buttons.map((button) => button.textContent), actions };
};

const state = (syncState = "Synced", lifecycle?: string, count = 0): TrayState => ({
  tickets: [{ id: 10, syncState, children: [] }],
  unsynced: { totalCount: count, items: lifecycle ? [{ lifecycle }] : [] },
});

suite("Dashboard sync attention tray", () => {
  test("未同期なしと通常の未同期を区別する", () => {
    assert.deepStrictEqual(present(state()).buttons, []);
    assert.ok(present(state()).text.includes("All clear"));
    assert.deepStrictEqual(present(state("Queued", "queued", 2)).buttons, ["Sync All"]);
  });

  test("競合を具体的なチケットで既存同期経路に接続する", () => {
    const result = present(state("Conflict", undefined, 1));
    assert.deepStrictEqual(result.buttons, ["Review", "Open Unsynced"]);
    assert.deepStrictEqual(result.actions, [{ type: "tab:tickets" }, { type: "ticket.syncSelected", ticketId: 10 }]);
  });

  test("回復・結果不明・失敗は注意を示し、競合対象不明なら Review を出さない", () => {
    for (const item of [state("RecoveryPending", "recovery_pending", 1), state("CommitUnknown", "commit_unknown", 1), state("Failed", undefined, 1)]) {
      const result = present(item);
      assert.ok(result.text.includes("Attention"));
      assert.deepStrictEqual(result.buttons, ["Open Unsynced"]);
    }
  });
});
