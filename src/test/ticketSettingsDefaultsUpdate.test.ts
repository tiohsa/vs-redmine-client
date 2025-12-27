import * as assert from "assert";
import {
  getTicketEditorDefaults,
  resetTicketEditorDefaults,
  updateTicketEditorDefaultField,
} from "../views/ticketEditorDefaultsStore";

suite("Ticket editor defaults update", () => {
  teardown(() => {
    resetTicketEditorDefaults();
  });

  test("updates a single field without clearing others", () => {
    updateTicketEditorDefaultField("subject", "Initial subject");
    updateTicketEditorDefaultField("priority", "Normal");
    updateTicketEditorDefaultField("subject", "Updated subject");

    const defaults = getTicketEditorDefaults();
    assert.strictEqual(defaults.subject, "Updated subject");
    assert.strictEqual(defaults.metadata.priority, "Normal");
  });
});
