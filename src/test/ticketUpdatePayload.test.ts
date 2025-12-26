import * as assert from "assert";
import { buildIssueUpdatePayload } from "../redmine/issues";

suite("Ticket update payload", () => {
  test("maps changed fields to Redmine payload", () => {
    const payload = buildIssueUpdatePayload({
      subject: "New subject",
      description: "New body",
      statusId: 2,
      assigneeId: 5,
    });

    assert.deepStrictEqual(payload, {
      issue: {
        subject: "New subject",
        description: "New body",
        status_id: 2,
        assigned_to_id: 5,
      },
    });
  });

  test("omits undefined fields", () => {
    const payload = buildIssueUpdatePayload({
      description: "Only body",
    });

    assert.deepStrictEqual(payload, {
      issue: {
        description: "Only body",
      },
    });
  });
});
