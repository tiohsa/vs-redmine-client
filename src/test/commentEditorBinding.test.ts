import * as assert from "assert";
import {
  buildCommentEditorContent,
  buildTicketPreviewContent,
} from "../views/ticketPreview";

suite("Comment editor binding", () => {
  test("builds ticket preview without comment content", () => {
    const content = buildTicketPreviewContent({
      subject: "Ticket",
      description: "Details",
    });

    assert.ok(content.includes("# Ticket"));
    assert.ok(content.includes("Details"));
  });

  test("builds comment editor content from comment body", () => {
    const content = buildCommentEditorContent("Comment body");

    assert.strictEqual(content, "Comment body");
  });
});
