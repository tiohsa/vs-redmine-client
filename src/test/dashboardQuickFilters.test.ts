import * as assert from "assert";
import { runInNewContext } from "vm";
import { dashboardWebviewScript } from "../dashboard/dashboardWebviewScript";

type Ticket = { assigneeId?: number; statusId?: number; dueDate?: string; syncState: string };
type Capabilities = { mine: "loading" | "available" | "unavailable"; open: "loading" | "available" | "unavailable" };

const sourceBetween = (start: string, end: string): string => {
  const from = dashboardWebviewScript.indexOf(start);
  const to = dashboardWebviewScript.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return dashboardWebviewScript.slice(from, to);
};

const dateSource = sourceBetween("const DATE_ONLY_PATTERN =", "function resolveDueDateBadge(");
const predicateSource = sourceBetween("function quickFilterCapability(", "// ── Ticket list");

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


const renderFilterButtons = (
  selected: string[],
  currentUserId?: number,
  statuses: Array<{ id: number; isClosed?: boolean }> = [],
  quickFilterCapabilities: Capabilities = {
    mine: currentUserId === undefined ? "unavailable" : "available",
    open: statuses.some((status) => typeof status.isClosed === "boolean") ? "available" : "unavailable",
  },
): { active: string[]; persisted?: string[]; buttons: Array<{ name: string; disabled: boolean; pressed: string; preferred: string; capability: string }> } => {
  const buttons = ["mine", "open", "overdue", "unsynced"].map((name) => ({
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

  test("Unsynced の対象状態とフィルターの AND 結合", () => {
    for (const syncState of ["Dirty", "Queued", "Syncing", "RecoveryPending", "CommitUnknown", "Failed", "Conflict"]) {
      assert.strictEqual(matches({ syncState }, ["unsynced"]), true);
    }
    for (const syncState of ["Synced", "Draft"]) {
      assert.strictEqual(matches({ syncState }, ["unsynced"]), false);
    }
    const statuses = [{ id: 1, isClosed: false }];
    assert.strictEqual(matches({ assigneeId: 7, statusId: 1, dueDate: "2026-09-22", syncState: "Queued" }, ["mine", "open", "overdue", "unsynced"], 7, statuses), true);
    assert.strictEqual(matches({ assigneeId: 8, statusId: 1, dueDate: "2026-09-22", syncState: "Queued" }, ["mine", "open", "overdue", "unsynced"], 7, statuses), false);
  });
});
