import * as assert from "assert";
import { parseTicketEditorContent } from "../views/ticketEditorContent";

suite("Ticket template metadata parsing", () => {
  test("parses metadata and description from template content", () => {
    const template = [
      "---",
      "issue:",
      "  tracker: Bug",
      "  priority: High",
      "  status: New",
      "  due_date: 2025-02-01",
      "---",
      "",
      "# Template subject",
      "",
      "Template description line 1",
      "Template description line 2",
    ].join("\n");

    const content = parseTicketEditorContent(template);
    assert.strictEqual(content.subject, "Template subject");
    assert.strictEqual(content.metadata.tracker, "Bug");
    assert.strictEqual(content.metadata.priority, "High");
    assert.strictEqual(content.metadata.status, "New");
    assert.strictEqual(content.metadata.due_date, "2025-02-01");
    assert.strictEqual(
      content.description,
      "Template description line 1\nTemplate description line 2",
    );
  });
});
