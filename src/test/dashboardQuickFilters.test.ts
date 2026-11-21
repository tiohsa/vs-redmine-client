import * as assert from "assert";
import { runInNewContext } from "vm";
import { dashboardWebviewScript } from "../dashboard/dashboardWebviewScript";

type Ticket = { assigneeId?: number; statusId?: number; dueDate?: string; priorityName?: string; syncState: string };
type Capabilities = { mine: "loading" | "available" | "unavailable"; open: "loading" | "available" | "unavailable" };

const sourceBetween = (start: string, end: string): string => {
  const from = dashboardWebviewScript.indexOf(start);
  const to = dashboardWebviewScript.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return dashboardWebviewScript.slice(from, to);
};

const dateSource = sourceBetween("const DATE_ONLY_PATTERN =", "function resolveDueDateBadge(");
const predicateSource = sourceBetween("function quickFilterCapability(", "// ── Ticket list");
const renderTicketSource = sourceBetween("function flattenAll(", "// ── Operation feedback")
  + sourceBetween("function flattenVisible(", "function syncExpandedState(")
  + dateSource
  + predicateSource
  + sourceBetween("function renderTickets(){", "// ── Ticket detail / composer");

const matches = (
  ticket: Ticket,
  selected: string[],
  currentUserId?: number,
  statuses: Array<{ id: number; isClosed?: boolean }> = [],
  quickFilterCapabilities: Capabilities = {
    mine: currentUserId === undefined ? "unavailable" : "available",
    open: statuses.some((status) => typeof status.isClosed === "boolean") ? "available" : "unavailable",
  },
): boolean => {
  const result = runInNewContext(
    `${dateSource}\n${predicateSource}\nmatchesQuickFilters(ticket)`,
    {
      ticket,
      quickFilters: new Set(selected),
      state: { currentUserId, metadataOptions: { statuses }, quickFilterCapabilities },
      SYNC_META: Object.fromEntries(["Dirty", "Queued", "Syncing", "RecoveryPending", "CommitUnknown", "Failed", "Conflict"].map((name) => [name, true])),
      Date: class extends Date {
        constructor(value?: string | number) { super(value ?? "2026-09-23T12:00:00+09:00"); }
        static UTC = Date.UTC;
      },
    },
  );
  assert.strictEqual(typeof result, "boolean");
  return result;
};

const hasEffectiveFilters = (selected: string[], quickFilterCapabilities: Capabilities): boolean =>
  runInNewContext(`${predicateSource}\nhasEffectiveQuickFilters()`, {
    quickFilters: new Set(selected),
    state: { quickFilterCapabilities },
  }) as boolean;

const renderTicketList = (
  selected: string[],
  quickFilterCapabilities: Capabilities,
  tickets: Array<{ id: number; assigneeId?: number; syncState: string; children: Array<{ id: number; assigneeId?: number; syncState: string; children: [] }> }>,
): { ids: number[]; count: string; preferences: string[] } => {
  const quickFilters = new Set(selected);
  const list = { innerHTML: "", setAttribute: () => undefined, querySelectorAll: () => [] as unknown[] };
  const more = { setAttribute: () => undefined, textContent: "", onclick: undefined as (() => void) | undefined, classList: { add: () => undefined, remove: () => undefined } };
  const count = { textContent: "" };
  const moreError = { textContent: "", classList: { toggle: () => undefined } };
  const scroll = { scrollTop: 0 };
  const document = {
    getElementById: (id: string) => id === "ticket-list" ? list : id === "load-more-row" ? more : id === "load-more-error" ? moreError : id === "ticket-scroll" ? scroll : count,
    querySelectorAll: () => [] as unknown[],
  };
  const state = {
    currentUserId: 7,
    quickFilterCapabilities,
    metadataOptions: { statuses: [] },
    selectedProject: { id: 1 },
    tickets,
    loadedTicketCount: 2,
    totalTicketCount: 2,
    loading: { tickets: false },
    errors: {},
    settings: {},
  };
  runInNewContext(`${renderTicketSource}\nrenderTickets();`, {
    state,
    quickFilters,
    searchQuery: "",
    renderedTicketMarkup: null,
    ticketAppendStartIds: null,
    expandedTicketIds: new Set(),
    document,
    STRINGS: { ticketCountLabel: "Ticket count: {0}", loadedTickets: "Loaded {0}", shownLoadedTickets: "Showing {0} / {1}" },
    renderQuickFilters: () => undefined,
    captureFocus: () => null,
    renderTicketRow: (ticket: typeof tickets[number]) => `${ticket.id},`,
    restoreFocus: () => undefined,
    updateSyncButtonStates: () => undefined,
  });
  return {
    ids: list.innerHTML ? list.innerHTML.split(",").filter(Boolean).map(Number) : [],
    count: count.textContent,
    preferences: Array.from(quickFilters),
  };
};


const renderFilterButtons = (
  selected: string[],
  currentUserId?: number,
  statuses: Array<{ id: number; isClosed?: boolean }> = [],
  quickFilterCapabilities: Capabilities = {
    mine: currentUserId === undefined ? "unavailable" : "available",
    open: statuses.some((status) => typeof status.isClosed === "boolean") ? "available" : "unavailable",
  },
): { active: string[]; persisted?: string[]; buttons: Array<{ name: string; disabled: boolean; pressed: string; preferred: string; capability: string }> } => {
  const buttons = ["mine", "open", "overdue", "high"].map((name) => ({
    dataset: { quickFilter: name },
    disabled: false,
    title: "",
    attributes: {} as Record<string, string>,
    setAttribute(attribute: string, value: string) { this.attributes[attribute] = value; },
    removeAttribute(attribute: string) { delete this.attributes[attribute]; },
    textContent: name,
  }));
  const quickFilters = new Set(selected);
  let persisted: string[] | undefined;
  runInNewContext(`${predicateSource}\nrenderQuickFilters();`, {
    state: { currentUserId, metadataOptions: { statuses }, quickFilterCapabilities },
    quickFilters,
    document: { querySelectorAll: () => buttons },
    STRINGS: {
      quickMyIssuesUnavailable: "user unavailable",
      quickOpenUnavailable: "status unavailable",
      quickFilterCapabilityLoading: "filter loading",
      quickMyIssuesUnavailableSelected: "saved My Issues is inactive",
      quickOpenUnavailableSelected: "saved Open is inactive",
    },
    persistViewState: () => { persisted = Array.from(quickFilters); },
  });
  return {
    active: Array.from(quickFilters),
    persisted,
    buttons: buttons.map((button) => ({
      name: button.dataset.quickFilter,
      disabled: button.disabled,
      pressed: button.attributes["aria-pressed"],
      preferred: button.attributes["data-preferred"],
      capability: button.attributes["data-capability"],
    })),
  };
};

suite("Dashboard quick filters", () => {
  test("My Issues は表示名ではなく現在ユーザー ID で絞る", () => {
    assert.strictEqual(matches({ assigneeId: 7, syncState: "Synced" }, ["mine"], 7), true);
    assert.strictEqual(matches({ assigneeId: 8, syncState: "Synced" }, ["mine"], 7), false);
  });

  test("利用可能な My Issues は有効状態を保ち、現在ユーザー ID で適用する", () => {
    const rendered = renderFilterButtons(["mine"], 7);
    assert.deepStrictEqual(rendered.active, ["mine"]);
    assert.strictEqual(rendered.buttons[0].disabled, false);
    assert.strictEqual(rendered.buttons[0].pressed, "true");
    assert.strictEqual(matches({ assigneeId: 8, syncState: "Synced" }, rendered.active, 7), false);
  });

  test("My Issues の読込中は選択を保持し、filter が有効だとは示さない", () => {
    const loading = renderFilterButtons(["mine"], undefined, [], { mine: "loading", open: "loading" });
    assert.deepStrictEqual(loading.active, ["mine"]);
    assert.strictEqual(loading.buttons[0].disabled, true);
    assert.strictEqual(loading.buttons[0].pressed, "false");
    assert.strictEqual(loading.buttons[0].preferred, "true");
    assert.strictEqual(loading.buttons[0].capability, "loading");

    const available = renderFilterButtons(["mine"], 7, [], { mine: "available", open: "unavailable" });
    assert.strictEqual(available.buttons[0].pressed, "true");
    assert.strictEqual(matches({ assigneeId: 8, syncState: "Synced" }, available.active, 7, [], { mine: "available", open: "unavailable" }), false);
  });

  test("恒久的に利用できない My Issues は選択を保持しつつ非適用と示す", () => {
    const rendered = renderFilterButtons(["mine"], undefined);
    assert.deepStrictEqual(rendered.active, ["mine"]);
    assert.strictEqual(rendered.persisted, undefined);
    assert.strictEqual(rendered.buttons[0].disabled, true);
    assert.strictEqual(rendered.buttons[0].pressed, "false");
    assert.strictEqual(rendered.buttons[0].preferred, "true");
    assert.strictEqual(rendered.buttons[0].capability, "unavailable");
    assert.strictEqual(matches({ assigneeId: 8, syncState: "Synced" }, rendered.active, undefined, [], { mine: "unavailable", open: "unavailable" }), true);
  });

  test("読込中または利用不可の My Issues は一覧と件数に影響せず、子チケットを展開しない", () => {
    const children = [{ id: 2, assigneeId: 7, syncState: "Synced", children: [] as [] }];
    const tickets = [{ id: 1, assigneeId: 8, syncState: "Synced", children }];
    for (const capability of ["loading", "unavailable"] as const) {
      const capabilities = { mine: capability, open: "unavailable" as const };
      const button = renderFilterButtons(["mine"], undefined, [], capabilities).buttons[0];
      const rendered = renderTicketList(["mine"], capabilities, tickets);
      assert.strictEqual(button.pressed, "false");
      assert.strictEqual(button.preferred, "true");
      assert.strictEqual(button.capability, capability);
      assert.deepStrictEqual(rendered.preferences, ["mine"]);
      assert.deepStrictEqual(rendered.ids, [1]);
      assert.strictEqual(rendered.count, "Showing 1 / 2");
      assert.strictEqual(matches({ assigneeId: 8, syncState: "Synced" }, ["mine"], undefined, [], capabilities), true);
    }
  });

  test("Open metadata 読込中は選択を保持し、filter が有効だとは示さない", () => {
    const rendered = renderFilterButtons(["open"], undefined, [], { mine: "loading", open: "loading" });
    assert.deepStrictEqual(rendered.active, ["open"]);
    assert.strictEqual(rendered.buttons[1].disabled, true);
    assert.strictEqual(rendered.buttons[1].pressed, "false");
    assert.strictEqual(rendered.buttons[1].preferred, "true");
    assert.strictEqual(rendered.buttons[1].capability, "loading");
  });

  test("終了 metadata が恒久的に利用できない Open は選択を保持しつつ非適用と示す", () => {
    const rendered = renderFilterButtons(["open"], undefined, [{ id: 1 }]);
    assert.deepStrictEqual(rendered.active, ["open"]);
    assert.strictEqual(rendered.persisted, undefined);
    assert.strictEqual(rendered.buttons[1].disabled, true);
    assert.strictEqual(rendered.buttons[1].pressed, "false");
    assert.strictEqual(rendered.buttons[1].preferred, "true");
    assert.strictEqual(rendered.buttons[1].capability, "unavailable");
    assert.strictEqual(matches({ statusId: 1, syncState: "Synced" }, rendered.active, undefined, [{ id: 1 }], { mine: "unavailable", open: "unavailable" }), true);
  });

  test("利用不可の Open は保存した選択を残し、折りたたみと件数表示に影響しない", () => {
    const capabilities = { mine: "unavailable" as const, open: "unavailable" as const };
    const button = renderFilterButtons(["open"], undefined, [{ id: 1 }], capabilities).buttons[1];
    const rendered = renderTicketList(["open"], capabilities, [
      { id: 1, syncState: "Synced", children: [{ id: 2, syncState: "Synced", children: [] }] },
    ]);
    assert.strictEqual(button.pressed, "false");
    assert.strictEqual(button.preferred, "true");
    assert.strictEqual(button.capability, "unavailable");
    assert.deepStrictEqual(rendered.preferences, ["open"]);
    assert.deepStrictEqual(rendered.ids, [1]);
    assert.strictEqual(rendered.count, "Showing 1 / 2");
    assert.strictEqual(matches({ statusId: 1, syncState: "Synced" }, ["open"], undefined, [{ id: 1 }], capabilities), true);
  });

  test("capability が利用可能になると保存済みフィルターが次の描画から有効になる", () => {
    const tickets = [{ id: 1, assigneeId: 8, syncState: "Synced", children: [{ id: 2, assigneeId: 7, syncState: "Synced", children: [] as [] }] }];
    const loading = { mine: "loading" as const, open: "unavailable" as const };
    const available = { mine: "available" as const, open: "unavailable" as const };
    const before = renderTicketList(["mine"], loading, tickets);
    const after = renderTicketList(["mine"], available, tickets);
    assert.deepStrictEqual(before.ids, [1]);
    assert.strictEqual(before.count, "Showing 1 / 2");
    assert.deepStrictEqual(after.ids, [1, 2]);
    assert.strictEqual(after.count, "Loaded 2");
    assert.deepStrictEqual(after.preferences, ["mine"]);
  });

  test("Open は終了属性を用い、名称や未知の属性を推測しない", () => {
    const statuses = [{ id: 1, isClosed: false }, { id: 2, isClosed: true }];
    assert.strictEqual(matches({ statusId: 1, syncState: "Synced" }, ["open"], undefined, statuses), true);
    assert.strictEqual(matches({ statusId: 2, syncState: "Synced" }, ["open"], undefined, statuses), false);
    assert.strictEqual(matches({ statusId: 3, syncState: "Synced" }, ["open"], undefined, statuses), false);
  });

  test("Overdue は日付のみをローカル暦日で判定する", () => {
    assert.strictEqual(matches({ dueDate: "2026-09-22", syncState: "Synced" }, ["overdue"]), true);
    assert.strictEqual(matches({ dueDate: "2026-09-23", syncState: "Synced" }, ["overdue"]), false);
    assert.strictEqual(matches({ dueDate: "2026-02-30", syncState: "Synced" }, ["overdue"]), false);
  });

  test("High priority フィルターの対象優先度と他フィルターとの AND 結合", () => {
    for (const priorityName of ["High", "Urgent", "Immediate", "高", "緊急", "今すぐ"]) {
      assert.strictEqual(matches({ priorityName, syncState: "Synced" }, ["high"]), true);
    }
    for (const priorityName of ["Normal", "Low", "通常", "低め", undefined]) {
      assert.strictEqual(matches({ priorityName, syncState: "Synced" }, ["high"]), false);
    }
    const statuses = [{ id: 1, isClosed: false }];
    assert.strictEqual(matches({ assigneeId: 7, statusId: 1, dueDate: "2026-09-22", priorityName: "High", syncState: "Synced" }, ["mine", "open", "overdue", "high"], 7, statuses), true);
    assert.strictEqual(matches({ assigneeId: 8, statusId: 1, dueDate: "2026-09-22", priorityName: "High", syncState: "Synced" }, ["mine", "open", "overdue", "high"], 7, statuses), false);
  });

  test("Overdue と High は metadata capability と無関係に有効", () => {
    const capabilities = { mine: "loading" as const, open: "unavailable" as const };
    assert.strictEqual(hasEffectiveFilters(["overdue"], capabilities), true);
    assert.strictEqual(hasEffectiveFilters(["high"], capabilities), true);
    assert.strictEqual(hasEffectiveFilters(["editing"], capabilities), true);
    assert.strictEqual(matches({ dueDate: "2026-09-22", syncState: "Synced" }, ["overdue"], undefined, [], capabilities), true);
    assert.strictEqual(matches({ priorityName: "Urgent", syncState: "Synced" }, ["high"], undefined, [], capabilities), true);
  });

  test("Editing クイックフィルターは既存チケットの Dirty と新規下書きの Draft/Dirty のみに一致する", () => {
    const capabilities = { mine: "available" as const, open: "available" as const };
    const statuses = [{ id: 1, isClosed: false }];
    assert.strictEqual(matches({ statusId: 1, syncState: "Dirty" }, ["editing"], 7, statuses, capabilities), true);
    for (const syncState of ["Synced", "Draft", "Queued", "Syncing", "Failed", "Conflict", "RecoveryPending", "CommitUnknown"]) {
      assert.strictEqual(matches({ statusId: 1, syncState }, ["editing"], 7, statuses, capabilities), false, `syncState=${syncState}`);
    }
    assert.strictEqual(matches({ statusId: 1, syncState: "Dirty" }, ["editing", "open"], 7, statuses, capabilities), true);
    assert.strictEqual(matches({ statusId: 2, syncState: "Dirty" }, ["editing", "open"], 7, [{ id: 1, isClosed: false }, { id: 2, isClosed: true }], capabilities), false);

    const matchDraft = (draft: { syncState: string; dueDate?: string; priorityName?: string }, selected: string[], syncFilter = "all"): boolean =>
      runInNewContext(`${dateSource}\n${predicateSource}\nmatchesDraftFilters(draft)`, {
        draft,
        quickFilters: new Set(selected),
        searchQuery: "",
        state: { quickFilterCapabilities: capabilities, settings: { filters: { syncFilter } } },
      }) as boolean;
    assert.strictEqual(matchDraft({ syncState: "Draft" }, ["editing"]), true);
    assert.strictEqual(matchDraft({ syncState: "Dirty" }, ["editing"]), true);
    assert.strictEqual(matchDraft({ syncState: "Queued" }, ["editing"]), false);
    assert.strictEqual(matchDraft({ syncState: "Failed" }, ["editing"]), false);
  });

  test("Editing クイックフィルターで子チケットのみ Dirty の場合は親を保持して自動展開する", () => {
    const capabilities = { mine: "available" as const, open: "available" as const };
    const rendered = renderTicketList(["editing"], capabilities, [
      { id: 1, syncState: "Synced", children: [{ id: 2, syncState: "Dirty", children: [] }] },
      { id: 3, syncState: "Queued", children: [] },
    ]);
    assert.deepStrictEqual(rendered.ids, [1, 2]);
    assert.strictEqual(rendered.count, "Loaded 2");
  });

  test("詳細フィルターの syncFilter は各モードに応じてチケットと新規下書きを絞り込む", () => {
    const capabilities = { mine: "available" as const, open: "available" as const };
    const matchTicketWithSyncFilter = (syncState: string, syncFilter: string): boolean =>
      runInNewContext(`${dateSource}\n${predicateSource}\nmatchesQuickFilters(ticket)`, {
        ticket: { syncState },
        quickFilters: new Set<string>(),
        state: { metadataOptions: { statuses: [] }, quickFilterCapabilities: capabilities, settings: { filters: { syncFilter } } },
      }) as boolean;
    const matchDraftWithSyncFilter = (syncState: string, syncFilter: string): boolean =>
      runInNewContext(`${dateSource}\n${predicateSource}\nmatchesDraftFilters(draft)`, {
        draft: { syncState },
        quickFilters: new Set<string>(),
        searchQuery: "",
        state: { quickFilterCapabilities: capabilities, settings: { filters: { syncFilter } } },
      }) as boolean;

    // dirty: 既存チケットの Dirty のみ（#NEW 下書きは除外）
    assert.strictEqual(matchTicketWithSyncFilter("Dirty", "dirty"), true);
    assert.strictEqual(matchTicketWithSyncFilter("Queued", "dirty"), false);
    assert.strictEqual(matchDraftWithSyncFilter("Draft", "dirty"), false);
    assert.strictEqual(matchDraftWithSyncFilter("Dirty", "dirty"), false);

    // editing: 既存 Dirty + #NEW の Draft / Dirty
    assert.strictEqual(matchTicketWithSyncFilter("Dirty", "editing"), true);
    assert.strictEqual(matchTicketWithSyncFilter("Queued", "editing"), false);
    assert.strictEqual(matchDraftWithSyncFilter("Draft", "editing"), true);
    assert.strictEqual(matchDraftWithSyncFilter("Dirty", "editing"), true);
    assert.strictEqual(matchDraftWithSyncFilter("Queued", "editing"), false);

    // unsynced: Synced 以外すべて
    assert.strictEqual(matchTicketWithSyncFilter("Synced", "unsynced"), false);
    assert.strictEqual(matchTicketWithSyncFilter("Dirty", "unsynced"), true);
    assert.strictEqual(matchTicketWithSyncFilter("Queued", "unsynced"), true);
    assert.strictEqual(matchTicketWithSyncFilter("Failed", "unsynced"), true);
    assert.strictEqual(matchDraftWithSyncFilter("Draft", "unsynced"), true);
    assert.strictEqual(matchDraftWithSyncFilter("Queued", "unsynced"), true);
  });
});
