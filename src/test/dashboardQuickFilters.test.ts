import * as assert from "assert";
import { runInNewContext } from "vm";
import { dashboardWebviewScript } from "../dashboard/dashboardWebviewScript";

type Ticket = { assigneeId?: number; statusId?: number; dueDate?: string; syncState: string };

const sourceBetween = (start: string, end: string): string => {
  const from = dashboardWebviewScript.indexOf(start);
  const to = dashboardWebviewScript.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return dashboardWebviewScript.slice(from, to);
};

const dateSource = sourceBetween("const DATE_ONLY_PATTERN =", "function resolveDueDateBadge(");
const predicateSource = sourceBetween("function matchesQuickFilters(", "function renderQuickFilters(");

const matches = (
  ticket: Ticket,
  selected: string[],
  currentUserId?: number,
  statuses: Array<{ id: number; isClosed?: boolean }> = [],
): boolean => {
  const result = runInNewContext(
    `${dateSource}\n${predicateSource}\nmatchesQuickFilters(ticket)`,
    {
      ticket,
      quickFilters: new Set(selected),
      state: { currentUserId, metadataOptions: { statuses } },
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

suite("Dashboard quick filters", () => {
  test("My Issues は表示名ではなく現在ユーザー ID で絞る", () => {
    assert.strictEqual(matches({ assigneeId: 7, syncState: "Synced" }, ["mine"], 7), true);
    assert.strictEqual(matches({ assigneeId: 8, syncState: "Synced" }, ["mine"], 7), false);
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
