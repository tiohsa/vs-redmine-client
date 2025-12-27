import * as assert from "assert";
import {
  buildTicketEditorContent,
  parseTicketEditorContent,
} from "../views/ticketEditorContent";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

suite("Ticket metadata block", () => {
  test("inserts metadata block when building content", () => {
    const content = buildTicketEditorContent({
      subject: "Title",
      description: "Body",
      metadata: buildIssueMetadataFixture(),
    });

    assert.ok(content.includes("---\nissue:\n"));
    assert.ok(content.includes("\n---\n"));
  });

  test("parses metadata block and description", () => {
    const input = buildTicketEditorContent({
      subject: "Title",
      description: "Line 1\nLine 2",
      metadata: buildIssueMetadataFixture({ due_date: "" }),
    });

    const parsed = parseTicketEditorContent(input);
    assert.strictEqual(parsed.description, "Line 1\nLine 2");
    assert.strictEqual(parsed.metadata.due_date, "");
  });
});
