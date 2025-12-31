import * as assert from "assert";
import { buildIssueUpdatePayload } from "../redmine/issues";

suite("Ticket update payload", () => {
  test("maps changed fields to Redmine payload", () => {
    const payload = buildIssueUpdatePayload({
      subject: "New subject",
      description: "New body",
      statusId: 2,
      assigneeId: 5,
      trackerId: 4,
      priorityId: 3,
      dueDate: "2025-12-31",
    });

    assert.deepStrictEqual(payload, {
      issue: {
        subject: "New subject",
        description: "New body",
        status_id: 2,
        assigned_to_id: 5,
        tracker_id: 4,
        priority_id: 3,
        due_date: "2025-12-31",
      },
    });
  });

  test("omits undefined fields", () => {
    const payload = buildIssueUpdatePayload({
      description: "Only body",
      dueDate: null,
    });

    assert.deepStrictEqual(payload, {
      issue: {
        description: "Only body",
        due_date: null,
      },
    });
  });

  test("includes new metadata fields", () => {
    const payload = buildIssueUpdatePayload({
      startDate: "2025-01-01",
      doneRatio: 50,
      estimatedHours: 4.5,
      authorId: 99,
    });

    assert.deepStrictEqual(payload, {
      issue: {
        start_date: "2025-01-01",
        done_ratio: 50,
        estimated_hours: 4.5,
      },
    });
  });
});
