import * as assert from "assert";
import {
  buildCommentEditorFilename,
  buildTicketEditorFilename,
} from "../views/editorFilename";

suite("Editor filename builder", () => {
  test("builds stable ticket filename", () => {
    const filename = buildTicketEditorFilename(2, 10, "primary");

    assert.strictEqual(filename, "project-2_ticket-10.md");
  });

  test("builds stable extra ticket filename", () => {
    const filename = buildTicketEditorFilename(2, 10, "extra");

    assert.strictEqual(filename, "project-2_ticket-10_extra.md");
  });

  test("builds stable comment filename", () => {
    const filename = buildCommentEditorFilename(2, 10, 55);

    assert.strictEqual(filename, "project-2_ticket-10_comment-55.md");
  });
});
