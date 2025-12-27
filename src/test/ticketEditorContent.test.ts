import * as assert from "assert";
import {
  buildTicketEditorContent,
  parseTicketEditorContent,
  resolveTicketEditorDisplay,
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

  test("prefers draft content when available", () => {
    const display = resolveTicketEditorDisplay(
      { subject: "Saved", description: "Body" },
      { subject: "Draft", description: "Draft Body" },
    );

    assert.strictEqual(display.source, "draft");
    assert.strictEqual(display.content.subject, "Draft");
  });

  test("uses saved content when draft is missing", () => {
    const display = resolveTicketEditorDisplay(
      { subject: "Saved", description: "Body" },
      undefined,
    );

    assert.strictEqual(display.source, "saved");
    assert.strictEqual(display.content.subject, "Saved");
  });
});
