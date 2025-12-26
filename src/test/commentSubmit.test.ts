import * as assert from "assert";
import { buildAddCommentPayload } from "../redmine/comments";

suite("Comment submission payload", () => {
  test("builds payload with notes", () => {
    const payload = buildAddCommentPayload("Note");

    assert.deepStrictEqual(payload, {
      issue: {
        notes: "Note",
      },
    });
  });
});
