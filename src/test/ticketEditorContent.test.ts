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
        "---",
        "issue:",
        "  tracker:   Task",
        "  priority:  Normal",
        "  status:    In Progress",
        "  due_date:  2025-12-31",
        "---",
        "",
        "# Sample",
        "",
        "Body",
      ].join("\n"),
    );
  });

  test("parses metadata-first markdown content", () => {
    const parsed = parseTicketEditorContent(
      [
        "---",
        "issue:",
        "  tracker:   Task",
        "  priority:  Normal",
        "  status:    In Progress",
        "  due_date:  2025-12-31",
        "---",
        "",
        "# Title",
        "",
        "Line 1",
        "Line 2",
      ].join("\n"),
    );

    assert.deepStrictEqual(parsed, {
      subject: "Title",
      description: "Line 1\nLine 2",
      metadata: {
        ...buildIssueMetadataFixture(),
        keyOrder: ["tracker", "priority", "status", "due_date"],
      },
      layout: "metadata-first",
      metadataBlock: "present",
    });
  });

  test("parses legacy subject-first markdown content", () => {
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
      metadata: {
        ...buildIssueMetadataFixture(),
        keyOrder: ["tracker", "priority", "status", "due_date"],
      },
      layout: "subject-first",
      metadataBlock: "present",
    });
  });

  test("preserves extra blank lines after the subject", () => {
    const input = [
      "---",
      "issue:",
      "  tracker:   Task",
      "  priority:  Normal",
      "  status:    In Progress",
      "  due_date:  2025-12-31",
      "---",
      "",
      "# Title",
      "",
      "",
      "Body",
    ].join("\n");

    const parsed = parseTicketEditorContent(input);
    const rebuilt = buildTicketEditorContent(parsed);

    assert.strictEqual(rebuilt, input);
  });

  test("preserves legacy subject-first ordering when rebuilt", () => {
    const input = [
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
      "Body",
    ].join("\n");

    const parsed = parseTicketEditorContent(input);
    const rebuilt = buildTicketEditorContent(parsed);

    assert.strictEqual(rebuilt, input);
  });

  test("keeps legacy content without metadata block", () => {
    const input = ["# Title", "", "Body"].join("\n");
    const fallback = buildIssueMetadataFixture();
    const parsed = parseTicketEditorContent(input, {
      allowMissingMetadata: true,
      fallbackMetadata: fallback,
    });

    assert.strictEqual(parsed.metadataBlock, "missing");
    const rebuilt = buildTicketEditorContent(parsed);
    assert.strictEqual(rebuilt, input);
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
