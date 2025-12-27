import * as assert from "assert";
import {
  resetTicketEditorDefaults,
  updateTicketEditorDefaultField,
} from "../views/ticketEditorDefaultsStore";
import { buildNewTicketDraftContent } from "../views/ticketDraftStore";

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
});
