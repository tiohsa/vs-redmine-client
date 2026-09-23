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
  unsynced: { totalCount: number; items: Array<{ lifecycle?: string; requiresReview?: boolean; key?: { kind?: string; ticketId?: number } }> };
}
interface FakeElement {
  textContent: string;
  className: string;
  dataset: Record<string, string>;
  disabled: boolean;
  click?: () => void;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (name: string, action: () => void) => void;
}

const present = (state: TrayState, clickLabel?: string): { text: string; buttons: string[]; actions: Array<{ type: string; ticketId?: number }> } => {
  const children: Array<{ textContent: string; click?: () => void }> = [];
  const actions: Array<{ type: string; ticketId?: number }> = [];
  const tray = { replaceChildren: () => { children.length = 0; }, appendChild: (child: typeof children[number]) => { children.push(child); } };
  const document = {
    getElementById: () => tray,
    createElement: (): FakeElement => {
      const element: FakeElement = { textContent: "", className: "", dataset: {}, disabled: false, setAttribute: () => {}, addEventListener: (_name, action) => { element.click = action; } };
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

const state = (syncState = "Synced", lifecycle?: string, count = 0, queuedTicketId?: number, requiresReview = false): TrayState => ({
  tickets: [{ id: 10, syncState, children: [] }],
  unsynced: { totalCount: count, items: lifecycle ? [{ lifecycle, requiresReview, ...(queuedTicketId === undefined ? {} : { key: { kind: "ticket", ticketId: queuedTicketId } }) }] : [] },
});

interface UnsyncedElement {
  textContent: string;
  innerHTML: string;
  hidden: boolean;
  onclick?: () => void;
  setAttribute: (name: string, value: string) => void;
  classList: { toggle: (name: string, force?: boolean) => void };
  querySelectorAll: (selector: string) => Array<{ addEventListener: (name: string, action: () => void) => void }>;
}

const renderUnsynced = (
  items: Array<{ lifecycle: string; requiresReview?: boolean; key: { kind: string; ticketId: number }; label: string }>,
  abandonedItems: Array<{ key: { kind: string; ticketId: number }; label: string; processingRecord?: string }> = [],
  toggleAbandoned = false,
) => {
  const elements: Record<string, UnsyncedElement> = {};
  for (const id of ["unsynced-badge", "unsynced-count-label", "sync-all-btn", "unsynced-summary", "unsynced-list", "abandoned-toggle", "abandoned-list"]) {
    const element: UnsyncedElement = {
      textContent: "",
      innerHTML: "",
      hidden: false,
      setAttribute: () => {},
      classList: { toggle: (name, force) => { if (name === "hidden") { element.hidden = force === true; } } },
      querySelectorAll: () => [],
    };
    elements[id] = element;
  }
  const unsyncedFunctions = extract("const UNSYNCED_BADGE_META=", "// ── Comments");
  runInNewContext(`${unsyncedFunctions}\nrenderUnsynced();${toggleAbandoned ? "document.getElementById('abandoned-toggle').onclick();" : ""}`, {
    state: { unsynced: { items, totalCount: items.length, abandonedItems } },
    document: { getElementById: (id: string) => elements[id] },
    STRINGS: {
      syncQueued: "Queued", syncReviewRequired: "Review Required", syncFailed: "Failed", syncConflict: "Conflict",
      unsyncedCountLabel: "{0} items", tabUnsynced: "Unsynced", noUnsyncedChanges: "No changes",
      unsyncedKindTicket: "Ticket", unsyncedKindNewTicket: "New ticket", unsyncedKindComment: "Comment",
      unsyncedKindFile: "File", resolveRecovery: "Resolve recovery", resolveRecoveryTooltip: "Resolve recovery",
      syncToRedmine: "Sync to Redmine", discardAction: "Discard", discardLaterChangesAction: "Discard later changes",
      discardLaterChangesTitle: "Discard later changes", discardTitle: "Discard",
      showAbandoned: "Show abandoned", hideAbandoned: "Hide abandoned", abandonedCount: "Abandoned: {0}",
      processingRecord: "Processing record", startNewTicketEdit: "Load latest and start new edit",
    },
    esc: (value: unknown) => String(value ?? ""),
    safeJson: (value: unknown) => JSON.stringify(value),
    actionIcon: () => "",
    badge: (label: string, className: string) => `<span class="badge ${className}">${label}</span>`,
    unsyncedKindLabel: () => "Ticket",
    updateSyncButtonStates: () => {},
    req: () => {},
  });
  return {
    cardHtml: elements["unsynced-list"].innerHTML,
    summaryHtml: elements["unsynced-summary"].innerHTML,
    syncAllHidden: elements["sync-all-btn"].hidden,
    abandonedHtml: elements["abandoned-list"].innerHTML,
    abandonedHidden: elements["abandoned-list"].hidden,
    abandonedToggleHidden: elements["abandoned-toggle"].hidden,
    abandonedToggleText: elements["abandoned-toggle"].textContent,
  };
};

suite("Dashboard sync attention tray", () => {
  test("中止済み0件では切替を隠す", () => {
    const result = renderUnsynced([]);
    assert.equal(result.abandonedToggleHidden, true);
    assert.equal(result.abandonedHtml, "");
  });

  test("中止済みのみを切り替えて処理記録と新規編集操作を表示する", () => {
    const abandoned = [{ key: { kind: "ticket", ticketId: 10 }, label: "Old ticket update", processingRecord: "old-operation" }];
    const closed = renderUnsynced([], abandoned);
    assert.equal(closed.abandonedToggleHidden, false);
    assert.equal(closed.abandonedHidden, true);
    assert.ok(closed.abandonedToggleText.includes("Abandoned: 1"));
    const opened = renderUnsynced([], abandoned, true);
    assert.equal(opened.abandonedHidden, false);
    assert.ok(opened.abandonedHtml.includes("old-operation"));
    assert.ok(opened.abandonedHtml.includes("Load latest and start new edit"));
  });

  test("通常項目と中止済み項目の混在時は通常項目だけを同期数に含める", () => {
    const result = renderUnsynced(
      [{ lifecycle: "queued", key: { kind: "ticket", ticketId: 11 }, label: "New update" }],
      [{ key: { kind: "ticket", ticketId: 10 }, label: "Old update" }],
      true,
    );
    assert.ok(result.cardHtml.includes("New update"));
    assert.ok(!result.cardHtml.includes("Old update"));
    assert.ok(result.abandonedHtml.includes("Old update"));
    assert.ok(result.summaryHtml.includes("Queued <strong>1</strong>"));
  });
  test("未同期なしと通常の未同期を区別する", () => {
    assert.deepStrictEqual(present(state()).buttons, []);
    assert.ok(present(state()).text.includes("All clear"));
    assert.deepStrictEqual(present(state("Queued", "queued", 2)).buttons, ["Sync All"]);
  });

  test("競合レビューは再同期せず既存の conflict-review request を送る", () => {
    const result = present(state("Conflict", "queued", 1, undefined, true), "Review");
    assert.deepStrictEqual(result.buttons, ["Review", "Open Unsynced"]);
    assert.deepStrictEqual(result.actions, [{ type: "tab:tickets" }, { type: "ticket.reviewConflict", ticketId: 10 }]);
  });

  test("queued でも requiresReview があれば Sync All ではなく Unsynced を開く", () => {
    const result = present(state("Queued", "queued", 1, undefined, true), "Open Unsynced");
    assert.ok(result.text.includes("Attention"));
    assert.deepStrictEqual(result.buttons, ["Open Unsynced"]);
    assert.deepStrictEqual(result.actions, [{ type: "tab:unsynced" }]);
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

  test("通常の queued item は queued 表示と Sync All を維持する", () => {
    const result = renderUnsynced([{ lifecycle: "queued", requiresReview: false, key: { kind: "ticket", ticketId: 10 }, label: "Ticket #10" }]);
    assert.ok(result.cardHtml.includes('class="badge sync-queued">Queued</span>'));
    assert.ok(result.summaryHtml.includes('Queued <strong>1</strong>'));
    assert.ok(result.cardHtml.includes("Sync to Redmine"));
    assert.equal(result.syncAllHidden, false);
  });

  test("queued + requiresReview はカード・summary・bulk action の review 状態を共有する", () => {
    const result = renderUnsynced([{ lifecycle: "queued", requiresReview: true, key: { kind: "ticket", ticketId: 10 }, label: "Ticket #10" }]);
    assert.ok(result.cardHtml.includes('class="badge sync-conflict">Review Required</span>'));
    assert.ok(result.summaryHtml.includes('Review Required <strong>1</strong>'));
    assert.ok(!result.summaryHtml.includes("Queued"));
    assert.ok(result.cardHtml.includes("Resolve recovery"));
    assert.ok(!result.cardHtml.includes("Sync to Redmine"));
    assert.equal(result.syncAllHidden, true);
  });

  test("recovery_pending と commit_unknown の既存 review 分類を保つ", () => {
    for (const lifecycle of ["recovery_pending", "commit_unknown"]) {
      const result = renderUnsynced([{ lifecycle, key: { kind: "ticket", ticketId: 10 }, label: "Ticket #10" }]);
      assert.ok(result.cardHtml.includes('class="badge sync-conflict">Review Required</span>'));
      assert.ok(result.summaryHtml.includes('Review Required <strong>1</strong>'));
      assert.ok(result.cardHtml.includes("Resolve recovery"));
      assert.equal(result.syncAllHidden, true);
    }
  });

  test("mixed queue は各 summary を正しく分け、review があれば Sync All を隠す", () => {
    const result = renderUnsynced([
      { lifecycle: "queued", requiresReview: false, key: { kind: "ticket", ticketId: 10 }, label: "Ticket #10" },
      { lifecycle: "queued", requiresReview: true, key: { kind: "ticket", ticketId: 11 }, label: "Ticket #11" },
    ]);
    assert.ok(result.summaryHtml.includes('Queued <strong>1</strong>'));
    assert.ok(result.summaryHtml.includes('Review Required <strong>1</strong>'));
    assert.equal(result.syncAllHidden, true);
  });
});
