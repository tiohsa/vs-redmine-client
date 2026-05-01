import * as assert from "assert";
import { applyTicketFilters, TicketFilterSelection } from "../views/projectListSettings";

const baseFilters: TicketFilterSelection = {
  subjectQuery: "",
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

  test("returns all tickets when no assignee/status filters are selected", () => {
    const tickets = [
      { id: 1, subject: "One", projectId: 1, statusId: 1, assigneeId: 10 },
      { id: 2, subject: "Two", projectId: 1, statusId: 2 },
      { id: 3, subject: "Three", projectId: 1, statusId: 3, assigneeId: 11 },
    ];
    const result = applyTicketFilters(tickets, {
      ...baseFilters,
      includeUnassigned: false,
    });
    assert.deepStrictEqual(result.map((ticket) => ticket.id), [1, 3]);
  });

  test("assignee filter returns only selected assignee tickets", () => {
    const tickets = [
      { id: 1, subject: "One", projectId: 1, assigneeId: 10 },
      { id: 2, subject: "Two", projectId: 1, assigneeId: 20 },
      { id: 3, subject: "Three", projectId: 1 },
    ];
    const result = applyTicketFilters(tickets, {
      ...baseFilters,
      assigneeIds: [20],
      includeUnassigned: false,
    });
    assert.deepStrictEqual(result.map((ticket) => ticket.id), [2]);
  });

  test("unassigned filter returns only unassigned when selected alone", () => {
    const tickets = [
      { id: 1, subject: "Assigned", projectId: 1, assigneeId: 7 },
      { id: 2, subject: "Unassigned", projectId: 1 },
    ];
    const result = applyTicketFilters(tickets, {
      ...baseFilters,
      assigneeIds: [],
      includeUnassigned: true,
    });
    assert.deepStrictEqual(result.map((ticket) => ticket.id), [1, 2]);
  });

  test("assignee + unassigned includes both", () => {
    const tickets = [
      { id: 1, subject: "A", projectId: 1, assigneeId: 1 },
      { id: 2, subject: "B", projectId: 1, assigneeId: 2 },
      { id: 3, subject: "C", projectId: 1 },
    ];
    const result = applyTicketFilters(tickets, {
      ...baseFilters,
      assigneeIds: [1],
      includeUnassigned: true,
    });
    assert.deepStrictEqual(result.map((ticket) => ticket.id), [1, 3]);
  });

  test("status filter returns only selected status tickets", () => {
    const tickets = [
      { id: 1, subject: "A", projectId: 1, statusId: 1 },
      { id: 2, subject: "B", projectId: 1, statusId: 2 },
      { id: 3, subject: "C", projectId: 1, statusId: 3 },
    ];
    const result = applyTicketFilters(tickets, {
      ...baseFilters,
      statusIds: [2, 3],
    });
    assert.deepStrictEqual(result.map((ticket) => ticket.id), [2, 3]);
  });

  test("status filter falls back to status name when status id is unavailable", () => {
    const tickets = [
      { id: 1, subject: "A", projectId: 1, statusId: 2, statusName: "In Progress" },
      { id: 2, subject: "B", projectId: 1, statusName: "In Progress" },
      { id: 3, subject: "C", projectId: 1, statusName: "Closed" },
    ];
    const result = applyTicketFilters(tickets, {
      ...baseFilters,
      statusIds: [2],
    });
    assert.deepStrictEqual(result.map((ticket) => ticket.id), [1, 2]);
  });

  test("assignee and status filters combine with AND semantics", () => {
    const tickets = [
      { id: 1, subject: "A", projectId: 1, assigneeId: 10, statusId: 1 },
      { id: 2, subject: "B", projectId: 1, assigneeId: 10, statusId: 2 },
      { id: 3, subject: "C", projectId: 1, assigneeId: 20, statusId: 2 },
    ];
    const result = applyTicketFilters(tickets, {
      ...baseFilters,
      assigneeIds: [10],
      statusIds: [2],
      includeUnassigned: false,
    });
    assert.deepStrictEqual(result.map((ticket) => ticket.id), [2]);
  });

  test("clearing filters restores all tickets", () => {
    const tickets = [
      { id: 1, subject: "A", projectId: 1, assigneeId: 10, statusId: 1 },
      { id: 2, subject: "B", projectId: 1, statusId: 2 },
    ];
    const filtered = applyTicketFilters(tickets, {
      ...baseFilters,
      assigneeIds: [10],
      includeUnassigned: false,
      statusIds: [1],
    });
    assert.deepStrictEqual(filtered.map((ticket) => ticket.id), [1]);
    const cleared = applyTicketFilters(tickets, baseFilters);
    assert.deepStrictEqual(cleared.map((ticket) => ticket.id), [1, 2]);
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

  test("filters by title keyword when provided", () => {
    const tickets = [
      { id: 1, subject: "Fix login issue", projectId: 1 },
      { id: 2, subject: "Update documentation", projectId: 1 },
      { id: 3, subject: "Login UI polish", projectId: 1 },
    ];

    const result = applyTicketFilters(tickets, {
      ...baseFilters,
      subjectQuery: "login",
    });

    assert.deepStrictEqual(
      result.map((ticket) => ticket.id),
      [1, 3],
    );
  });
});
