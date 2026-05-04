import * as assert from "assert";
import {
  applyTicketViewPipeline,
  buildDueIndicatorsMap,
  DEFAULT_TICKET_LIST_SETTINGS,
  DueDateDisplayRule,
  formatDueDateIndicator,
  resolveDueDateWindow,
  TicketListSettings,
} from "../views/projectListSettings";
import { Ticket } from "../redmine/types";

const baseRule: DueDateDisplayRule = {
  showWithin7Days: true,
  showWithin3Days: true,
  showWithin1Day: true,
  showOverdue: true,
};

suite("Ticket due date display", () => {
  test("selects closest due date window", () => {
    const now = new Date("2025-01-10T00:00:00Z");
    const ticket = {
      id: 1,
      subject: "Soon",
      projectId: 1,
      dueDate: "2025-01-11",
    };

    const window = resolveDueDateWindow(ticket, baseRule, now);
    const label = formatDueDateIndicator(window);

    assert.strictEqual(window, "within1Day");
    assert.strictEqual(label, "Due in 1 day");
  });

  test("respects disabled windows", () => {
    const now = new Date("2025-01-10T00:00:00Z");
    const ticket = {
      id: 2,
      subject: "Soon",
      projectId: 1,
      dueDate: "2025-01-11",
    };

    const rule: DueDateDisplayRule = {
      ...baseRule,
      showWithin1Day: false,
      showWithin3Days: true,
    };

    const window = resolveDueDateWindow(ticket, rule, now);
    const label = formatDueDateIndicator(window);

    assert.strictEqual(window, "within3Days");
    assert.strictEqual(label, "Due in 3 days");
  });

  test("uses overdue when date has passed", () => {
    const now = new Date("2025-01-10T00:00:00Z");
    const ticket = {
      id: 3,
      subject: "Late",
      projectId: 1,
      dueDate: "2025-01-05",
    };

    const window = resolveDueDateWindow(ticket, baseRule, now);
    const label = formatDueDateIndicator(window);

    assert.strictEqual(window, "overdue");
    assert.strictEqual(label, "Overdue");
  });
});

suite("buildDueIndicatorsMap", () => {
  test("maps each ticket id to its formatted due indicator", () => {
    const now = new Date("2025-01-10T00:00:00Z");
    const tickets: Ticket[] = [
      { id: 1, subject: "Soon", projectId: 1, dueDate: "2025-01-11" },
      { id: 2, subject: "Late", projectId: 1, dueDate: "2025-01-05" },
    ];

    const map = buildDueIndicatorsMap(tickets, baseRule, now);

    assert.strictEqual(map.get(1), "Due in 1 day");
    assert.strictEqual(map.get(2), "Overdue");
    assert.strictEqual(map.size, 2);
  });

  test("sets undefined for tickets without a due date", () => {
    const now = new Date("2025-01-10T00:00:00Z");
    const tickets: Ticket[] = [
      { id: 10, subject: "No deadline", projectId: 1 },
    ];

    const map = buildDueIndicatorsMap(tickets, baseRule, now);

    assert.ok(map.has(10));
    assert.strictEqual(map.get(10), undefined);
  });
});

suite("applyTicketViewPipeline", () => {
  const tickets: Ticket[] = [
    { id: 3, subject: "C", projectId: 1, priorityId: 2, priorityName: "Normal" },
    { id: 1, subject: "A", projectId: 1, priorityId: 1, priorityName: "Low" },
    { id: 2, subject: "B", projectId: 1, priorityId: 3, priorityName: "High" },
  ];

  test("applies filter, sort, and slice in order", () => {
    const settings: TicketListSettings = {
      ...DEFAULT_TICKET_LIST_SETTINGS,
      sort: { field: "priority", direction: "asc" },
    };

    const result = applyTicketViewPipeline(tickets, settings);

    assert.deepStrictEqual(
      result.map((t) => t.id),
      [1, 3, 2],
    );
  });

  test("respects the limit argument", () => {
    const result = applyTicketViewPipeline(tickets, DEFAULT_TICKET_LIST_SETTINGS, 2);

    assert.strictEqual(result.length, 2);
  });

  test("filters out tickets that do not match the selection", () => {
    const settings: TicketListSettings = {
      ...DEFAULT_TICKET_LIST_SETTINGS,
      filters: {
        ...DEFAULT_TICKET_LIST_SETTINGS.filters,
        priorityIds: [3],
      },
    };

    const result = applyTicketViewPipeline(tickets, settings);

    assert.deepStrictEqual(
      result.map((t) => t.id),
      [2],
    );
  });
});
