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
});
