import * as assert from "assert";
import {
  resetTicketEditorDefaults,
  updateTicketEditorDefaultField,
} from "../views/ticketEditorDefaultsStore";
import { buildNewChildTicketDraftContent, buildNewTicketDraftContent } from "../views/ticketDraftStore";

suite("Ticket editor defaults application", () => {
  teardown(() => {
    resetTicketEditorDefaults();
  });

  test("applies defaults to new ticket draft content", () => {
    updateTicketEditorDefaultField("subject", "Default subject");
    updateTicketEditorDefaultField("description", "Default description");
    updateTicketEditorDefaultField("tracker", "Task");
    updateTicketEditorDefaultField("priority", "High");
    updateTicketEditorDefaultField("status", "New");
    updateTicketEditorDefaultField("due_date", "2025-01-01");

    const content = buildNewTicketDraftContent();
    assert.deepStrictEqual(content, {
      subject: "Default subject",
      description: "Default description",
      metadata: {
        tracker: "Task",
        priority: "High",
        status: "New",
        due_date: "2025-01-01",
        children: [],
      },
    });
  });

  test("uses empty defaults when no defaults are defined", () => {
    resetTicketEditorDefaults();

    const content = buildNewTicketDraftContent();
    assert.deepStrictEqual(content, {
      subject: "",
      description: "",
      metadata: {
        tracker: "",
        priority: "",
        status: "",
        due_date: "",
        children: [],
      },
    });
  });

  test("applies parent metadata to child ticket draft content", () => {
    const content = buildNewChildTicketDraftContent({
      id: 123,
      subject: "Parent",
      projectId: 10,
      trackerName: "Bug",
      priorityName: "High",
      statusName: "In Progress",
      dueDate: "2025-12-24",
    });

    assert.strictEqual(content.metadata.parent, 123);
    assert.strictEqual(content.metadata.tracker, "Bug");
    assert.strictEqual(content.metadata.priority, "High");
    assert.strictEqual(content.metadata.status, "In Progress");
    assert.strictEqual(content.metadata.due_date, "2025-12-24");
  });
});
