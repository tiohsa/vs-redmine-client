import * as assert from "assert";
import {
  buildTicketEditorContent,
  parseTicketEditorContent,
} from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("Ticket editor content metadata", () => {
  test("round-trips metadata without loss", () => {
    const metadata = buildIssueMetadataFixture({ priority: "High" });
    const content = buildTicketEditorContent({
      subject: "Subject",
      description: "Body",
      metadata,
    });

    const parsed = parseTicketEditorContent(content);
    const { keyOrder, ...parsedMetadata } = parsed.metadata;
    assert.deepStrictEqual(parsedMetadata, metadata);
  });

  test("parses metadata and description from editor content", () => {
    const rawContent = [
      "---",
      "issue:",
      "  tracker: Bug",
      "  priority: High",
      "  status: New",
      "  due_date: 2025-02-01",
      "---",
      "",
      "# Parsed subject",
      "",
      "Description line 1",
      "Description line 2",
    ].join("\n");

    const content = parseTicketEditorContent(rawContent);
    assert.strictEqual(content.subject, "Parsed subject");
    assert.strictEqual(content.metadata.tracker, "Bug");
    assert.strictEqual(content.metadata.priority, "High");
    assert.strictEqual(content.metadata.status, "New");
    assert.strictEqual(content.metadata.due_date, "2025-02-01");
    assert.strictEqual(content.description, "Description line 1\nDescription line 2");
  });
});
