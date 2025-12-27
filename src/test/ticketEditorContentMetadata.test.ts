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
    assert.deepStrictEqual(parsed.metadata, metadata);
  });
});
