import * as assert from "assert";
import {
  buildTicketEditorContent,
  parseTicketEditorContent,
} from "../views/ticketEditorContent";

suite("Ticket editor content", () => {
  test("builds markdown content", () => {
    const content = buildTicketEditorContent({
      subject: "Sample",
      description: "Body",
    });

    assert.strictEqual(content, "# Sample\n\nBody");
  });

  test("parses markdown content", () => {
    const parsed = parseTicketEditorContent("# Title\n\nLine 1\nLine 2");

    assert.deepStrictEqual(parsed, {
      subject: "Title",
      description: "Line 1\nLine 2",
    });
  });
});
