import * as assert from "assert";
import { applyTicketSort, TicketSortPreference } from "../views/projectListSettings";

suite("Ticket settings sorting", () => {
  test("keeps original order when no sort field selected", () => {
    const tickets = [
      { id: 1, subject: "One", projectId: 1, priorityId: 2 },
      { id: 2, subject: "Two", projectId: 1, priorityId: 1 },
    ];

    const sort: TicketSortPreference = {
      field: undefined,
      direction: "asc",
    };

    const result = applyTicketSort(tickets, sort);

    assert.deepStrictEqual(
      result.map((ticket) => ticket.id),
      [1, 2],
    );
  });

  test("sorts by selected field ascending", () => {
    const tickets = [
      { id: 1, subject: "One", projectId: 1, priorityId: 3 },
      { id: 2, subject: "Two", projectId: 1, priorityId: 1 },
      { id: 3, subject: "Three", projectId: 1, priorityId: 2 },
    ];

    const sort: TicketSortPreference = {
      field: "priority",
      direction: "asc",
    };

    const result = applyTicketSort(tickets, sort);

    assert.deepStrictEqual(
      result.map((ticket) => ticket.id),
      [2, 3, 1],
    );
  });

  test("sorts by selected field descending", () => {
    const tickets = [
      { id: 1, subject: "One", projectId: 1, trackerId: 2 },
      { id: 2, subject: "Two", projectId: 1, trackerId: 4 },
      { id: 3, subject: "Three", projectId: 1, trackerId: 1 },
    ];

    const sort: TicketSortPreference = {
      field: "tracker",
      direction: "desc",
    };

    const result = applyTicketSort(tickets, sort);

    assert.deepStrictEqual(
      result.map((ticket) => ticket.id),
      [2, 1, 3],
    );
  });
  test("sorts valid calendar dates independently and keeps invalid dates last", () => {
    const tickets = [
      { id: 1, subject: "a", projectId: 1, dueDate: "2025-12-31", startDate: "2026-02-01" },
      { id: 2, subject: "b", projectId: 1, dueDate: "2026-01-01", startDate: "2025-12-31" },
      { id: 3, subject: "c", projectId: 1, dueDate: "2026-01-01", startDate: "2025-12-31" },
      { id: 6, subject: "f", projectId: 1, dueDate: "2025-02-29", startDate: "2025-13-01" },
      { id: 5, subject: "e", projectId: 1, dueDate: "", startDate: "" },
      { id: 4, subject: "d", projectId: 1 },
      { id: 7, subject: "g", projectId: 1, dueDate: "2024-02-29", startDate: "2024-02-29" },
    ];
    const order = (field: "dueDate" | "startDate", direction: "asc" | "desc") =>
      applyTicketSort(tickets, { field, direction }).map(ticket => ticket.id);
    assert.deepStrictEqual(order("dueDate", "asc"), [7, 1, 2, 3, 4, 5, 6]);
    assert.deepStrictEqual(order("dueDate", "desc"), [3, 2, 1, 7, 4, 5, 6]);
    assert.deepStrictEqual(order("startDate", "asc"), [7, 2, 3, 1, 4, 5, 6]);
    assert.deepStrictEqual(order("startDate", "desc"), [1, 3, 2, 7, 4, 5, 6]);
  });
});
