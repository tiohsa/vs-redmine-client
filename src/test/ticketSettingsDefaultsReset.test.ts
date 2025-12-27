import * as assert from "assert";
import {
  getTicketEditorDefaults,
  resetTicketEditorDefaultFields,
  resetTicketEditorDefaults,
  updateTicketEditorDefaultField,
} from "../views/ticketEditorDefaultsStore";

suite("Ticket editor defaults reset", () => {
  teardown(() => {
    resetTicketEditorDefaults();
  });

  test("resets selected fields to blank", () => {
    updateTicketEditorDefaultField("subject", "Default subject");
    updateTicketEditorDefaultField("status", "New");

    resetTicketEditorDefaultFields(["subject"]);

    const defaults = getTicketEditorDefaults();
    assert.strictEqual(defaults.subject, "");
    assert.strictEqual(defaults.metadata.status, "New");
  });
});
