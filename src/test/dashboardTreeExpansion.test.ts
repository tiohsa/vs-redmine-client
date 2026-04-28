import * as assert from "assert";
import type { Ticket } from "../redmine/types";

// ダッシュボードのチケット折りたたみロジック
const getVisibleTickets = (tickets: Ticket[], expandedTicketIds: number[]): Ticket[] => {
  const expanded = new Set(expandedTicketIds);
  const result: Ticket[] = [];
  for (const t of tickets) {
    if (t.parentId && !expanded.has(t.parentId)) {
      continue;
    }
    result.push(t);
  }
  return result;
};

const toggleExpand = (expandedTicketIds: number[], ticketId: number): number[] => {
  return expandedTicketIds.includes(ticketId)
    ? expandedTicketIds.filter(id => id !== ticketId)
    : [...expandedTicketIds, ticketId];
};

const makeTicket = (id: number, parentId?: number): Ticket => ({
  id,
  subject: `Ticket #${id}`,
  projectId: 1,
  parentId,
});

suite("dashboardTreeExpansion — 展開/折りたたみロジック", () => {
  const tickets: Ticket[] = [
    makeTicket(1),
    makeTicket(2, 1),
    makeTicket(3, 1),
    makeTicket(4, 2),
    makeTicket(5),
  ];

  test("展開なしの場合、子チケットは表示されない", () => {
    const visible = getVisibleTickets(tickets, []);
    const ids = visible.map(t => t.id);
    assert.deepStrictEqual(ids, [1, 5], "ルートのみ表示");
  });

  test("親チケット1を展開すると子チケット2,3が表示される", () => {
    const visible = getVisibleTickets(tickets, [1]);
    const ids = visible.map(t => t.id);
    assert.ok(ids.includes(1), "親1が表示");
    assert.ok(ids.includes(2), "子2が表示");
    assert.ok(ids.includes(3), "子3が表示");
    assert.ok(!ids.includes(4), "孫4は未展開なので非表示");
    assert.ok(ids.includes(5), "別ルート5が表示");
  });

  test("親1と子2を展開すると孫4も表示される", () => {
    const visible = getVisibleTickets(tickets, [1, 2]);
    const ids = visible.map(t => t.id);
    assert.ok(ids.includes(4), "孫4が表示");
  });

  test("toggleExpand で未展開の ID を追加できる", () => {
    const next = toggleExpand([], 1);
    assert.deepStrictEqual(next, [1]);
  });

  test("toggleExpand で展開済みの ID を削除できる", () => {
    const next = toggleExpand([1, 2], 1);
    assert.deepStrictEqual(next, [2]);
  });

  test("折りたたみ後に子チケットが非表示になる", () => {
    const expanded = [1];
    const collapsed = toggleExpand(expanded, 1);
    const visible = getVisibleTickets(tickets, collapsed);
    const ids = visible.map(t => t.id);
    assert.ok(!ids.includes(2), "子2が非表示");
    assert.ok(!ids.includes(3), "子3が非表示");
  });

  test("親チケットを持たないチケットは常に表示される", () => {
    const visible = getVisibleTickets(tickets, []);
    assert.ok(visible.some(t => t.id === 5), "ルートチケット5は常に表示");
  });

  test("展開 ID リストに存在しない ID があっても他のチケットに影響しない", () => {
    const visible = getVisibleTickets(tickets, [999]);
    const ids = visible.map(t => t.id);
    assert.ok(ids.includes(1), "ルート1は表示");
    assert.ok(!ids.includes(2), "子2は展開されていない");
  });
});
