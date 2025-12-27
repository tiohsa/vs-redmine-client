import * as assert from "assert";
import {
  buildTicketEditorContent,
  parseTicketEditorContent,
  resolveTicketEditorDisplay,
} from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("Ticket editor content", () => {
  test("builds markdown content", () => {
    const content = buildTicketEditorContent({
      subject: "Sample",
      description: "Body",
      metadata: buildIssueMetadataFixture(),
    });

    assert.strictEqual(
      content,
      [
        "# Sample",
        "",
        "---",
        "issue:",
        "  tracker:   Task",
        "  priority:  Normal",
        "  status:    In Progress",
        "  due_date:  2025-12-31",
        "---",
        "",
        "Body",
      ].join("\n"),
    );
  });

  test("parses markdown content", () => {
    const parsed = parseTicketEditorContent(
      [
        "# Title",
        "",
        "---",
        "issue:",
        "  tracker:   Task",
        "  priority:  Normal",
        "  status:    In Progress",
        "  due_date:  2025-12-31",
        "---",
        "",
        "Line 1",
        "Line 2",
      ].join("\n"),
    );

    assert.deepStrictEqual(parsed, {
      subject: "Title",
      description: "Line 1\nLine 2",
      metadata: buildIssueMetadataFixture(),
    });
  });

  test("prefers draft content when available", () => {
    const display = resolveTicketEditorDisplay(
      { subject: "Saved", description: "Body", metadata: buildIssueMetadataFixture() },
      {
        subject: "Draft",
        description: "Draft Body",
        metadata: buildIssueMetadataFixture({ priority: "High" }),
      },
    );

    assert.strictEqual(display.source, "draft");
    assert.strictEqual(display.content.subject, "Draft");
  });

  test("uses saved content when draft is missing", () => {
    const display = resolveTicketEditorDisplay(
      { subject: "Saved", description: "Body", metadata: buildIssueMetadataFixture() },
      undefined,
    );

    assert.strictEqual(display.source, "saved");
    assert.strictEqual(display.content.subject, "Saved");
  });
});
