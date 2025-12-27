import * as assert from "assert";
import {
  resetTicketEditorDefaults,
  updateTicketEditorDefaultField,
} from "../views/ticketEditorDefaultsStore";
import { buildEditorDefaultsItems } from "../views/ticketSettingsView";

suite("Ticket editor defaults display", () => {
  teardown(() => {
    resetTicketEditorDefaults();
  });

  test("shows current defaults in settings view items", () => {
    updateTicketEditorDefaultField("subject", "Default subject");

    const items = buildEditorDefaultsItems();
    const subjectItem = items.find(
      (item) => item.label === "Editor default: Subject",
    );

    assert.ok(subjectItem);
    assert.strictEqual(subjectItem?.description, "Default subject");
  });
});
