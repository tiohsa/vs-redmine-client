import * as assert from "assert";
import {
  getTicketEditorDefaults,
  resetTicketEditorDefaults,
  updateTicketEditorDefaultField,
} from "../views/ticketEditorDefaultsStore";

suite("Ticket editor default settings", () => {
  teardown(() => {
    resetTicketEditorDefaults();
  });

  test("saves defaults for subject and metadata", () => {
    updateTicketEditorDefaultField("subject", "Default subject");
    updateTicketEditorDefaultField("priority", "High");

    const defaults = getTicketEditorDefaults();
    assert.strictEqual(defaults.subject, "Default subject");
    assert.strictEqual(defaults.metadata.priority, "High");
  });
});
