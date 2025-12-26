import * as assert from "assert";
import { formatCommentDescription, formatCommentLabel } from "../views/commentListFormat";

suite("Comment list formatting", () => {
  test("formats label with comment number", () => {
    const label = formatCommentLabel({
      id: 12,
      ticketId: 1,
      authorId: 99,
      authorName: "Alice",
      body: "Body",
      editableByCurrentUser: false,
    });

    assert.strictEqual(label, "#12 Alice");
  });

  test("formats description from body", () => {
    const description = formatCommentDescription({
      id: 12,
      ticketId: 1,
      authorId: 99,
      authorName: "Alice",
      body: "Hello world",
      editableByCurrentUser: false,
    });

    assert.strictEqual(description, "Hello world");
  });
});
