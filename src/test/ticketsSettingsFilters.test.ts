import * as assert from "assert";
import { applyTicketFilters, TicketFilterSelection } from "../views/projectListSettings";

const baseFilters: TicketFilterSelection = {
  priorityIds: [],
  statusIds: [],
  trackerIds: [],
  assigneeIds: [],
  includeUnassigned: true,
};

suite("Ticket settings filters", () => {
  test("matches any value within a field", () => {
    const tickets = [
      { id: 1, subject: "One", projectId: 1, statusId: 1 },
      { id: 2, subject: "Two", projectId: 1, statusId: 2 },
      { id: 3, subject: "Three", projectId: 1, statusId: 3 },
    ];

    const filters: TicketFilterSelection = {
      ...baseFilters,
      statusIds: [1, 2],
    };

    const result = applyTicketFilters(tickets, filters);

    assert.deepStrictEqual(
      result.map((ticket) => ticket.id),
      [1, 2],
    );
  });

  test("requires matches across multiple fields", () => {
    const tickets = [
      { id: 1, subject: "One", projectId: 1, statusId: 1, priorityId: 10 },
      { id: 2, subject: "Two", projectId: 1, statusId: 1, priorityId: 11 },
      { id: 3, subject: "Three", projectId: 1, statusId: 2, priorityId: 11 },
    ];

    const filters: TicketFilterSelection = {
      ...baseFilters,
      statusIds: [1],
      priorityIds: [11],
    };

    const result = applyTicketFilters(tickets, filters);

    assert.deepStrictEqual(
      result.map((ticket) => ticket.id),
      [2],
    );
  });

  test("includes unassigned tickets only when enabled", () => {
    const tickets = [
      { id: 1, subject: "Assigned", projectId: 1, assigneeId: 7 },
      { id: 2, subject: "Unassigned", projectId: 1 },
    ];

    const withUnassigned = applyTicketFilters(tickets, {
      ...baseFilters,
      assigneeIds: [],
      includeUnassigned: true,
    });

    const withoutUnassigned = applyTicketFilters(tickets, {
      ...baseFilters,
      assigneeIds: [],
      includeUnassigned: false,
    });

    assert.deepStrictEqual(
      withUnassigned.map((ticket) => ticket.id),
      [1, 2],
    );
    assert.deepStrictEqual(
      withoutUnassigned.map((ticket) => ticket.id),
      [1],
    );
  });
});
