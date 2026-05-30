import * as assert from "assert";
import {
  updateMarkdownTicketHeader,
  validateMarkdownTicketHeader,
} from "../views/markdownTicketHeaderUpdater";
import { parseTicketEditorContent } from "../views/ticketEditorContent";

const buildMarkdown = (controlLines: string[] = ["mode: new-ticket"]): string =>
  [
    "---",
    ...controlLines,
    "issue:",
    "  tracker:   Task",
    "  priority:  Normal",
    "  status:    New",
    "  due_date:",
    "---",
    "",
    "# Ticket subject",
    "",
    "Body text.",
    "",
    "## Background",
    "",
    "- Detail",
  ].join("\n");

suite("Markdown ticket header updater", () => {
  test("rejects content without frontmatter", () => {
    assert.throws(
      () => validateMarkdownTicketHeader("# Ticket subject\n\nBody text."),
      new Error("Redmine metadata block is missing."),
    );
  });

  test("validates Redmine-only frontmatter for a new ticket", () => {
    const parsed = validateMarkdownTicketHeader(buildMarkdown(["mode: new-ticket", "project_id: 123"]));

    assert.strictEqual(parsed.controlFields?.mode, "new-ticket");
    assert.strictEqual(parsed.controlFields?.project_id, 123);
    assert.strictEqual(parsed.subject, "Ticket subject");
  });

  test("rejects missing mode with the ticket creation stop message", () => {
    assert.throws(
      () => validateMarkdownTicketHeader(buildMarkdown([])),
      new Error("Set mode: new-ticket to create a Redmine ticket from this Markdown file."),
    );
  });

  test("rejects ticket-update mode with the ticket creation stop message", () => {
    assert.throws(
      () => validateMarkdownTicketHeader(buildMarkdown(["mode: ticket-update"])),
      new Error("This Markdown file is already marked as a ticket update file."),
    );
  });

  test("rejects unsupported modes with the ticket creation stop message", () => {
    assert.throws(
      () => validateMarkdownTicketHeader(buildMarkdown(["mode: comment"])),
      new Error("Unsupported mode for ticket creation: comment"),
    );
  });

  test("rejects numeric issue_id as an existing link", () => {
    assert.throws(
      () => validateMarkdownTicketHeader(buildMarkdown(["mode: new-ticket", "issue_id: 456"])),
      new Error("Already linked to Redmine ticket #456."),
    );
  });

  test("rejects empty issue_id because the key is already reserved", () => {
    assert.throws(
      () => validateMarkdownTicketHeader(buildMarkdown(["mode: new-ticket", "issue_id:"])),
      new Error("Already linked to Redmine ticket #."),
    );
  });

  test("rejects unknown control keys before issue block", () => {
    assert.throws(
      () => validateMarkdownTicketHeader(buildMarkdown(["title: Meeting note", "mode: new-ticket"])),
      new Error("Unsupported frontmatter key: title"),
    );
  });

  test("requires an issue block", () => {
    const content = [
      "---",
      "mode: new-ticket",
      "project_id: 123",
      "---",
      "",
      "# Ticket subject",
    ].join("\n");

    assert.throws(
      () => validateMarkdownTicketHeader(content),
      new Error("Metadata must include issue block."),
    );
  });

  test("reports the command-specific missing subject message", () => {
    const content = [
      "---",
      "mode: new-ticket",
      "issue:",
      "  tracker: Task",
      "  priority: Normal",
      "  status: New",
      "  due_date:",
      "---",
      "",
      "Body without an H1.",
    ].join("\n");

    assert.throws(
      () => validateMarkdownTicketHeader(content),
      new Error("Subject line is missing."),
    );
  });

  test("updates registration fields and preserves body", () => {
    const content = buildMarkdown(["mode: new-ticket", "project_id: 123"]);
    const updated = updateMarkdownTicketHeader({
      content,
      projectId: 321,
      issueId: 456,
      syncedAt: "2026-05-31T10:30:00.000Z",
    });
    const parsed = parseTicketEditorContent(updated);

    assert.strictEqual(parsed.controlFields?.mode, "ticket-update");
    assert.strictEqual(parsed.controlFields?.project_id, 321);
    assert.strictEqual(parsed.controlFields?.issue_id, 456);
    assert.strictEqual(parsed.controlFields?.last_synced_at, "2026-05-31T10:30:00.000Z");
    assert.strictEqual(parsed.description, "Body text.\n\n## Background\n\n- Detail");
  });
});
